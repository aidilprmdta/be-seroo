import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";
import { getDailyRange, getMonthlyRange, toJakartaDateString } from "../src/reports/service.js";

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

function createReportDatabase(membershipsMap = new Map([["outlet-a", "MANAGER"]])) {
  const state = {
    orders: [],
    expenses: [],
  };

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
        const role = membershipsMap.get(where.userId_outletId.outletId);
        if (!role) return null;
        return {
          role,
          outlet: {
            isActive: where.userId_outletId.outletId !== "outlet-inactive",
          },
        };
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
            subtotal: new Prisma.Decimal(order.subtotal.toString()),
            items: (order.items || []).map((item) => ({
              ...item,
              unitPrice: new Prisma.Decimal(item.unitPrice.toString()),
              subtotal: new Prisma.Decimal(item.subtotal.toString()),
            })),
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
          }));
      },
    },
  };

  return { prisma, state };
}

test("timezone helper calculates exact Asia/Jakarta boundaries without DST", () => {
  const daily = getDailyRange("2026-11-13");
  // 2026-11-13 00:00:00+07:00 is 2026-11-12 17:00:00 UTC
  assert.equal(daily.start.toISOString(), "2026-11-12T17:00:00.000Z");
  // 2026-11-14 00:00:00+07:00 is 2026-11-13 17:00:00 UTC
  assert.equal(daily.end.toISOString(), "2026-11-13T17:00:00.000Z");

  const monthly = getMonthlyRange("2026-11");
  // 2026-11-01 00:00:00+07:00 is 2026-10-31 17:00:00 UTC
  assert.equal(monthly.start.toISOString(), "2026-10-31T17:00:00.000Z");
  // 2026-12-01 00:00:00+07:00 is 2026-11-30 17:00:00 UTC
  assert.equal(monthly.end.toISOString(), "2026-11-30T17:00:00.000Z");

  // Conversion back to Jakarta date
  assert.equal(toJakartaDateString(new Date("2026-11-12T17:00:00.000Z")), "2026-11-13");
  assert.equal(toJakartaDateString(new Date("2026-11-12T16:59:59.000Z")), "2026-11-12");
});

test("daily report computes sales from completed POS orders, payment breakdown, products, expenses, and summary", async () => {
  const { prisma, state } = createReportDatabase();
  const token = createTestToken();

  // Order 1: Completed Cash on 2026-11-13 09:00 WIB (02:00 UTC)
  state.orders.push({
    id: "order-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "40000.00",
    total: "40000.00",
    createdAt: new Date("2026-11-13T02:00:00.000Z"),
    items: [
      {
        productVariantId: "var-1",
        productName: "Kopi Susu",
        variantName: "Regular",
        quantity: 2,
        unitPrice: "15000.00",
        subtotal: "30000.00",
      },
      {
        productVariantId: "var-2",
        productName: "Kopi Susu",
        variantName: "Large",
        quantity: 1,
        unitPrice: "10000.00",
        subtotal: "10000.00",
      },
    ],
  });

  // Order 2: Completed QRIS on 2026-11-13 14:00 WIB (07:00 UTC)
  state.orders.push({
    id: "order-2",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "QRIS",
    paymentStatus: "RECORDED",
    subtotal: "20000.00",
    total: "20000.00",
    createdAt: new Date("2026-11-13T07:00:00.000Z"),
    items: [
      {
        productVariantId: "var-1",
        productName: "Kopi Susu",
        variantName: "Regular",
        quantity: 1,
        unitPrice: "15000.00",
        subtotal: "15000.00",
      },
      {
        productVariantId: "var-3",
        productName: "Matcha Latte",
        variantName: "Large",
        quantity: 1,
        unitPrice: "5000.00",
        subtotal: "5000.00",
      },
    ],
  });

  // Order 3: Cancelled order (MUST BE EXCLUDED)
  state.orders.push({
    id: "order-3",
    outletId: "outlet-a",
    status: "CANCELLED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "50000.00",
    total: "50000.00",
    createdAt: new Date("2026-11-13T08:00:00.000Z"),
    items: [],
  });

  // Order 4: Completed order on DIFFERENT outlet (MUST BE EXCLUDED)
  state.orders.push({
    id: "order-4",
    outletId: "outlet-other",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "99000.00",
    total: "99000.00",
    createdAt: new Date("2026-11-13T08:00:00.000Z"),
    items: [],
  });

  // Order 5: Completed order outside 2026-11-13 boundary in Asia/Jakarta (2026-11-12 23:59:00 WIB = 16:59:00 UTC)
  state.orders.push({
    id: "order-5",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "30000.00",
    total: "30000.00",
    createdAt: new Date("2026-11-12T16:59:00.000Z"),
    items: [],
  });

  // Expense 1: Active expense for outlet-a on 2026-11-13
  state.expenses.push({
    id: "exp-1",
    outletId: "outlet-a",
    categoryId: "cat-1",
    amount: "15000.00",
    expenseDate: new Date("2026-11-13T03:00:00.000Z"),
    status: "ACTIVE",
    category: { id: "cat-1", name: "Es Batu" },
  });

  // Expense 2: Cancelled expense (MUST BE EXCLUDED)
  state.expenses.push({
    id: "exp-2",
    outletId: "outlet-a",
    categoryId: "cat-1",
    amount: "70000.00",
    expenseDate: new Date("2026-11-13T04:00:00.000Z"),
    status: "CANCELLED",
    category: { id: "cat-1", name: "Es Batu" },
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/daily?date=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.outletId, "outlet-a");
  assert.equal(body.data.period.date, "2026-11-13");
  assert.equal(body.data.period.timezone, "Asia/Jakarta");

  // Summary
  // Total Income: 40,000 + 20,000 = 60,000
  assert.equal(body.data.summary.totalIncome, "60000.00");
  assert.equal(body.data.summary.totalExpense, "15000.00");
  assert.equal(body.data.summary.netBalance, "45000.00");
  assert.equal(body.data.summary.transactionCount, 2);
  assert.equal(body.data.summary.expenseCount, 1);

  // Payment Breakdown
  assert.equal(body.data.paymentSummary.cash.count, 1);
  assert.equal(body.data.paymentSummary.cash.total, "40000.00");
  assert.equal(body.data.paymentSummary.qris.count, 1);
  assert.equal(body.data.paymentSummary.qris.total, "20000.00");

  // Product and Variant/Size Breakdown
  // Kopi Susu Regular: 2 + 1 = 3 units (subtotal 45,000)
  // Kopi Susu Large: 1 unit (subtotal 10,000)
  // Matcha Latte Large: 1 unit (subtotal 5,000)
  assert.equal(body.data.productSales.length, 3);
  const first = body.data.productSales[0];
  assert.equal(first.productName, "Kopi Susu");
  assert.equal(first.variantName, "Regular");
  assert.equal(first.quantity, 3);
  assert.equal(first.total, "45000.00");

  // Expenses
  assert.equal(body.data.expenseSummary.total, "15000.00");
  assert.equal(body.data.expenseSummary.categories.length, 1);
  assert.equal(body.data.expenseSummary.categories[0].categoryName, "Es Batu");
});

test("monthly report aggregates across the month and returns daily breakdown", async () => {
  const { prisma, state } = createReportDatabase();
  const token = createTestToken();

  // Order on Nov 1
  state.orders.push({
    id: "ord-nov-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "25000.00",
    total: "25000.00",
    createdAt: new Date("2026-11-01T04:00:00.000Z"),
    items: [],
  });

  // Order on Nov 15
  state.orders.push({
    id: "ord-nov-15",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "QRIS",
    paymentStatus: "RECORDED",
    subtotal: "35000.00",
    total: "35000.00",
    createdAt: new Date("2026-11-15T04:00:00.000Z"),
    items: [],
  });

  // Expense on Nov 15
  state.expenses.push({
    id: "exp-nov-15",
    outletId: "outlet-a",
    categoryId: "cat-1",
    amount: "10000.00",
    expenseDate: new Date("2026-11-15T05:00:00.000Z"),
    status: "ACTIVE",
    category: { id: "cat-1", name: "Operasional" },
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  const response = await app.request(
    "/api/v1/outlets/outlet-a/reports/monthly?month=2026-11",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.period.month, "2026-11");
  assert.equal(body.data.summary.totalIncome, "60000.00");
  assert.equal(body.data.summary.totalExpense, "10000.00");
  assert.equal(body.data.summary.netBalance, "50000.00");
  assert.equal(body.data.summary.transactionCount, 2);

  // Daily breakdown
  assert.equal(body.data.dailyBreakdown.length, 2);
  assert.equal(body.data.dailyBreakdown[0].date, "2026-11-01");
  assert.equal(body.data.dailyBreakdown[0].totalIncome, "25000.00");
  assert.equal(body.data.dailyBreakdown[0].totalExpense, "0.00");

  assert.equal(body.data.dailyBreakdown[1].date, "2026-11-15");
  assert.equal(body.data.dailyBreakdown[1].totalIncome, "35000.00");
  assert.equal(body.data.dailyBreakdown[1].totalExpense, "10000.00");
  assert.equal(body.data.dailyBreakdown[1].netBalance, "25000.00");
});

test("reports enforce role authorization: Owner can read, Crew is forbidden", async () => {
  // Test with Owner role
  const { prisma: ownerPrisma } = createReportDatabase(new Map([["outlet-a", "OWNER"]]));
  const token = createTestToken();

  const ownerApp = createApp({
    prisma: ownerPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  const ownerRes = await ownerApp.request(
    "/api/v1/outlets/outlet-a/reports/daily?date=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(ownerRes.status, 200);

  // Test with Crew role
  const { prisma: crewPrisma } = createReportDatabase(new Map([["outlet-a", "CREW"]]));
  const crewApp = createApp({
    prisma: crewPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  const crewRes = await crewApp.request(
    "/api/v1/outlets/outlet-a/reports/daily?date=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(crewRes.status, 403);
  const crewBody = await crewRes.json();
  assert.equal(crewBody.error.code, "FORBIDDEN");
});

test("reports reject invalid date or month formats with 400 validation error", async () => {
  const { prisma } = createReportDatabase();
  const token = createTestToken();

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  const badDateRes = await app.request(
    "/api/v1/outlets/outlet-a/reports/daily?date=not-a-date",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(badDateRes.status, 400);

  const badMonthRes = await app.request(
    "/api/v1/outlets/outlet-a/reports/monthly?month=2026-15",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(badMonthRes.status, 400);
});
