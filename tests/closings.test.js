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

function createClosingDatabase(role = "MANAGER") {
  const state = {
    orders: [],
    expenses: [],
    closings: [],
    histories: [],
    audits: [],
    waste: [],
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
    $executeRaw: function(...args) {
      // Handle tagged template literals: $executeRaw`SELECT ... ${value} ...`
      // args[0] is an array of string literals
      console.log('[DEBUG] \$executeRaw called with:', args);
      return Promise.resolve({ command: "SELECT", rowCount: 1 });
    },
    outletMembership: {
      async findUnique({ where }) {
        const membershipRole = memberships.get(where.userId_outletId.outletId);
        if (!membershipRole) return null;
        return {
          role: membershipRole,
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
            if (where.paymentStatus && order.paymentStatus !== where.paymentStatus) return false;
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
            crew: { id: order.crewId || "user-crew", name: "Crew Seroo" },
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
    cashOpening: {
      async findUnique({ where }) {
        // Mock: return null (no cash opening recorded)
        return null;
      },
    },
    closingRecord: {
      async findUnique({ where }) {
        if (where.id) {
          return state.closings.find((c) => c.id === where.id) || null;
        }
        const key = where.outletId_closingType_periodKey;
        if (key) {
          const rec = state.closings.find(
            (c) =>
              c.outletId === key.outletId &&
              c.closingType === key.closingType &&
              c.periodKey === key.periodKey,
          );
          if (!rec) return null;
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
        return null;
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
      async findMany({ where }) {
        return state.closings
          .filter((c) => {
            if (where.outletId && c.outletId !== where.outletId) return false;
            if (where.closingType && c.closingType !== where.closingType) return false;
            return true;
          })
          .map((rec) => ({
            ...rec,
            closedBy: { id: rec.closedById, name: "Manager Seroo" },
            reopenedBy: rec.reopenedById
              ? { id: rec.reopenedById, name: "Manager Seroo" }
              : null,
            history: state.histories.filter((h) => h.closingId === rec.id),
            audits: state.audits.filter((a) => a.closingId === rec.id),
          }));
      },
      async create({ data }) {
        const newRecord = {
          id: `closing-${state.closings.length + 1}`,
          ...data,
          closedBy: { id: data.closedById, name: "Manager Seroo" },
          reopenedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.closings.push(newRecord);
        return newRecord;
      },
      async update({ where, data }) {
        const idx = state.closings.findIndex((c) => c.id === where.id);
        if (idx === -1) throw new Error("Closing not found");
        const updated = {
          ...state.closings[idx],
          ...data,
          updatedAt: new Date(),
          closedBy: { id: data.closedById || state.closings[idx].closedById, name: "Manager Seroo" },
          reopenedBy: data.reopenedById ? { id: data.reopenedById, name: "Manager Seroo" } : null,
        };
        state.closings[idx] = updated;
        return updated;
      },
    },
    closingHistory: {
      async create({ data }) {
        const hist = {
          id: `hist-${state.histories.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        state.histories.push(hist);
        return hist;
      },
      async findFirst({ where }) {
        return (
          state.histories.find(
            (h) => h.closingId === where.closingId && h.version === where.version,
          ) || null
        );
      },
      async update({ where, data }) {
        const idx = state.histories.findIndex((h) => h.id === where.id);
        if (idx !== -1) {
          state.histories[idx] = { ...state.histories[idx], ...data };
          return state.histories[idx];
        }
        return null;
      },
    },
    closingAudit: {
      async findUnique({ where }) {
        const key = where.outletId_actorId_clientTransactionId;
        if (!key) return null;
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
        const audit = {
          id: `audit-${state.audits.length + 1}`,
          ...data,
          actor: { id: data.actorId, name: "Manager Seroo" },
          createdAt: data.createdAt || new Date(),
        };
        state.audits.push(audit);
        return audit;
      },
    },
    $transaction: function(fn) {
      // Create a mock transaction client
      const tx = {
        $queryRaw: async function(...args) {
          return Promise.resolve({ command: "SELECT", rowCount: 1 });
        },
        closingRecord: {
          findUnique: async (args) => {
            if (args.where.id) {
              return state.closings.find((c) => c.id === args.where.id) || null;
            }
            const key = args.where.outletId_closingType_periodKey;
            if (key) {
              const rec = state.closings.find(
                (c) =>
                  c.outletId === key.outletId &&
                  c.closingType === key.closingType &&
                  c.periodKey === key.periodKey,
              );
              if (!rec) return null;
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
            return null;
          },
          findMany: async () => state.closings,
          create: async (args) => {
            const newRecord = {
              id: `closing-${state.closings.length + 1}`,
              ...args.data,
              closedBy: { id: args.data.closedById, name: "Manager Seroo" },
              reopenedBy: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            state.closings.push(newRecord);
            return newRecord;
          },
          update: async (args) => {
            const idx = state.closings.findIndex((c) => c.id === args.where.id);
            if (idx === -1) throw new Error("Closing not found");
            const updated = {
              ...state.closings[idx],
              ...args.data,
              updatedAt: new Date(),
              closedBy: {
                id: args.data.closedById || state.closings[idx].closedById,
                name: "Manager Seroo",
              },
              reopenedBy: args.data.reopenedById
                ? { id: args.data.reopenedById, name: "Manager Seroo" }
                : null,
            };
            state.closings[idx] = updated;
            return updated;
          },
        },
        closingHistory: {
          create: async (args) => {
            const hist = {
              id: `hist-${state.histories.length + 1}`,
              ...args.data,
              createdAt: new Date(),
            };
            state.histories.push(hist);
            return hist;
          },
          update: async (args) => {
            const idx = state.histories.findIndex((h) => h.id === args.where.id);
            if (idx !== -1) {
              state.histories[idx] = {
                ...state.histories[idx],
                ...args.data,
              };
              return state.histories[idx];
            }
            return null;
          },
        },
        closingAudit: {
          create: async (args) => {
            const audit = {
              id: `audit-${state.audits.length + 1}`,
              ...args.data,
              actor: { id: args.data.actorId, name: "Manager Seroo" },
              createdAt: args.data.createdAt || new Date(),
            };
            state.audits.push(audit);
            return audit;
          },
        },
        order: {
          findUnique: async (args) => {
            const key = args.where;
            const rec = state.orders.find(
              (o) =>
                o.id === key.id &&
                o.outletId === key.outletId &&
                o.crewId === key.crewId,
            );
            return rec || null;
          },
        },
        orderPayment: {
          update: async (args) => {
            const idx = state.orders.findIndex((o) =>
              o.payments?.some((p) => p.id === args.where.id),
            );
            if (idx === -1) throw new Error("Payment not found");
            const order = state.orders[idx];
            const payment = order.payments.find((p) => p.id === args.where.id);
            if (payment) {
              payment.paymentStatus = args.data.paymentStatus;
              payment.verifiedAt = args.data.verifiedAt;
              payment.verifiedById = args.data.verifiedById;
              payment.notes = args.data.notes;
            }
            return payment;
          },
        },
        orderStatusHistory: {
          create: async (args) => {
            const hist = {
              id: `histord-${state.histories.length + 1}`,
              ...args.data,
            };
            state.histories.push(hist);
            return hist;
          },
        },
        wasteRecord: {
          create: async (args) => {
            const w = { id: `waste-${state.waste.length + 1}`, ...args.data };
            state.waste.push(w);
            return w;
          },
        },
      };
      return fn(tx);
    },
  };

  return { prisma, state };
}

test("closing preview shows financial summary and unfinished offline QRIS transactions", async () => {
  const { prisma, state } = createClosingDatabase();
  const token = createTestToken();

  // Completed settled order
  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "30000.00",
    total: "30000.00",
    createdAt: new Date("2026-11-13T02:00:00.000Z"),
    items: [],
  });

  // Unfinished offline QRIS transaction pending reconciliation
  state.orders.push({
    id: "ord-unsettled",
    orderNumber: "SR-0099",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "QRIS",
    paymentStatus: "PENDING_RECONCILIATION",
    subtotal: "15000.00",
    total: "15000.00",
    createdAt: new Date("2026-11-13T05:00:00.000Z"),
    items: [],
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  const res = await app.request(
    "/api/v1/outlets/outlet-a/closings/preview?type=DAILY&periodKey=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.outletId, "outlet-a");
  assert.equal(body.data.closingType, "DAILY");
  assert.equal(body.data.periodKey, "2026-11-13");

  // Report summary
  assert.equal(body.data.reportSummary.summary.totalIncome, "45000.00");
  assert.equal(body.data.reportSummary.summary.transactionCount, 2);

  // Unfinished transactions displayed
  assert.equal(body.data.unfinishedCount, 1);
  assert.equal(body.data.unfinishedTransactions.length, 1);
  assert.equal(body.data.unfinishedTransactions[0].orderNumber, "SR-0099");
  assert.equal(body.data.unfinishedTransactions[0].paymentStatus, "PENDING_RECONCILIATION");
  assert.equal(body.data.currentClosing, null);
});

test("daily closing by Manager records closing, history, and audit log", async () => {
  const { prisma, state } = createClosingDatabase();
  const token = createTestToken();

  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "50000.00",
    total: "50000.00",
    createdAt: new Date("2026-11-13T02:00:00.000Z"),
    items: [],
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  // Perform daily closing
  const closeRes = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "c1111111-1111-1111-1111-111111111111",
      closingType: "DAILY",
      periodKey: "2026-11-13",
      notes: "Closing harian normal",
    }),
  });

  assert.equal(closeRes.status, 201);
  const closeBody = await closeRes.json();
  assert.equal(closeBody.success, true);
  assert.equal(closeBody.data.record.status, "CLOSED");
  assert.equal(closeBody.data.record.version, 1);
  assert.equal(closeBody.data.record.notes, "Closing harian normal");

  // Verify history & audit created
  assert.equal(state.histories.length, 1);
  assert.equal(state.histories[0].version, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, "CLOSED");

  // Attempting to close again without Reopen returns 409 ALREADY_CLOSED
  const duplicateClose = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "c2222222-2222-2222-2222-222222222222",
      closingType: "DAILY",
      periodKey: "2026-11-13",
      notes: "Closing coba lagi",
    }),
  });

  assert.equal(duplicateClose.status, 409);
  const dupBody = await duplicateClose.json();
  assert.equal(dupBody.error.code, "ALREADY_CLOSED");
});

test("reopen requires mandatory reason, logs audit, and allows re-closing preserving history", async () => {
  const { prisma, state } = createClosingDatabase();
  const token = createTestToken();

  state.orders.push({
    id: "ord-1",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "50000.00",
    total: "50000.00",
    createdAt: new Date("2026-11-13T02:00:00.000Z"),
    items: [],
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  // Step 1: Initial Closing
  const closeRes = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "c1111111-1111-1111-1111-111111111111",
      closingType: "DAILY",
      periodKey: "2026-11-13",
      notes: "Closing awal",
    }),
  });
  const closingRecordId = (await closeRes.json()).data.record.id;

  // Step 2: Reopen without reason fails with 400 VALIDATION_ERROR
  const badReopen = await app.request("/api/v1/outlets/outlet-a/closings/reopen", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "r0000000-0000-0000-0000-000000000000",
      closingId: closingRecordId,
      reason: "", // Empty reason!
    }),
  });
  assert.equal(badReopen.status, 400);

  // Step 3: Reopen with valid mandatory reason
  const reopenRes = await app.request("/api/v1/outlets/outlet-a/closings/reopen", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "r1111111-1111-1111-1111-111111111111",
      closingId: closingRecordId,
      reason: "Koreksi pencatatan transaksi kas terlewat",
    }),
  });

  assert.equal(reopenRes.status, 200);
  const reopenBody = await reopenRes.json();
  assert.equal(reopenBody.data.record.status, "REOPENED");
  assert.equal(reopenBody.data.record.reopenReason, "Koreksi pencatatan transaksi kas terlewat");

  // Verify REOPENED audit log
  const reopenAudit = state.audits.find((a) => a.action === "REOPENED");
  assert.ok(reopenAudit);
  assert.equal(reopenAudit.reason, "Koreksi pencatatan transaksi kas terlewat");

  // Step 4: Add new transaction after reopen
  state.orders.push({
    id: "ord-2",
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "20000.00",
    total: "20000.00",
    createdAt: new Date("2026-11-13T06:00:00.000Z"),
    items: [],
  });

  // Step 5: Perform Re-closing (Closing ulang)
  const recloseRes = await app.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "c3333333-3333-3333-3333-333333333333",
      closingType: "DAILY",
      periodKey: "2026-11-13",
      notes: "Closing ulang setelah koreksi",
    }),
  });

  assert.equal(recloseRes.status, 201);
  const recloseBody = await recloseRes.json();
  assert.equal(recloseBody.data.record.status, "CLOSED");
  assert.equal(recloseBody.data.record.version, 2);

  // New income is now 50,000 + 20,000 = 70,000
  assert.equal(recloseBody.data.record.summarySnapshot.summary.totalIncome, "70000.00");

  // Previous closing history is preserved!
  assert.equal(state.histories.length, 2);
  assert.equal(state.histories[0].version, 1);
  assert.equal(state.histories[0].summarySnapshot.summary.totalIncome, "50000.00");
  assert.equal(state.histories[1].version, 2);
  assert.equal(state.histories[1].summarySnapshot.summary.totalIncome, "70000.00");

  // Reclose audit logged
  const recloseAudit = state.audits.find((a) => a.action === "RECLOSED");
  assert.ok(recloseAudit);
  assert.equal(recloseAudit.version, 2);
});

test("role authorization: Manager can close/reopen, Owner is read-only, Crew is forbidden", async () => {
  const token = createTestToken();

  // Test Owner cannot mutate closing
  const { prisma: ownerPrisma } = createClosingDatabase("OWNER");
  const ownerApp = createApp({
    prisma: ownerPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  const ownerMutate = await ownerApp.request("/api/v1/outlets/outlet-a/closings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "c4444444-4444-4444-4444-444444444444",
      closingType: "DAILY",
      periodKey: "2026-11-13",
    }),
  });
  assert.equal(ownerMutate.status, 403);

  // Owner can preview
  const ownerPreview = await ownerApp.request(
    "/api/v1/outlets/outlet-a/closings/preview?type=DAILY&periodKey=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(ownerPreview.status, 200);

  // Test Crew cannot access preview or mutate
  const { prisma: crewPrisma } = createClosingDatabase("CREW");
  const crewApp = createApp({
    prisma: crewPrisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  const crewPreview = await crewApp.request(
    "/api/v1/outlets/outlet-a/closings/preview?type=DAILY&periodKey=2026-11-13",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  assert.equal(crewPreview.status, 403);
});

