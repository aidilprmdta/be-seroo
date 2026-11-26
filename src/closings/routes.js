import { Hono } from "hono";
import { z } from "zod";
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

const cashDifferenceReviewSchema = z
  .object({
    status: z.enum([
      "BELUM_DIPERIKSA",
      "SEDANG_DIPERIKSA",
      "SUDAH_DIKETAHUI",
      "BELUM_TERSELESAIKAN",
    ]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

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

  // Perbarui status investigasi selisih kas (Manager only, audit logged)
  routes.patch("/:outletId/closings/:closingId/cash-difference", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const closingId = c.req.param("closingId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, ["MANAGER"]);

    let body;
    try {
      body = cashDifferenceReviewSchema.parse(await c.req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ClosingError("VALIDATION_ERROR", 400, "Status investigasi selisih kas tidak valid.");
      }
      throw err;
    }

    const closing = await prisma.closingRecord.findFirst({
      where: { id: closingId, outletId },
    });
    if (!closing) {
      throw new ClosingError("CLOSING_NOT_FOUND", 404, "Closing tidak ditemukan.");
    }
    if (closing.cashDifference === null || closing.cashDifference === undefined) {
      throw new ClosingError(
        "NO_CASH_DIFFERENCE",
        400,
        "Closing ini tidak memiliki selisih kas untuk diperiksa.",
      );
    }

    const reviewedAt = now();
    const updated = await prisma.closingRecord.update({
      where: { id: closing.id },
      data: {
        cashDifferenceStatus: body.status,
        cashDifferenceReviewedAt: reviewedAt,
        cashDifferenceReviewedById: auth.userId,
        cashDifferenceReviewNote: body.note ?? closing.cashDifferenceReviewNote,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "CASH_DIFFERENCE_REVIEWED",
      resourceType: "ClosingRecord",
      resourceId: closing.id,
      metadata: {
        previousStatus: closing.cashDifferenceStatus,
        status: body.status,
        noteProvided: Boolean(body.note),
      },
    });

    return c.json({
      success: true,
      data: {
        closing: {
          id: updated.id,
          outletId: updated.outletId,
          closingType: updated.closingType,
          periodKey: updated.periodKey,
          cashDifference: updated.cashDifference?.toString() ?? null,
          cashDifferenceStatus: updated.cashDifferenceStatus,
          cashDifferenceReviewedAt: updated.cashDifferenceReviewedAt?.toISOString() ?? null,
          cashDifferenceReviewedById: updated.cashDifferenceReviewedById ?? null,
          cashDifferenceReviewNote: updated.cashDifferenceReviewNote ?? null,
        },
      },
    });
  });

  return routes;
}

