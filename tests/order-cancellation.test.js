import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-14T10:00:00.000Z");

function createTestToken(userId = "user-crew-1", sessionId = "session-1") {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createOrderDatabase(role = "CREW") {
  const state = {
    products: [],
    variants: [],
    recipes: [],
    stocks: [],
    movements: [],
    orders: [],
    orderPayments: [],
    statusHistories: [],
    wasteRecords: [],
    closings: [],
  };

  const memberships = new Map([
    ["outlet-rumbai", role],
    ["outlet-panam", "CREW"],
  ]);

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        if (where.id !== "session-1") return null;
        return {
          id: "session-1",
          userId: "user-crew-1",
          revokedAt: null,
          expiresAt: new Date("2026-11-15T00:00:00.000Z"),
          user: { id: "user-crew-1", isActive: true },
        };
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const membershipRole = memberships.get(where.userId_outletId.outletId);
        if (!membershipRole) return null;
        return {
          role: membershipRole,
          outlet: {
            isActive: true,
          },
        };
      },
    },
    order: {
      async findUnique({ where, include }) {
        let found = null;
        if (where.id) {
          found = state.orders.find((o) => o.id === where.id);
        } else if (where.outletId_crewId_clientTransactionId) {
          const key = where.outletId_crewId_clientTransactionId;
          found = state.orders.find(
            (o) =>
              o.outletId === key.outletId &&
              o.crewId === key.crewId &&
              o.clientTransactionId === key.clientTransactionId,
          );
        }
        if (!found) return null;
        return {
          ...found,
          subtotal: new Prisma.Decimal(found.subtotal.toString()),
          total: new Prisma.Decimal(found.total.toString()),
          items: (found.items || []).map((it) => ({
            ...it,
            unitPrice: new Prisma.Decimal(it.unitPrice.toString()),
            subtotal: new Prisma.Decimal(it.subtotal.toString()),
            addOns: it.addOns || [],
          })),
          payments: state.orderPayments
            .filter((p) => p.orderId === found.id)
            .map((p) => ({
              ...p,
              amount: new Prisma.Decimal(p.amount.toString()),
            })),
          statusHistory: state.statusHistories.filter((h) => h.orderId === found.id),
          cancelledBy: found.cancelledById ? { id: found.cancelledById, name: "Crew Seroo" } : null,
        };
      },
      async findMany({ where }) {
        return state.orders
          .filter((o) => {
            if (where.outletId && o.outletId !== where.outletId) return false;
            if (where.status && o.status !== where.status) return false;
            if (where.paymentStatus && o.paymentStatus !== where.paymentStatus) return false;
            return true;
          })
          .map((o) => ({
            ...o,
            subtotal: new Prisma.Decimal(o.subtotal.toString()),
            total: new Prisma.Decimal(o.total.toString()),
            items: o.items || [],
            payments: state.orderPayments.filter((p) => p.orderId === o.id),
            statusHistory: state.statusHistories.filter((h) => h.orderId === o.id),
          }));
      },
      async update({ where, data, include }) {
        const idx = state.orders.findIndex((o) => o.id === where.id);
        if (idx === -1) throw new Error("Order not found");
        state.orders[idx] = {
          ...state.orders[idx],
          ...data,
        };
        const updated = state.orders[idx];
        return {
          ...updated,
          subtotal: new Prisma.Decimal(updated.subtotal.toString()),
          total: new Prisma.Decimal(updated.total.toString()),
          items: updated.items || [],
          payments: state.orderPayments
            .filter((p) => p.orderId === updated.id)
            .map((p) => ({
              ...p,
              amount: new Prisma.Decimal(p.amount.toString()),
            })),
          statusHistory: state.statusHistories.filter((h) => h.orderId === updated.id),
          cancelledBy: updated.cancelledById ? { id: updated.cancelledById, name: "Crew Seroo" } : null,
        };
      },
    },
    orderPayment: {
      async update({ where, data }) {
        const idx = state.orderPayments.findIndex((p) => p.id === where.id);
        if (idx !== -1) {
          state.orderPayments[idx] = { ...state.orderPayments[idx], ...data };
          return state.orderPayments[idx];
        }
        return null;
      },
    },
    orderStatusHistory: {
      async create({ data }) {
        const history = {
          id: `hist-${state.statusHistories.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date(),
          actor: { id: data.actorId, name: "Crew Seroo" },
        };
        state.statusHistories.push(history);
        return history;
      },
    },
    wasteRecord: {
      async create({ data }) {
        const waste = {
          id: `waste-${state.wasteRecords.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date(),
        };
        state.wasteRecords.push(waste);
        return waste;
      },
    },
    recipe: {
      async findMany({ where }) {
        return state.recipes.filter((r) => where.productVariantId?.in?.includes(r.productVariantId));
      },
    },
    outletStock: {
      async update({ where, data }) {
        const key = where.outletId_inventoryItemId;
        const stock = state.stocks.find(
          (s) => s.outletId === key.outletId && s.inventoryItemId === key.inventoryItemId,
        );
        if (stock) {
          if (data.quantity?.increment) {
            stock.quantity = new Prisma.Decimal(stock.quantity.toString()).add(data.quantity.increment);
          }
          return stock;
        }
        return null;
      },
    },
    stockMovement: {
      async create({ data }) {
        const mov = {
          id: `mov-${state.movements.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date(),
        };
        state.movements.push(mov);
        return mov;
      },
    },
    closingRecord: {
      async findUnique({ where }) {
        const key = where.outletId_closingType_periodKey;
        if (!key) return null;
        return state.closings.find(
          (c) =>
            c.outletId === key.outletId &&
            c.closingType === key.closingType &&
            c.periodKey === key.periodKey,
        ) || null;
      },
    },
    $transaction: async (cb) => cb(prisma),
  };

  return { prisma, state };
}

function buildApp(role = "CREW") {
  const { prisma, state } = createOrderDatabase(role);
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });
  return { app, prisma, state };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("PEMBATALAN PESANAN: Berhasil membatalkan pesanan dengan pencatatan waste (minuman sudah dibuat)", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  // Seed order
  const orderId = "order-123";
  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0010",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "LUNAS",
    subtotal: "18000.00",
    total: "18000.00",
    createdAt: NOW,
    completedAt: NOW,
    items: [
      {
        id: "item-1",
        productVariantId: "var-1",
        productName: "Teh Tarik",
        variantName: "Medium",
        quantity: 1,
        unitPrice: "18000.00",
        subtotal: "18000.00",
      },
    ],
  });

  state.orderPayments.push({
    id: "pay-1",
    orderId,
    paymentMethod: "CASH",
    amount: "18000.00",
    paymentStatus: "LUNAS",
    notes: null,
  });

  // Call cancel endpoint
  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Pelanggan membatalkan pesanan karena menunggu terlalu lama",
      recordWaste: true,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.order.status, "CANCELLED");
  assert.equal(body.data.order.paymentStatus, "REFUNDED");
  assert.equal(body.data.order.cancellationReason, "Pelanggan membatalkan pesanan karena menunggu terlalu lama");
  assert.equal(body.data.order.isWasteRecorded, true);
  assert.ok(body.data.order.cancelledAt);
  assert.equal(body.data.order.cancelledById, "user-crew-1");

  // Check OrderPayment status was refunded
  assert.equal(state.orderPayments[0].paymentStatus, "REFUNDED");
  assert.ok(state.orderPayments[0].notes.includes("Dibatalkan"));

  // Check OrderStatusHistory was recorded
  assert.equal(state.statusHistories.length, 1);
  assert.equal(state.statusHistories[0].fromStatus, "COMPLETED");
  assert.equal(state.statusHistories[0].toStatus, "CANCELLED");
  assert.equal(state.statusHistories[0].reason, "Pelanggan membatalkan pesanan karena menunggu terlalu lama");

  // Check WasteRecord was created
  assert.equal(state.wasteRecords.length, 1);
  assert.equal(state.wasteRecords[0].itemName, "Teh Tarik - Medium");
  assert.equal(state.wasteRecords[0].category, "PRODUK_BATAL");
  assert.equal(state.wasteRecords[0].unit, "cup");
  assert.ok(state.wasteRecords[0].description.includes("SR-0010"));
});

test("PEMBATALAN PESANAN: Pembatalan tanpa waste (minuman belum sempat dibuat) mengembalikan stok resep", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  const orderId = "order-456";
  const variantId = "var-teh-tarik";
  const itemId = "inv-daun-teh";

  // Setup stock & recipe
  state.stocks.push({
    outletId: "outlet-rumbai",
    inventoryItemId: itemId,
    quantity: new Prisma.Decimal("100.000"),
  });

  state.recipes.push({
    productVariantId: variantId,
    inventoryItemId: itemId,
    quantity: new Prisma.Decimal("15.000"),
    inventoryItem: { id: itemId, name: "Daun Teh", unit: "gram" },
  });

  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0011",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "LUNAS",
    subtotal: "15000.00",
    total: "15000.00",
    createdAt: NOW,
    completedAt: NOW,
    items: [
      {
        id: "item-1",
        productVariantId: variantId,
        productName: "Teh Tarik",
        variantName: "Regular",
        quantity: 2,
        unitPrice: "7500.00",
        subtotal: "15000.00",
      },
    ],
  });

  state.orderPayments.push({
    id: "pay-2",
    orderId,
    paymentMethod: "CASH",
    amount: "15000.00",
    paymentStatus: "LUNAS",
  });

  // Cancel with recordWaste = false (drink not made yet)
  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Pelanggan salah pesan dan minta ganti sebelum dibuat",
      recordWaste: false,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.order.status, "CANCELLED");
  assert.equal(body.data.order.isWasteRecorded, false);

  // Stock should be refunded: 15g * 2 = 30g returned -> 100 + 30 = 130
  assert.equal(state.stocks[0].quantity.toString(), "130");

  // StockMovement IN logged
  assert.equal(state.movements.length, 1);
  assert.equal(state.movements[0].type, "IN");
  assert.equal(state.movements[0].quantity.toString(), "30");
  assert.ok(state.movements[0].note.includes("Pengembalian stok"));

  // No waste record created
  assert.equal(state.wasteRecords.length, 0);
});

test("PEMBATALAN PESANAN: Validasi alasan wajib diisi minimal 5 karakter", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  const orderId = "order-val";
  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0012",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "LUNAS",
    subtotal: "10000.00",
    total: "10000.00",
    createdAt: NOW,
    items: [],
  });

  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Btl", // < 5 karakter
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message.includes("minimal 5 karakter"));
});

test("PEMBATALAN PESANAN: Transaksi yang sudah CANCELLED tidak bisa dibatalkan ulang (400)", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  const orderId = "order-already-cancelled";
  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0013",
    status: "CANCELLED",
    paymentMethod: "CASH",
    paymentStatus: "REFUNDED",
    subtotal: "10000.00",
    total: "10000.00",
    createdAt: NOW,
    items: [],
  });

  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Membatalkan ulang transaksi yang sudah batal",
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "ORDER_ALREADY_CANCELLED");
});

test("PEMBATALAN PESANAN: Menolak pembatalan jika periode transaksi sudah ditutup closing (PERIOD_CLOSED)", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  const orderId = "order-closed-period";
  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0014",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "LUNAS",
    subtotal: "10000.00",
    total: "10000.00",
    createdAt: NOW, // 2026-11-14
    items: [],
  });

  // Closing record CLOSED for 2026-11-14
  state.closings.push({
    id: "cls-1",
    outletId: "outlet-rumbai",
    closingType: "DAILY",
    periodKey: "2026-11-14",
    status: "CLOSED",
  });

  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Pelanggan komplain kemarin",
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "PERIOD_CLOSED");
  assert.ok(body.error.message.includes("Reopen"));
});

test("PEMBATALAN PESANAN: Akses ditolak untuk outlet lain (403)", async () => {
  const { app, state } = buildApp("CREW"); // Crew di outlet-rumbai
  const token = createTestToken();

  const orderId = "order-panam";
  state.orders.push({
    id: orderId,
    outletId: "outlet-panam",
    crewId: "user-crew-2",
    orderNumber: "SR-PANAM-01",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "LUNAS",
    subtotal: "10000.00",
    total: "10000.00",
    createdAt: NOW,
    items: [],
  });

  // Call cancel for outlet-panam where user has no access or is trying cross-outlet
  const res = await app.request(`/api/v1/outlets/outlet-unknown/orders/${orderId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "Percobaan akses tidak berwenang",
    }),
  });

  assert.equal(res.status, 403);
});

test("GET ORDER DETAIL: Dapat mengambil detail pesanan lengkap beserta statusHistory", async () => {
  const { app, state } = buildApp("CREW");
  const token = createTestToken();

  const orderId = "order-detail-1";
  state.orders.push({
    id: orderId,
    outletId: "outlet-rumbai",
    crewId: "user-crew-1",
    orderNumber: "SR-0099",
    status: "COMPLETED",
    paymentMethod: "SPLIT",
    paymentStatus: "LUNAS",
    subtotal: "30000.00",
    total: "30000.00",
    createdAt: NOW,
    items: [],
  });

  state.statusHistories.push({
    id: "hist-1",
    orderId,
    fromStatus: "COMPLETED",
    toStatus: "COMPLETED",
    reason: "Pesanan dibuat",
    actorId: "user-crew-1",
    createdAt: NOW,
    actor: { id: "user-crew-1", name: "Crew Seroo" },
  });

  const res = await app.request(`/api/v1/outlets/outlet-rumbai/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.order.orderNumber, "SR-0099");
  assert.equal(body.data.order.statusHistory.length, 1);
  assert.equal(body.data.order.statusHistory[0].reason, "Pesanan dibuat");
});

