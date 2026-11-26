import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { PosError } from "./errors.js";

const handoverSchema = z
  .object({
    currentOutlet: z.string().min(1).max(64),
    nextOutlet: z.string().min(1).max(64),
    crewUserId: z.string().min(1).max(64).optional(),
    crewName: z.string().min(1).max(128).optional(),
    handoverAt: z.string().datetime().optional(),
    summary: z.string().trim().max(500).optional(),
    cashHandover: z.string().trim().max(200).optional(),
    checklistAgenda: z.string().trim().max(500).optional(),
    checklistService: z.string().trim().max(500).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const acceptRejectSchema = z
  .object({
    status: z.enum(["ACCEPTED", "REJECTED"]),
    notes: z.string().max(500).optional(),
  })
  .strict();

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) throw new PosError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
}

async function requireOutletMembership(prisma, userId, outletId, allowedRoles = ["CREW", "MANAGER", "OWNER", "OWNER_MITRA"]) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });
  if (!membership || !membership.outlet?.isActive || !allowedRoles.includes(membership.role)) {
    throw new PosError("FORBIDDEN", 403, "Akses ke outlet ini tidak diizinkan.");
  }
  return membership;
}

async function assertCrewMember(prisma, userId, outletId) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
  });
  if (!membership || membership.role !== "CREW") {
    throw new PosError("FORBIDDEN", 403, "Hanya crew yang dapat mengajukan serah terima.");
  }
  return membership;
}

export function createShiftHandoverRoutes({
  prisma,
  accessTokenSecret,
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({ prisma, accessTokenSecret });

  routes.post("/:outletId/request", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId, ["CREW", "MANAGER", "OWNER", "OWNER_MITRA"]);

    let body;
    try { body = handoverSchema.parse(await c.req.json()); } catch (err) {
      if (err instanceof z.ZodError) throw new PosError("VALIDATION_ERROR", 400, err.issues[0].message);
      throw err;
    }

    // Validate crewUserId if provided
    if (body.crewUserId) {
      const crew = await prisma.user.findUnique({ where: { id: body.crewUserId } });
      if (!crew) throw new PosError("CREW_NOT_FOUND", 404, "Kru yang dimaksud tidak ditemukan.");
    }

    const existing = await prisma.shiftHandover.findFirst({
      where: {
        outletId,
        nextOutlet: body.nextOutlet,
        status: { in: ["PENDING", "ACCEPTED"] },
      },
    });
    if (existing) {
      return c.json({ success: true, data: { handover: {
        id: existing.id, currentOutlet: existing.outletId, nextOutlet: existing.nextOutlet,
        crewName: existing.crewName, crewUserId: existing.crewUserId, status: existing.status,
        summary: existing.summary, cashHandover: existing.cashHandover,
        checklistAgenda: existing.checklistAgenda, checklistService: existing.checklistService,
        notes: existing.notes, handoverAt: existing.handoverAt?.toISOString() || null,
        createdAt: existing.createdAt.toISOString(),
      } } }, 200);
    }

    const handover = await prisma.shiftHandover.create({
      data: {
        outletId,
        // Schema hanya punya outletId; currentOutlet di request adalah outlet asal yang sama.
        nextOutlet: body.nextOutlet,
        crewUserId: body.crewUserId || auth.userId,
        crewName: body.crewName || (await prisma.user.findUnique({ where: { id: auth.userId } }).then((u) => u?.name)),
        handoverAt: body.handoverAt || new Date(),
        summary: body.summary,
        cashHandover: body.cashHandover,
        checklistAgenda: body.checklistAgenda,
        checklistService: body.checklistService,
        notes: body.notes,
      },
    });

    return c.json({ success: true, data: { handover: {
      id: handover.id, currentOutlet: handover.outletId, nextOutlet: handover.nextOutlet,
      crewName: handover.crewName, crewUserId: handover.crewUserId, status: handover.status,
      summary: handover.summary, cashHandover: handover.cashHandover,
      checklistAgenda: handover.checklistAgenda, checklistService: handover.checklistService,
      notes: handover.notes, handoverAt: handover.handoverAt?.toISOString() || null,
      createdAt: handover.createdAt.toISOString(),
    } } }, 201);
  });

  routes.get("/:outletId/requests", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    const statusFilter = c.req.query("status");
    const where = { outletId };
    if (statusFilter) where.status = statusFilter;

    const handovers = await prisma.shiftHandover.findMany({
      where,
      orderBy: { handoverAt: "desc" },
    });

    return c.json({ success: true, data: { handovers: handovers.map((h) => ({
      id: h.id, currentOutlet: h.outletId, nextOutlet: h.nextOutlet,
      crewName: h.crewName, crewUserId: h.crewUserId, status: h.status,
      summary: h.summary, cashHandover: h.cashHandover,
      checklistAgenda: h.checklistAgenda, checklistService: h.checklistService,
      notes: h.notes, handoverAt: h.handoverAt?.toISOString() || null,
      createdAt: h.createdAt.toISOString(), acceptedAt: h.acceptedAt?.toISOString() || null,
      rejectedAt: h.rejectedAt?.toISOString() || null,
    })) } });
  });

  routes.get("/:outletId/requests/:handoverId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const handoverId = c.req.param("handoverId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    const handover = await prisma.shiftHandover.findFirst({
      where: { id: handoverId, outletId },
    });
    if (!handover) throw new PosError("HANDOVER_NOT_FOUND", 404, "Serah terima tidak ditemukan.");

    return c.json({ success: true, data: { handover: {
      id: handover.id, currentOutlet: handover.outletId, nextOutlet: handover.nextOutlet,
      crewName: handover.crewName, crewUserId: handover.crewUserId, status: handover.status,
      summary: handover.summary, cashHandover: handover.cashHandover,
      checklistAgenda: handover.checklistAgenda, checklistService: handover.checklistService,
      notes: handover.notes, handoverAt: handover.handoverAt?.toISOString() || null,
      createdAt: handover.createdAt.toISOString(), acceptedAt: handover.acceptedAt?.toISOString() || null,
      rejectedAt: handover.rejectedAt?.toISOString() || null,
    } } });
  });

  routes.patch("/:outletId/requests/:handoverId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const handoverId = c.req.param("handoverId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId, ["MANAGER", "OWNER", "OWNER_MITRA"]);

    let body;
    try { body = acceptRejectSchema.parse(await c.req.json()); } catch (err) {
      if (err instanceof z.ZodError) throw new PosError("VALIDATION_ERROR", 400, err.issues[0].message);
      throw err;
    }

    const handover = await prisma.shiftHandover.findFirst({
      where: { id: handoverId, outletId },
    });
    if (!handover) throw new PosError("HANDOVER_NOT_FOUND", 404, "Serah terima tidak ditemukan.");

    if (handover.status === "CONFIRMED") {
      throw new PosError("HANDOVER_ALREADY_CONFIRMED", 400, "Serah terima sudah disahkan.");
    }

    const updated = await prisma.shiftHandover.update({
      where: { id: handoverId },
      data: {
        status: body.status,
        notes: body.status === "REJECTED" ? (handover.notes ? `${handover.notes}; ${body.notes}` : body.notes) : handover.notes,
        acceptedAt: body.status === "ACCEPTED" ? new Date() : null,
        rejectedAt: body.status === "REJECTED" ? new Date() : null,
        rejectedReason: body.status === "REJECTED" ? body.notes : handover.rejectedReason,
      },
    });

    return c.json({ success: true, data: { handover: {
      id: updated.id, status: updated.status, notes: updated.notes,
      acceptedAt: updated.acceptedAt?.toISOString() || null,
      rejectedAt: updated.rejectedAt?.toISOString() || null,
    } } });
  });

  return routes;
}
