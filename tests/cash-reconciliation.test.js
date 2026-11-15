import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");
const PERIOD_KEY = "2026-11-13";

function createTestToken(userId = "user-1", sessionId = "session-1") {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createDb(role = "MANAGER") {
  const state = {
    cashOpenings: [],
    orders: [],
    expenses: [],
    closings: [],
    histories: [],
    audits: [],
  };

  const memberships = new Map([
    ["outlet-a", role],
    ["outlet-inactive", "MANAGER"],
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
        const r = memberships.get(where.userId_outletId.outletId);
        if (!r) return null;
        return {
          role: r,
          outlet: {
            isActive: where.userId_outletId.outletId !== "outlet-inactive",
          },
        };
      },
    },
    cashOpening: {
      async upsert({ where, create, update, include }) {
        const idx = state.cashOpenings.findIndex(
          (co) =>
            co.outletId === where.outletId_periodKey.outletId &&
            co.periodKey === where.outletId_periodKey.periodKey,
        );
        if (idx !== -1) {
          state.cashOpenings[idx] = {
            ...state.cashOpenings[idx],
            ...update,
            updatedAt: new Date(),
          };
          const co = state.cashOpenings[idx];
          return {
            ...co,
            openingCash: new Prisma.Decimal(co.openingCash.toString()),
            openedAt: co.openedAt || new Date(),
            openedBy: { id: co.openedById, name: "Manager Seroo" },
          };
        }
        const newCo = {
          id: `co-${state.cashOpenings.length + 1}`,
          ...create,
          openedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.cashOpenings.push(newCo);
        return {
          ...newCo,
          openingCash: new Prisma.Decimal(newCo.openingCash.toString()),
          openedBy: { id: newCo.openedById, name: "Manager Seroo" },
        };
      },
      async findUnique({ where, include }) {
        const co = state.cashOpenings.find(
          (c) =>
            c.outletId === where.outletId_periodKey.outletId &&
            c.periodKey === where.outletId_periodKey.periodKey,
        );
        if (!co) return null;
        return {
          ...co,
          openingCash: new Prisma.Decimal(co.openingCash.toString()),
          openedAt: co.openedAt || new Date(),
          openedBy: { id: co.openedById, name: "Manager Seroo" },
        };
      },
    },
    order: {
      async findMany({ where }) {
        return state.orders
          .filter((o) => {
            if (where.outletId && o.outletId !== where.outletId) return false;
            if (where.status && o.status !== where.status) return false;
            if (where.paymentStatus && o.paymentStatus !== where.paymentStatus)
              return false;
            if (where.createdAt) {
              if (where.createdAt.gte && o.createdAt < where.createdAt.gte)
                return false;
              if (where.createdAt.lt && o.createdAt >= where.createdAt.lt)
                return false;
            }
            return true;
          })
          .map((o) => ({
            ...o,
            total: new Prisma.Decimal(o.total.toString()),
            subtotal: new Prisma.Decimal(o.subtotal.toString()),
            crew: { id: "user-1", name: "Manager Seroo" },
            items: (o.items || []).map((it) => ({
              ...it,
              unitPrice: new Prisma.Decimal(it.unitPrice.toString()),
              subtotal: new Prisma.Decimal(it.subtotal.toString()),
            })),
          }));
      },
    },
    expense: {
      async findMany({ where }) {
        return state.expenses
          .filter((e) => {
            if (where.outletId && e.outletId !== where.outletId) return false;
            if (where.status && e.status !== where.status) return false;
            if (where.expenseDate) {
              if (where.expenseDate.gte && e.expenseDate < where.expenseDate.gte)
                return false;
              if (where.expenseDate.lt && e.expenseDate >= where.expenseDate.lt)
                return false;
            }
            return true;
          })
          .map((e) => ({ ...e, amount: new Prisma.Decimal(e.amount.toString()) }));
      },
    },
    closingRecord: {
      async findUnique({ where }) {
        if (where.id) {
          const rec = state.closings.find((c) => c.id === where.id);
          if (!rec) return null;
          return formatClosing(rec);
        }
        const key = where.outletId_closingType_periodKey;
        const rec = state.closings.find(
          (c) =>
            c.outletId === key.outletId &&
            c.closingType === key.closingType &&
            c.periodKey === key.periodKey,
        );
        if (!rec) return null;
        return formatClosing(rec);
      },
      async findFirst({ where }) {
        return (
          state.closings.find((c) => {
            if (where.id && c.id !== where.id) return false;
            if (where.outletId && c.outletId !== where.outletId) return false;
            return true;
          }) || null
        );
      },
      async create({ data }) {
        const rec = {
          id: `closing-${state.closings.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.closings.push(rec);
        return formatClosing(rec);
      },
      async update({ where, data }) {
        const idx = state.closings.findIndex((c) => c.id === where.id);
        if (idx === -1) throw new Error("Closing not found");
        state.closings[idx] = {
          ...state.closings[idx],
          ...data,
          updatedAt: new Date(),
        };
        return formatClosing(state.closings[idx]);
      },
    },
    closingHistory: {
      async create({ data }) {
        const h = {
          id: `hist-${state.histories.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        state.histories.push(h);
        return h;
      },
      async findFirst({ where }) {
        return (
          state.histories.find(
            (h) =>
              h.closingId === where.closingId && h.version === where.version,
          ) || null
        );
      },
      async update({ where, data }) {
        const idx = state.histories.findIndex((h) => h.id === where.id);
        if (idx !== -1)
          state.histories[idx] = { ...state.histories[idx], ...data };
        return state.histories[idx];
      },
    },
    closingAudit: {
      async findUnique({ where }) {
        const key = where.outletId_actorId_clientTransactionId;
        return (
          state.audits.find(
            (a) =>
              a.outletId === key.outletId &&
              a.actorId === key.actorId &&
              a.clientTransactionId === key.clientTransactionId,
          ) || null
        );
      },
      async create({ data }) {
        const a = {
          id: `audit-${state.audits.length + 1}`,
          ...data,
          createdAt: data.createdAt || new Date(),
        };
        state.audits.push(a);
        return a;
      },
    },
    $transaction: async (cb) => cb(prisma),
    _state: state,
  };

  function formatClosing(rec) {
    return {
      ...rec,
      closedBy: { id: rec.closedById, name: "Manager Seroo" },
      reopenedBy: rec.reopenedById
        ? { id: rec.reopenedById, name: "Manager Seroo" }
        : null,
      history: state.histories.filter((h) => h.closingId === rec.id),
      audits: state.audits.filter((a) => a.closingId === rec.id),
    };
  }

  return { prisma, state };
}

// ─── Helper: build app ───────────────────────────────────────────────────────

function buildApp(role = "MANAGER") {
  const { prisma, state } = createDb(role);
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });
  return { app, prisma, state };
}

function authHeader(role = "MANAGER") {
  return { Authorization: `Bearer ${createTestToken()}` };
}

// ─── POST cash-openings ───────────────────────────────────────────────────────

test("cash reconciliation: Manager records opening cash → 201 with data", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      periodKey: PERIOD_KEY,
      openingCash: 150000,
      notes: "Modal awal shift pagi",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.periodKey, PERIOD_KEY);
  assert.equal(body.data.openingCash, "150000.00");
  assert.ok(body.data.openedBy);
  assert.equal(body.data.notes, "Modal awal shift pagi");
});

test("cash reconciliation: upsert — Manager can update opening cash for same period", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers,
    body: JSON.stringify({ periodKey: PERIOD_KEY, openingCash: 100000 }),
  });

  const res2 = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers,
    body: JSON.stringify({ periodKey: PERIOD_KEY, openingCash: 200000, notes: "Revisi" }),
  });

  assert.equal(res2.status, 201);
  const body = await res2.json();
  assert.equal(body.data.openingCash, "200000.00");
});

test("cash reconciliation: Crew cannot record opening cash → 403", async () => {
  const { app } = buildApp("CREW");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodKey: PERIOD_KEY, openingCash: 100000 }),
  });

  assert.equal(res.status, 403);
});

test("cash reconciliation: negative openingCash rejected → 400", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodKey: PERIOD_KEY, openingCash: -500 }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message.includes("negatif"));
});

test("cash reconciliation: missing openingCash rejected → 400", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodKey: PERIOD_KEY }),
  });

  assert.equal(res.status, 400);
});

test("cash reconciliation: invalid periodKey format rejected → 400", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ periodKey: "November-2026", openingCash: 100000 }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message.includes("YYYY-MM-DD"));
});

// ─── GET cash-openings/:periodKey ─────────────────────────────────────────────

test("cash reconciliation: GET opening cash returns null when not set", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request(
    `/api/v1/outlets/outlet-a/cash-openings/${PERIOD_KEY}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.cashOpening, null);
});

test("cash reconciliation: GET opening cash returns data when set", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  await app.request("/api/v1/outlets/outlet-a/cash-openings", {
    method: "POST",
    headers,
    body: JSON.stringify({ periodKey: PERIOD_KEY, openingCash: 75000 }),
  });

  const res = await app.request(
    `/api/v1/outlets/outlet-a/cash-openings/${PERIOD_KEY}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.cashOpening.openingCash, "75000.00");
});

// ─── Closing preview with cashReconciliationPreview ───────────────────────────

test("cash reconciliation: preview includes cashReconciliationPreview for DAILY", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  // Seed a cash opening
  state.cashOpenings.push({
    id: "co-1",
    outletId: "outlet-a",
    periodKey: PERIOD_KEY,
    openingCash: "100000",
    openedById: "user-1",
    openedAt: NOW,
  });

  // Seed a cash order
  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentStatus: "LUNAS",
    paymentMethod: "CASH",
    total: "35000",
    subtotal: "35000",
    createdAt: NOW,
    items: [],
  });

  // Seed an expense
  state.expenses.push({
    id: "exp-1",
    outletId: "outlet-a",
    status: "ACTIVE",
    amount: "5000",
    expenseDate: NOW,
  });

  const res = await app.request(
    `/api/v1/outlets/outlet-a/closings/preview?type=DAILY&periodKey=${PERIOD_KEY}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  const preview = body.data.cashReconciliationPreview;
  assert.ok(preview, "cashReconciliationPreview should be present");
  assert.equal(preview.openingCash, "100000.00");
  assert.equal(preview.cashSales, "35000.00");
  assert.equal(preview.cashExpenses, "5000.00");
  assert.equal(preview.expectedCash, "130000.00");
  assert.equal(preview.cashOpeningRecorded, true);
});

test("cash reconciliation: preview with no cash opening shows expectedCash from sales - expenses", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentStatus: "LUNAS",
    paymentMethod: "CASH",
    total: "20000",
    subtotal: "20000",
    createdAt: NOW,
    items: [],
  });

  const res = await app.request(
    `/api/v1/outlets/outlet-a/closings/preview?type=DAILY&periodKey=${PERIOD_KEY}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const body = await res.json();
  const preview = body.data.cashReconciliationPreview;
  assert.equal(preview.openingCash, "0.00");
  assert.equal(preview.cashSales, "20000.00");
  assert.equal(preview.expectedCash, "20000.00");
  assert.equal(preview.cashOpeningRecorded, false);
});

// ─── performClosing with actualCash ──────────────────────────────────────────

test("cash reconciliation: closing with actualCash matching expected → CLOSED, cashDifference=0", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  // Opening cash: 100000
  state.cashOpenings.push({
    id: "co-1",
    outletId: "outlet-a",
    periodKey: PERIOD_KEY,
    openingCash: "100000",
    openedById: "user-1",
    openedAt: NOW,
  });

  // Cash sales: 30000
  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentStatus: "LUNAS",
    paymentMethod: "CASH",
    total: "30000",
    subtotal: "30000",
    createdAt: NOW,
    items: [],
  });

  // Expenses: 5000  → expected = 100000 + 30000 - 5000 = 125000
  state.expenses.push({
    id: "exp-1",
    outletId: "outlet-a",
    status: "ACTIVE",
    amount: "5000",
    expenseDate: NOW,
  });

  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-1",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
      actualCash: 125000,
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  const record = body.data.record;
  assert.equal(record.status, "CLOSED");
  // Cash fields should be in summarySnapshot
  const snap = record.summarySnapshot;
  assert.ok(snap.cashReconciliation, "cashReconciliation should be in snapshot");
  assert.equal(snap.cashReconciliation.cashDifference, "0.00");
  assert.equal(snap.cashReconciliation.actualCash, "125000.00");
  assert.equal(snap.cashReconciliation.differenceReason, null);
  // DB record should have cashDifference = 0
  assert.ok(
    record.cashDifference === undefined ||
      String(record.cashDifference) === "0" ||
      String(record.cashDifference) === "0.00",
    "cashDifference should be zero",
  );
});

test("cash reconciliation: closing with mismatch and no differenceReason → 400", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  state.cashOpenings.push({
    id: "co-1",
    outletId: "outlet-a",
    periodKey: PERIOD_KEY,
    openingCash: "100000",
    openedById: "user-1",
    openedAt: NOW,
  });

  // expectedCash = 100000 (no sales, no expenses)
  // actualCash = 95000 → diff = -5000

  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-2",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
      actualCash: 95000,
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message.includes("selisih"));
});

test("cash reconciliation: closing with mismatch + differenceReason → CLOSED with reason", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  state.cashOpenings.push({
    id: "co-1",
    outletId: "outlet-a",
    periodKey: PERIOD_KEY,
    openingCash: "100000",
    openedById: "user-1",
    openedAt: NOW,
  });

  // expected = 100000, actual = 95000, diff = -5000
  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-3",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
      actualCash: 95000,
      differenceReason: "Uang kembalian pelanggan belum masuk",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  const snap = body.data.record.summarySnapshot;
  assert.ok(snap.cashReconciliation);
  assert.equal(snap.cashReconciliation.cashDifference, "-5000.00");
  assert.equal(
    snap.cashReconciliation.differenceReason,
    "Uang kembalian pelanggan belum masuk",
  );
});

test("cash reconciliation: closing without actualCash still works (backward compat)", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-4",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.record.status, "CLOSED");
  // No cashReconciliation in snapshot
  assert.equal(body.data.record.summarySnapshot.cashReconciliation, undefined);
});

test("cash reconciliation: negative actualCash rejected → 400", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-5",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
      actualCash: -1000,
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.message.includes("negatif"));
});

test("cash reconciliation: surplus case — actualCash > expected, reason provided → CLOSED", async () => {
  const { app, state } = buildApp("MANAGER");
  const token = createTestToken();

  state.cashOpenings.push({
    id: "co-1",
    outletId: "outlet-a",
    periodKey: PERIOD_KEY,
    openingCash: "50000",
    openedById: "user-1",
    openedAt: NOW,
  });

  // expected = 50000, actual = 55000, diff = +5000
  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-6",
      closingType: "DAILY",
      periodKey: PERIOD_KEY,
      actualCash: 55000,
      differenceReason: "Kelebihan kasir ditemukan",
    }),
  });

  assert.equal(res.status, 201);
  const snap = (await res.json()).data.record.summarySnapshot.cashReconciliation;
  assert.equal(snap.cashDifference, "5000.00");
  assert.equal(snap.differenceReason, "Kelebihan kasir ditemukan");
});

test("cash reconciliation: MONTHLY closing ignores actualCash (not applicable)", async () => {
  const { app } = buildApp("MANAGER");
  const token = createTestToken();

  const res = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "txn-closing-monthly",
      closingType: "MONTHLY",
      periodKey: "2026-11",
      actualCash: 999999,
    }),
  });

  // MONTHLY closing should succeed; actualCash silently ignored
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.record.status, "CLOSED");
  assert.equal(
    body.data.record.summarySnapshot.cashReconciliation,
    undefined,
    "MONTHLY should not have cashReconciliation",
  );
});

