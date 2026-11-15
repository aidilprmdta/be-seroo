import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { ClosingError } from "./errors.js";
import {
  getClosingPreview,
  performClosing,
  reopenClosing,
  listClosings,
  recordCashOpening,
  getCashOpening,
} from "./service.js";

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new ClosingError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireMembership(prisma, userId, outletId, allowedRoles) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });

  if (
    !membership ||
    !membership.outlet?.isActive ||
    !allowedRoles.includes(membership.role)
  ) {
    throw new ClosingError(
      "FORBIDDEN",
      403,
      "Akses ke operasi closing outlet ini tidak diizinkan.",
    );
  }

  return membership.role;
}

export function createClosingRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // Preview before closing (Manager and Owner)
  routes.get("/:outletId/closings/preview", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const closingType = c.req.query("type") || "DAILY";
    const periodKey = c.req.query("periodKey");

    if (!periodKey) {
      throw new ClosingError(
        "VALIDATION_ERROR",
        400,
        "Parameter periodKey diperlukan (format YYYY-MM-DD atau YYYY-MM).",
      );
    }

    const preview = await getClosingPreview({
      prisma,
      outletId,
      closingType,
      periodKey,
      now: now(),
    });

    return c.json({
      success: true,
      data: preview,
    });
  });

  // List existing closings
  routes.get("/:outletId/closings", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const closingType = c.req.query("type");
    const records = await listClosings({ prisma, outletId, closingType });

    return c.json({
      success: true,
      data: {
        outletId,
        closings: records,
      },
    });
  });

  // Perform closing (Manager only)
  routes.post("/:outletId/closings", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ClosingError(
        "VALIDATION_ERROR",
        400,
        "Format data closing tidak valid.",
      );
    }

    const result = await performClosing({
      prisma,
      outletId,
      userId: auth.userId,
      payload: body,
      now,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: result.replayed
        ? "CLOSING_REPLAYED"
        : result.record?.status === "CLOSED" && result.record?.version > 1
          ? "CLOSING_RE_CLOSED"
          : "CLOSING_CLOSED",
      resourceType: "ClosingRecord",
      resourceId: result.record?.id,
      metadata: {
        closingType: body.closingType,
        periodKey: body.periodKey,
        version: result.record?.version,
        replayed: result.replayed,
      },
    });

    return c.json(
      {
        success: true,
        data: result,
      },
      result.replayed ? 200 : 201,
    );
  });

  // Reopen closing (Manager only, mandatory reason)
  routes.post("/:outletId/closings/reopen", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ClosingError(
        "VALIDATION_ERROR",
        400,
        "Format data reopen tidak valid.",
      );
    }

    const result = await reopenClosing({
      prisma,
      outletId,
      userId: auth.userId,
      payload: body,
      now,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: result.replayed ? "CLOSING_REOPEN_REPLAYED" : "CLOSING_REOPENED",
      resourceType: "ClosingRecord",
      resourceId: result.record?.id,
      metadata: {
        reasonProvided: Boolean(body.reason),
        version: result.record?.version,
        replayed: result.replayed,
      },
    });

    return c.json({
      success: true,
      data: result,
    });
  });

  // Record opening cash (Manager only)
  routes.post("/:outletId/cash-openings", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ClosingError(
        "VALIDATION_ERROR",
        400,
        "Format data kas awal tidak valid.",
      );
    }

    const result = await recordCashOpening(prisma, {
      outletId,
      userId: auth.userId,
      payload: body,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "CASH_OPENING_RECORDED",
      resourceType: "CashOpening",
      resourceId: result.id,
      metadata: {
        periodKey: result.periodKey,
        openingCash: result.openingCash,
        notesProvided: Boolean(body.notes),
      },
    });

    return c.json({ success: true, data: result }, 201);
  });

  // Get opening cash for a date (Manager, Owner, Owner Mitra, Admin Pusat)
  routes.get("/:outletId/cash-openings/:periodKey", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const periodKey = c.req.param("periodKey");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const result = await getCashOpening(prisma, { outletId, periodKey });

    return c.json({
      success: true,
      data: { cashOpening: result },
    });
  });

  return routes;
}

