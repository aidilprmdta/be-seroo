// ShopeeFood API routes - backend (BE)
// Flow: crew/manager menerima pesanan dari platform eksternal (ShopeeFood/Grab)

import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { PosError } from "./errors.js";

const shopeeItemSchema = z
  .object({
    productId: z.string().min(1).max(64),
    variantId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(99),
    unitPrice: z.string().max(13).regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/),
    name: z.string().min(1).max(128),
  })
  .strict();

const shopeeOrderSchema = z
  .object({
    platformOrderId: z.string().min(1).max(128),
    driverName: z.string().min(1).max(128).optional(),
    driverPhone: z.string().min(6).max(32).optional(),
    shipperName: z.string().min(1).max(128).optional(),
    shipperPhone: z.string().min(6).max(32).optional(),
    deliveryAddress: z.string().max(255).optional(),
    estimatedArrival: z.string().datetime().optional(),
    items: z.array(shopeeItemSchema).min(1).max(100),
    paymentMethod: z.enum(["CASH", "QRIS", "SPLIT"]).default("CASH"),
    paymentAmount: z.string().max(13).regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/),
    notes: z.string().max(255).optional(),
    platformStatus: z.enum(["PENDING", "PICKED", "DELIVERED", "SETTLED", "CANCELLED"]).default("PENDING"),
  })
  .strict();

function readBody(c) {
  return shopeeOrderSchema.safeParse(c.req.json()).data;
}

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

export function createShopeeFoodRoutes({
  prisma,
  accessTokenSecret,
}) {
  const routes = new Hono();
  const authenticate = createAuthenticationMiddleware({ prisma, accessTokenSecret });

  // LIST shopee orders
  routes.get("/:outletId/shopee-orders", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    const params = {
      where: { outletId },
      orderBy: { createdAt: "desc" },
      include: { order: true },
    };

    if (c.req.query("platformStatus")) {
      params.where.platformStatus = c.req.query("platformStatus");
    }

    const orders = await prisma.shopeeFoodOrder.findMany(params);
    const mapped = orders.map((o) => ({
      id: o.id,
      orderId: o.orderId,
      platformOrderId: o.platformOrderId,
      platformStatus: o.platformStatus,
      driverName: o.driverName,
      driverPhone: o.driverPhone,
      shipperName: o.shipperName,
      shipperPhone: o.shipperPhone,
      deliveryAddress: o.deliveryAddress,
      estimatedArrival: o.estimatedArrival?.toISOString() || null,
      totalAmount: o.totalAmount.toString(),
      items: o.items,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt.toISOString(),
      notifications: o.order?.payments?.map((p) => ({ id: p.id, type: p.paymentMethod, amount: p.amount, status: p.paymentStatus })) || [],
    }));

    return c.json({ success: true, data: { orders: mapped, count: mapped.length } });
  });

  // GET detail shopee order
  routes.get("/:outletId/orders/:orderId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    const order = await prisma.shopeeFoodOrder.findFirst({
      where: { id: orderId, outletId },
      include: { order: true },
    });
    if (!order) throw new PosError("ORDER_NOT_FOUND", 404, "Pesanan tidak ditemukan.");

    return c.json({ success: true, data: { order: {
      id: order.id,
      orderId: order.orderId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus,
      driverName: order.driverName,
      driverPhone: order.driverPhone,
      shipperName: order.shipperName,
      shipperPhone: order.shipperPhone,
      deliveryAddress: order.deliveryAddress,
      estimatedArrival: order.estimatedArrival?.toISOString() || null,
      totalAmount: order.totalAmount.toString(),
      items: order.items,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      notes: order.notes,
      pickedAt: order.pickedAt?.toISOString() || null,
      deliveredAt: order.deliveredAt?.toISOString() || null,
      settledAt: order.settledAt?.toISOString() || null,
      createdAt: order.createdAt.toISOString(),
      notifications: order.order?.payments?.map((p) => ({ id: p.id, type: p.paymentMethod, amount: p.amount, status: p.paymentStatus })) || [],
    } } });
  });

  // PATCH status shopee order (pickup, delivered, settled, cancelled)
  routes.patch("/:outletId/orders/:orderId/status", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const orderId = c.req.param("orderId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletMembership(prisma, auth.userId, outletId);

    let body;
    try {
      body = z.object({
        platformStatus: z.enum(["PENDING", "PICKED", "DELIVERED", "SETTLED", "CANCELLED"]),
        notes: z.string().max(255).optional(),
      }).parse(await c.req.json());
    } catch (err) {
      if (err instanceof z.ZodError) throw new PosError("VALIDATION_ERROR", 400, err.issues[0].message);
      throw err;
    }

    const order = await prisma.shopeeFoodOrder.findFirst({
      where: { id: orderId, outletId },
      include: { order: true },
    });
    if (!order) throw new PosError("ORDER_NOT_FOUND", 404, "Pesanan tidak ditemukan.");

    const updated = await prisma.shopeeFoodOrder.update({
      where: { id: orderId },
      data: {
        platformStatus: body.platformStatus,
        notes: body.notes,
        pickedAt: body.platformStatus === "PICKED" ? new Date() : null,
        deliveredAt: body.platformStatus === "DELIVERED" ? new Date() : null,
        settledAt: body.platformStatus === "SETTLED" ? new Date() : null,
        cancelledAt: body.platformStatus === "CANCELLED" ? new Date() : null,
      },
    });

    return c.json({ success: true, data: { order: {
      id: updated.id, platformStatus: updated.platformStatus, notes: updated.notes,
      pickedAt: updated.pickedAt?.toISOString() || null,
      deliveredAt: updated.deliveredAt?.toISOString() || null,
      settledAt: updated.settledAt?.toISOString() || null,
      cancelledAt: updated.cancelledAt?.toISOString() || null,
    } } });
  });

  return routes;
}
