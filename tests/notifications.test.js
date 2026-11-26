import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createNotificationRoutes } from "../src/notifications/routes.js";
import { NotificationError } from "../src/notifications/errors.js";

function createPrisma({ role = "MANAGER" } = {}) {
  return {
    outletMembership: {
      findUnique: async ({ where }) =>
        role === "NONE"
          ? null
          : { role, outlet: { isActive: true } },
    },
    outletStock: {
      findMany: async () => [
        {
          inventoryItemId: "item-1",
          quantity: "0",
          minimumQuantity: "5",
          updatedAt: new Date("2026-11-25T08:00:00Z"),
          inventoryItem: { name: "Es Batu", unit: "kg" },
        },
        {
          inventoryItemId: "item-2",
          quantity: "10",
          minimumQuantity: "0",
          updatedAt: new Date("2026-11-25T08:00:00Z"),
          inventoryItem: { name: "Galon", unit: "pcs" },
        },
      ],
    },
    lossReport: {
      findMany: async () => [
        {
          id: "loss-1",
          itemName: "Cup",
          quantity: "12",
          unit: "pcs",
          createdAt: new Date("2026-11-25T07:00:00Z"),
          reportedBy: { name: "Crew Rumbai" },
        },
      ],
    },
    wasteRecord: {
      findMany: async () => [
        {
          id: "waste-1",
          itemName: "Teh Tarik",
          quantity: "1",
          unit: "cup",
          category: "Produk Batal",
          createdAt: new Date("2026-11-25T06:00:00Z"),
          createdBy: { name: "Crew Rumbai" },
        },
      ],
    },
    order: {
      findMany: async () => [
        {
          id: "order-1",
          orderNumber: "ORD-001",
          total: "25000",
          createdAt: new Date("2026-11-25T05:00:00Z"),
        },
      ],
    },
  };
}

function createApp(prisma) {
  const authenticate = async (c, next) => {
    c.set("auth", { userId: "user-1", sessionId: "session-1" });
    await next();
  };
  const routes = createNotificationRoutes({
    prisma,
    authenticationMiddleware: authenticate,
    now: () => new Date("2026-11-25T10:00:00Z"),
  });
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof NotificationError) {
      return c.json(
        { success: false, error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    return c.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
  });
  return app.route("/api/v1/outlets", routes);
}

test("manager receives stock, loss, waste, and QRIS notifications sorted by severity", async () => {
  const app = createApp(createPrisma());
  const response = await app.request("/api/v1/outlets/outlet-a/notifications");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.count, 4);

  const types = body.data.notifications.map((n) => n.type);
  assert.deepEqual(types, ["STOCK", "LOSS_REPORT", "QRIS_PENDING", "WASTE"]);

  const stock = body.data.notifications[0];
  assert.equal(stock.severity, "CRITICAL");
  assert.equal(stock.title, "Stok Es Batu habis");
  assert.equal(stock.body, "Sisa 0 kg. Ajukan permintaan stok.");

  const qris = body.data.notifications.find((n) => n.type === "QRIS_PENDING");
  assert.ok(qris.body.includes("25000"));
});

test("crew only receives their own pending QRIS notifications", async () => {
  const prisma = createPrisma({ role: "CREW" });
  let orderWhere = null;
  prisma.order.findMany = async ({ where }) => {
    orderWhere = where;
    return [];
  };

  const app = createApp(prisma);
  const response = await app.request("/api/v1/outlets/outlet-a/notifications");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.count, 0);
  assert.equal(orderWhere.crewId, "user-1");
  assert.equal(orderWhere.paymentStatus, "PENDING_RECONCILIATION");
});

test("non-member outlet is rejected with 403", async () => {
  const app = createApp(createPrisma({ role: "NONE" }));
  const response = await app.request("/api/v1/outlets/outlet-a/notifications");
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "FORBIDDEN");
});

test("inactive outlet membership is rejected", async () => {
  const prisma = createPrisma();
  prisma.outletMembership.findUnique = async () => ({
    role: "MANAGER",
    outlet: { isActive: false },
  });

  const app = createApp(prisma);
  const response = await app.request("/api/v1/outlets/outlet-a/notifications");
  assert.equal(response.status, 403);
});
