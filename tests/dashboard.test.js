import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");

function createTestToken(userId = "user-1", sessionId = "session-1") {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createDashboardDatabase(role = "MANAGER") {
  const state = {
    outlets: [
      { id: "outlet-a", name: "Seroo Rumbai", code: "SR-01", isActive: true },
      { id: "outlet-inactive", name: "Seroo Tutup", code: "SR-02", isActive: false },
    ],
    orders: [],
    expenses: [],
    items: [
      { id: "item-1", name: "Kopi Arabika", unit: "kg", isActive: true },
      { id: "item-2", name: "Susu Full Cream", unit: "liter", isActive: true },
      { id: "item-3", name: "Gula Aren", unit: "kg", isActive: true },
    ],
    stocks: [
      { outletId: "outlet-a", inventoryItemId: "item-1", quantity: "2.000" }, // Low stock!
      { outletId: "outlet-a", inventoryItemId: "item-2", quantity: "20.000" }, // Safe stock
      { outletId: "outlet-a", inventoryItemId: "item-3", quantity: "0.000" }, // Out of stock!
    ],
    waste: [],
    closings: [],
    stockRequests: [],
  };

  const memberships = new Map([
    ["outlet-a", role],
    ["outlet-inactive", role],
  ]);

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        if (where.id !== "session-1") return null;
        return {
          id: "session-1",
          userId: "user-1",
          revokedAt: null,
          expiresAt: new Date("2026-11-15T00:00:00.000Z"),
          user: { id: "user-1", isActive: true },
        };
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const memRole = memberships.get(where.userId_outletId.outletId);
        if (!memRole) return null;
        const outlet = state.outlets.find((o) => o.id === where.userId_outletId.outletId);
        return {
          role: memRole,
          outlet: {
            isActive: outlet?.isActive ?? false,
          },
        };
      },
    },
    outlet: {
      async findUnique({ where }) {
        return state.outlets.find((o) => o.id === where.id) || null;
      },
    },
    order: {
      async findMany({ where }) {
        return state.orders
          .filter((order) => {
            if (where.outletId && order.outletId !== where.outletId) return false;
            if (where.status && order.status !== where.status) return false;
            if (where.createdAt) {
              if (where.createdAt.gte && order.createdAt < where.createdAt.gte) return false;
              if (where.createdAt.lt && order.createdAt >= where.createdAt.lt) return false;
            }
            return true;
          })
          .map((order) => ({
            ...order,
            total: new Prisma.Decimal(order.total.toString()),
            crew: { id: "crew-1", name: "Crew Seroo" },
          }));
      },
    },
    expense: {
      async findMany({ where }) {
        return state.expenses
          .filter((exp) => {
            if (where.outletId && exp.outletId !== where.outletId) return false;
            if (where.status && exp.status !== where.status) return false;
            if (where.expenseDate) {
              if (where.expenseDate.gte && exp.expenseDate < where.expenseDate.gte) return false;
              if (where.expenseDate.lt && exp.expenseDate >= where.expenseDate.lt) return false;
            }
            return true;
          })
          .map((exp) => ({
            ...exp,
            amount: new Prisma.Decimal(exp.amount.toString()),
            category: { id: "cat-1", name: exp.categoryName || "Operasional" },
            createdBy: { id: "user-1", name: "Manager Seroo" },
          }));
      },
    },
    inventoryItem: {
      async findMany({ where }) {
        return state.items.filter((item) => {
          if (where?.isActive !== undefined && item.isActive !== where.isActive) return false;
          return true;
        });
      },
    },
    outletStock: {
      async findMany({ where }) {
        return state.stocks
          .filter((s) => s.outletId === where.outletId)
          .map((s) => ({
            ...s,
            quantity: new Prisma.Decimal(s.quantity),
          }));
      },
    },
    wasteRecord: {
      async findMany({ where }) {
        return state.waste
          .filter((w) => {
            if (where.outletId && w.outletId !== where.outletId) return false;
            if (where.wasteDate) {
              if (where.wasteDate.gte && w.wasteDate < where.wasteDate.gte) return false;
              if (where.wasteDate.lt && w.wasteDate >= where.wasteDate.lt) return false;
            }
            return true;
          })
          .map((w) => ({
            ...w,
            quantity: new Prisma.Decimal(w.quantity),
          }));
      },
    },
    closingRecord: {
      async findUnique({ where }) {
        const key = where.outletId_closingType_periodKey;
        if (!key) return null;
        return (
          state.closings.find(
            (c) =>
              c.outletId === key.outletId &&
              c.closingType === key.closingType &&
              c.periodKey === key.periodKey,
          ) || null
        );
      },
      async findMany({ where }) {
        return state.closings.filter((c) => c.outletId === where.outletId);
      },
    },
    outletStockRequest: {
      async findMany({ where }) {
        return state.stockRequests.filter((r) => r.outletId === where.outletId);
      },
    },
  };

  return { prisma, state };
}

test("dashboard endpoint returns sales, expenses, stock alerts, waste, closing status, and activities", async () => {
  const { prisma, state } = createDashboardDatabase("MANAGER");
  const token = createTestToken();

  // POS Order Today
  state.orders.push({
    id: "ord-1",
    orderNumber: "SR-0001",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    total: "40000.00",
    createdAt: new Date("2026-11-13T03:00:00.000Z"),
  });

  state.orders.push({
    id: "ord-2",
    orderNumber: "SR-0002",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "QRIS",
    paymentStatus: "PENDING_RECONCILIATION",
    total: "25000.00",
    createdAt: new Date("2026-11-13T06:00:00.000Z"),
  });

  // Expense Today
  state.expenses.push({
    id: "exp-1",
    outletId: "outlet-a",
    categoryName: "Bahan Baku",
    amount: "15000.00",
    status: "ACTIVE",
    expenseDate: new Date("2026-11-13T04:00:00.000Z"),
    createdAt: new Date("2026-11-13T04:00:00.000Z"),
  });

  // Waste Today
  state.waste.push({
    id: "w-1",
    outletId: "outlet-a",
    itemName: "Susu Rusak",
    quantity: "1.000",
    unit: "liter",
    category: "Basi",
    wasteDate: new Date("2026-11-13T05:00:00.000Z"),
    createdAt: new Date("2026-11-13T05:00:00.000Z"),
  });

  // Closing
  state.closings.push({
    id: "cls-1",
    outletId: "outlet-a",
    closingType: "DAILY",
    periodKey: "2026-11-13",
    status: "CLOSED",
    version: 1,
    closedById: "user-1",
    closedBy: { id: "user-1", name: "Manager Seroo" },
    closedAt: new Date("2026-11-13T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T10:00:00.000Z"),
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    dashboardOptions: { now: () => NOW },
  });

  const res = await app.request("/api/v1/outlets/outlet-a/dashboard", {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.outlet.id, "outlet-a");
  assert.equal(body.data.outlet.code, "SR-01");

  // Sales
  assert.equal(body.data.sales.totalIncome, "65000.00");
  assert.equal(body.data.sales.transactionCount, 2);
  assert.equal(body.data.sales.cash.count, 1);
  assert.equal(body.data.sales.cash.total, "40000.00");
  assert.equal(body.data.sales.qris.count, 1);
  assert.equal(body.data.sales.qris.total, "25000.00");
  assert.equal(body.data.sales.qris.pendingReconciliationCount, 1);

  // Expenses & Net
  assert.equal(body.data.expenses.totalExpense, "15000.00");
  assert.equal(body.data.netBalance, "50000.00");

  // Stock
  assert.equal(body.data.stock.totalItems, 3);
  assert.equal(body.data.stock.lowStockCount, 2); // Kopi Arabika (2) and Gula Aren (0)

  // Waste
  assert.equal(body.data.waste.todayCount, 1);
  assert.equal(body.data.waste.todayQuantity, "1.000");

  // Closing status
  assert.equal(body.data.closingStatus.daily.status, "CLOSED");
  assert.equal(body.data.closingStatus.daily.version, 1);
  assert.equal(body.data.closingStatus.monthly.status, "OPEN");

  // Activities
  assert.ok(body.data.activities.length >= 3);
});

test("dashboard authorization: Owner can view, Crew is forbidden", async () => {
  const token = createTestToken();

  // Owner is allowed
  const { prisma: ownerPrisma } = createDashboardDatabase("OWNER");
  const ownerApp = createApp({
    prisma: ownerPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    dashboardOptions: { now: () => NOW },
  });

  const ownerRes = await ownerApp.request("/api/v1/outlets/outlet-a/dashboard", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(ownerRes.status, 200);

  // Crew is forbidden
  const { prisma: crewPrisma } = createDashboardDatabase("CREW");
  const crewApp = createApp({
    prisma: crewPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    dashboardOptions: { now: () => NOW },
  });

  const crewRes = await crewApp.request("/api/v1/outlets/outlet-a/dashboard", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(crewRes.status, 403);
});

