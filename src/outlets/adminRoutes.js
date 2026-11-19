// Admin outlet management — hanya Admin Pusat boleh membuat/mengubah outlet.
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";

export class OutletAdminError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "OutletAdminError";
    this.code = code;
    this.status = status;
  }
}

const createOutletSchema = z.object({
  code: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Kode hanya huruf, angka, -, _"),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
});

const updateOutletSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
});

async function requireAdminPusat(prisma, userId) {
  const adminMembership = await prisma.outletMembership.findFirst({
    where: { userId, role: "ADMIN_PUSAT" },
  });
  if (!adminMembership) {
    throw new OutletAdminError(
      "FORBIDDEN",
      403,
      "Hanya Admin Pusat yang berwenang mengelola outlet.",
    );
  }
}

function dto(outlet) {
  return {
    id: outlet.id,
    code: outlet.code,
    name: outlet.name,
    address: outlet.address,
    isActive: outlet.isActive,
    createdAt: outlet.createdAt.toISOString(),
    updatedAt: outlet.updatedAt.toISOString(),
  };
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OutletAdminError("VALIDATION_ERROR", 400, "Format permintaan JSON tidak valid.");
    }
    throw error;
  }
}

export function createOutletAdminRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate = authenticationMiddleware ?? createAuthenticationMiddleware({
    prisma,
    accessTokenSecret,
    now,
  });

  routes.post("/outlets", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);

    const input = createOutletSchema.parse(await readJson(c));
    const existing = await prisma.outlet.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new OutletAdminError("OUTLET_CODE_EXISTS", 409, "Kode outlet sudah digunakan.");
    }

    const outlet = await prisma.outlet.create({
      data: {
        code: input.code,
        name: input.name,
        address: input.address ?? null,
        isActive: input.isActive ?? true,
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      action: "OUTLET_CREATED",
      resourceType: "OUTLET",
      resourceId: outlet.id,
      outcome: "SUCCESS",
      metadata: { code: outlet.code, name: outlet.name },
    });

    return c.json({ success: true, data: { outlet: dto(outlet) } }, 201);
  });

  routes.patch("/outlets/:outletId", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);

    const input = updateOutletSchema.parse(await readJson(c));
    const outletId = c.req.param("outletId");
    const current = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!current) {
      throw new OutletAdminError("OUTLET_NOT_FOUND", 404, "Outlet tidak ditemukan.");
    }

    const outlet = await prisma.outlet.update({
      where: { id: outletId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      action: input.isActive === false ? "OUTLET_DEACTIVATED" : "OUTLET_UPDATED",
      resourceType: "OUTLET",
      resourceId: outlet.id,
      outcome: "SUCCESS",
      metadata: input,
    });

    return c.json({ success: true, data: { outlet: dto(outlet) } });
  });

  return routes;
}
