import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");
const REQUEST_ID = "e75f8268-4ed1-4f5c-b853-b4c25178a107";
const EXPENSE_ID = "c9ca2a2a-b838-4934-9f22-a92d9796c1ec";
const CORRECTION_ID = "84a3fd80-981f-4b9d-a639-99ecce67e7bc";
const CANCELLATION_ID = "d3ca77ed-89e2-4598-8ee8-e4f40c89ba44";

function createDatabase(role) {
  const state = {
    items: [{ id: "item-1", name: "Susu", unit: "ml", isActive: true }],
    categories: [
      { id: "category-1", name: "Bahan baku darurat", isProvisional: true },
    ],
    requests: [],
    requestItems: [],
    expenses: [],
    audits: [],
    stocks: [{ outletId: "outlet-a", inventoryItemId: "item-1", quantity: "100" }],
    movements: [],
    failAudit: false,
  };
  const memberships = new Map([["outlet-a", role]]);

  function getRequest(record) {
    if (!record) return null;
    return {
      ...record,
      items: state.requestItems
        .filter((item) => item.requestId === record.id)
        .map((item) => ({ ...item })),
      requestedBy: { id: record.requestedById, name: "Pengguna Uji" },
      processedBy: record.processedById
        ? { id: record.processedById, name: "Pengguna Uji" }
        : null,
    };
  }

  function getExpense(record) {
    if (!record) return null;
    const category = state.categories.find(
      (item) => item.id === record.categoryId,
    );
    return {
      ...record,
      category: category
        ? {
            id: category.id,
            name: category.name,
            isProvisional: category.isProvisional,
          }
        : null,
      createdBy: { id: record.createdById, name: "Pengguna Uji" },
      audits: state.audits
        .filter((audit) => audit.expenseId === record.id)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 10)
        .map((audit) => ({
          ...audit,
          actor: { id: audit.actorId, name: "Pengguna Uji" },
        })),
    };
  }

  function uniqueRequest(where) {
    const key = where.outletId_requestedById_clientTransactionId;
    return state.requests.find(
      (record) =>
        record.outletId === key.outletId &&
        record.requestedById === key.requestedById &&
        record.clientTransactionId === key.clientTransactionId,
    );
  }

  function uniqueExpense(where) {
    const key = where.outletId_createdById_clientTransactionId;
    return state.expenses.find(
      (record) =>
        record.outletId === key.outletId &&
        record.createdById === key.createdById &&
        record.clientTransactionId === key.clientTransactionId,
    );
  }

  function uniqueAudit(where) {
    const key = where.outletId_actorId_clientTransactionId;
    return state.audits.find(
      (record) =>
        record.outletId === key.outletId &&
        record.actorId === key.actorId &&
        record.clientTransactionId === key.clientTransactionId,
    );
  }

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        return where.id === "session-1"
          ? {
              id: "session-1",
              userId: "user-1",
              revokedAt: null,
              expiresAt: new Date("2026-11-14T10:00:00.000Z"),
              user: { id: "user-1", isActive: true },
            }
          : null;
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const outletId = where.userId_outletId.outletId;
        const membershipRole = memberships.get(outletId);
        return membershipRole
          ? { role: membershipRole, outlet: { isActive: true } }
          : null;
      },
    },
    inventoryItem: {
      async findMany({ where }) {
        return state.items.filter(
          (item) =>
            item.isActive &&
            (!where.id || where.id.in.includes(item.id)),
        );
      },
    },
    outletStockRequest: {
      async findUnique({ where }) {
        return getRequest(uniqueRequest(where));
      },
      async findMany({ where }) {
        return state.requests
          .filter(
            (record) =>
              record.outletId === where.outletId &&
              (!where.requestedById ||
                record.requestedById === where.requestedById),
          )
          .map(getRequest);
      },
      async findFirst({ where }) {
        return getRequest(
          state.requests.find(
            (record) =>
              record.id === where.id && record.outletId === where.outletId,
          ),
        );
      },
      async create({ data }) {
        const record = {
          ...data,
          id: `request-${state.requests.length + 1}`,
          status: "PENDING",
          decisionNote: null,
          processedById: null,
          processedAt: null,
          createdAt: data.createdAt ?? NOW,
          updatedAt: NOW,
        };
        state.requests.push(record);
        for (const item of data.items.create) {
          state.requestItems.push({
            ...item,
            id: `request-item-${state.requestItems.length + 1}`,
            requestId: record.id,
          });
        }
        return getRequest(record);
      },
      async updateMany({ where, data }) {
        const record = state.requests.find(
          (entry) =>
            entry.id === where.id &&
            entry.outletId === where.outletId &&
            entry.status === where.status,
        );
        if (!record) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      },
    },
    expenseCategory: {
      async findUnique({ where }) {
        return state.categories.find((category) => category.id === where.id) ?? null;
      },
      async findMany() {
        return state.categories;
      },
    },
    expense: {
      async findUnique({ where }) {
        return getExpense(uniqueExpense(where));
      },
      async findFirst({ where }) {
        return getExpense(
          state.expenses.find(
            (record) =>
              record.id === where.id && record.outletId === where.outletId,
          ),
        );
      },
      async findMany({ where }) {
        return state.expenses
          .filter((record) => record.outletId === where.outletId)
          .sort((left, right) => right.expenseDate - left.expenseDate)
          .map(getExpense);
      },
      async create({ data }) {
        const expense = {
          ...data,
          id: EXPENSE_ID,
          amount: new Prisma.Decimal(data.amount),
          status: "ACTIVE",
          cancelledAt: null,
          createdAt: data.createdAt ?? NOW,
          updatedAt: data.updatedAt ?? NOW,
        };
        state.expenses.push(expense);
        return getExpense(expense);
      },
      async updateMany({ where, data }) {
        const expense = state.expenses.find(
          (record) =>
            record.id === where.id &&
            record.outletId === where.outletId &&
            record.status === where.status &&
            record.updatedAt.getTime() === where.updatedAt.getTime(),
        );
        if (!expense) return { count: 0 };
        Object.assign(expense, data);
        if (data.amount !== undefined) {
          expense.amount = new Prisma.Decimal(data.amount);
        }
        return { count: 1 };
      },
    },
    expenseAudit: {
      async findUnique({ where }) {
        return uniqueAudit(where) ?? null;
      },
      async findMany({ where }) {
        return state.audits
          .filter(
            (audit) =>
              audit.outletId === where.outletId &&
              audit.expenseId === where.expenseId,
          )
          .sort((left, right) => right.createdAt - left.createdAt)
          .map((audit) => ({
            ...audit,
            actor: { id: audit.actorId, name: "Pengguna Uji" },
          }));
      },
      async create({ data }) {
        if (state.failAudit) throw new Error("Synthetic audit failure");
        const audit = { ...data, id: `audit-${state.audits.length + 1}` };
        state.audits.push(audit);
        return audit;
      },
    },
    async $transaction(callback) {
      const snapshot = {
        requests: state.requests.map((record) => ({ ...record })),
        requestItems: state.requestItems.map((record) => ({ ...record })),
        expenses: state.expenses.map((record) => ({ ...record })),
        audits: state.audits.map((record) => ({ ...record })),
      };
      try {
        return await callback(prisma);
      } catch (error) {
        state.requests.splice(0, state.requests.length, ...snapshot.requests);
        state.requestItems.splice(
          0,
          state.requestItems.length,
          ...snapshot.requestItems,
        );
        state.expenses.splice(0, state.expenses.length, ...snapshot.expenses);
        state.audits.splice(0, state.audits.length, ...snapshot.audits);
        throw error;
      }
    },
  };
  return { prisma, state };
}

function createFixture(role) {
  const database = createDatabase(role);
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    logger: { error() {} },
    inventoryOptions: { now: () => NOW },
    expenseOptions: { now: () => NOW },
  });
  const accessToken = createAccessToken({
    userId: "user-1",
    sessionId: "session-1",
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
  return { app, accessToken, ...database };
}

function request(app, token, path, method = "GET", body) {
  return app.request(`http://localhost/api/v1/outlets/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function stockRequestPayload(overrides = {}) {
  return {
    clientTransactionId: REQUEST_ID,
    items: [{ inventoryItemId: "item-1", quantity: "5" }],
    note: "Persediaan tinggal sedikit",
    ...overrides,
  };
}

function expensePayload(overrides = {}) {
  return {
    clientTransactionId: EXPENSE_ID,
    categoryId: "category-1",
    amount: "25000",
    expenseDate: NOW.toISOString(),
    description: "Pembelian susu",
    ...overrides,
  };
}

test("internal stock requests are scoped, idempotent, and approval does not change stock", async () => {
  const crew = createFixture("CREW");
  const created = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/stock-requests",
    "POST",
    stockRequestPayload(),
  );
  assert.equal(created.status, 201);
  assert.equal(crew.state.requests.length, 1);
  assert.equal(crew.state.requestItems[0].itemName, "Susu");
  assert.equal(crew.state.requestItems[0].quantity.toString(), "5");

  const replay = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/stock-requests",
    "POST",
    stockRequestPayload(),
  );
  assert.equal(replay.status, 200);
  assert.equal(crew.state.requests.length, 1);
  crew.state.requests.push({
    id: "request-other-crew",
    outletId: "outlet-a",
    requestedById: "another-user",
    processedById: null,
    clientTransactionId: "other-request-id",
    payloadHash: "other-payload",
    status: "PENDING",
    note: null,
    decisionNote: null,
    processedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const crewHistory = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/stock-requests",
  );
  assert.equal((await crewHistory.json()).data.requests.length, 1);

  const conflict = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/stock-requests",
    "POST",
    stockRequestPayload({ items: [{ inventoryItemId: "item-1", quantity: "8" }] }),
  );
  assert.equal(conflict.status, 409);

  const wrongOutlet = await request(
    crew.app,
    crew.accessToken,
    "outlet-b/stock-requests",
  );
  assert.equal(wrongOutlet.status, 403);

  const manager = createFixture("MANAGER");
  const stockBefore = manager.state.stocks[0].quantity;
  const movementsBefore = manager.state.movements.length;
  const seededRequest = {
    id: "request-existing",
    outletId: "outlet-a",
    requestedById: "crew-1",
    processedById: null,
    clientTransactionId: REQUEST_ID,
    payloadHash: "existing",
    status: "PENDING",
    note: null,
    decisionNote: null,
    processedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  manager.state.requests.push(seededRequest);
  manager.state.requestItems.push({
    id: "item-request-1",
    requestId: seededRequest.id,
    inventoryItemId: "item-1",
    itemName: "Susu",
    unit: "ml",
    quantity: new Prisma.Decimal("5"),
  });
  const managerHistory = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-requests",
  );
  assert.equal((await managerHistory.json()).data.requests.length, 1);

  const approved = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-requests/request-existing",
    "PATCH",
    { status: "APPROVED", decisionNote: "Disetujui untuk pemenuhan outlet." },
  );
  assert.equal(approved.status, 200);
  assert.equal(manager.state.requests[0].status, "APPROVED");
  assert.equal(manager.state.requests[0].processedById, "user-1");
  assert.equal(manager.state.stocks[0].quantity, stockBefore);
  assert.equal(manager.state.movements.length, movementsBefore);

  const repeatedApproval = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-requests/request-existing",
    "PATCH",
    { status: "APPROVED", decisionNote: "Disetujui untuk pemenuhan outlet." },
  );
  assert.equal(repeatedApproval.status, 200);
  const rejectedAfterApproval = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/stock-requests/request-existing",
    "PATCH",
    { status: "REJECTED" },
  );
  assert.equal(rejectedAfterApproval.status, 409);

  const owner = createFixture("OWNER");
  const ownerHistory = await request(
    owner.app,
    owner.accessToken,
    "outlet-a/stock-requests",
  );
  assert.equal(ownerHistory.status, 403);
});

test("expense writes are Manager-only and corrections/cancellations are audited", async () => {
  const crew = createFixture("CREW");
  const crewWrite = await request(
    crew.app,
    crew.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload(),
  );
  assert.equal(crewWrite.status, 403);

  const manager = createFixture("MANAGER");
  const created = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload(),
  );
  assert.equal(created.status, 201);
  assert.equal(manager.state.expenses[0].createdById, "user-1");

  const replay = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload(),
  );
  assert.equal(replay.status, 200);
  assert.equal(manager.state.expenses.length, 1);
  const changedCreate = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload({ amount: "26000" }),
  );
  assert.equal(changedCreate.status, 409);

  const spoofedCreator = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload({
      clientTransactionId: "5b43addc-71d2-48bd-b80c-d05c06603413",
      createdById: "another-user",
    }),
  );
  assert.equal(spoofedCreator.status, 400);

  const correctionPayload = {
    clientTransactionId: CORRECTION_ID,
    amount: "30000",
    reason: "Nominal pada bukti transaksi berbeda.",
  };
  const corrected = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    correctionPayload,
  );
  assert.equal(corrected.status, 200);
  assert.equal(manager.state.expenses[0].amount.toString(), "30000");
  assert.equal(manager.state.audits.length, 1);
  assert.equal(manager.state.audits[0].action, "CORRECTED");
  assert.equal(manager.state.audits[0].beforeSnapshot.amount, "25000");
  assert.equal(manager.state.audits[0].afterSnapshot.amount, "30000");

  const correctionReplay = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    correctionPayload,
  );
  assert.equal(correctionReplay.status, 200);
  assert.equal(manager.state.audits.length, 1);
  const changedCorrection = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    { ...correctionPayload, amount: "31000" },
  );
  assert.equal(changedCorrection.status, 409);

  const cancelled = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}/cancel`,
    "POST",
    { clientTransactionId: CANCELLATION_ID, reason: "Input ganda." },
  );
  assert.equal(cancelled.status, 200);
  assert.equal(manager.state.expenses[0].status, "CANCELLED");
  assert.equal(manager.state.audits.length, 2);
  assert.equal(manager.state.audits[1].action, "CANCELLED");
  assert.equal(manager.state.audits[1].beforeSnapshot.status, "ACTIVE");
  assert.equal(manager.state.audits[1].afterSnapshot.status, "CANCELLED");

  const afterCancellation = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    { clientTransactionId: "6f3a5cc1-1083-4555-a29f-431002650dc0", amount: "1" },
  );
  assert.equal(afterCancellation.status, 409);

  const wrongOutlet = await request(
    manager.app,
    manager.accessToken,
    "outlet-b/expenses",
  );
  assert.equal(wrongOutlet.status, 403);
});

test("Owner can read expenses and audit history but cannot mutate expenses", async () => {
  const manager = createFixture("MANAGER");
  const created = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload(),
  );
  assert.equal(created.status, 201);
  const corrected = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    {
      clientTransactionId: CORRECTION_ID,
      amount: "26000",
      reason: "Koreksi uji.",
    },
  );
  assert.equal(corrected.status, 200);

  const owner = createFixture("OWNER");
  owner.state.expenses.push(...manager.state.expenses);
  owner.state.audits.push(...manager.state.audits);
  const list = await request(owner.app, owner.accessToken, "outlet-a/expenses");
  assert.equal(list.status, 200);
  const audit = await request(
    owner.app,
    owner.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}/audit`,
  );
  assert.equal(audit.status, 200);
  assert.equal((await audit.json()).data.audits.length, 1);

  const denied = await request(
    owner.app,
    owner.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload({
      clientTransactionId: "e187875e-4e20-4b5c-90b2-7f7030e76427",
    }),
  );
  assert.equal(denied.status, 403);

  const ownerCorrection = await request(
    owner.app,
    owner.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    {
      clientTransactionId: "663ce2d0-41bd-42d2-8e76-891c915dc3c5",
      amount: "30000",
    },
  );
  assert.equal(ownerCorrection.status, 403);

  const categories = await owner.app.request(
    "http://localhost/api/v1/expense-categories",
    { headers: { authorization: `Bearer ${owner.accessToken}` } },
  );
  assert.equal(categories.status, 200);
  assert.equal((await categories.json()).data.categories[0].status, "PROVISIONAL");
});

test("expense mutation rolls back when the audit insert fails", async () => {
  const manager = createFixture("MANAGER");
  const created = await request(
    manager.app,
    manager.accessToken,
    "outlet-a/expenses",
    "POST",
    expensePayload(),
  );
  assert.equal(created.status, 201);

  manager.state.failAudit = true;
  const correction = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}`,
    "PATCH",
    {
      clientTransactionId: CORRECTION_ID,
      amount: "30000",
    },
  );
  assert.equal(correction.status, 500);
  assert.equal(manager.state.expenses[0].amount.toString(), "25000");
  assert.equal(manager.state.audits.length, 0);

  const cancellation = await request(
    manager.app,
    manager.accessToken,
    `outlet-a/expenses/${EXPENSE_ID}/cancel`,
    "POST",
    { clientTransactionId: CANCELLATION_ID },
  );
  assert.equal(cancellation.status, 500);
  assert.equal(manager.state.expenses[0].status, "ACTIVE");
  assert.equal(manager.state.audits.length, 0);
});
