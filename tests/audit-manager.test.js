import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-15T12:00:00.000Z");

const MEMBERSHIPS = [
  { userId: "manager-a", outletId: "outlet-a", role: "MANAGER" },
  { userId: "manager-b", outletId: "outlet-b", role: "MANAGER" },
  { userId: "crew-a", outletId: "outlet-a", role: "CREW" },
  { userId: "owner-a", outletId: "outlet-a", role: "OWNER_MITRA" },
  { userId: "admin", outletId: "outlet-a", role: "ADMIN_PUSAT" },
];

const OUTLET_STATE = {
  "outlet-a": { isActive: true },
  "outlet-b": { isActive: true },
  "outlet-inactive": { isActive: false },
};

function createEntry(overrides = {}) {
  return {
    id: "audit-1",
    actorUserId: "crew-a",
    sessionId: "session-crew-a",
    outletId: "outlet-a",
    action: "ORDER_CREATED",
    resourceType: "Order",
    resourceId: "order-1",
    outcome: "SUCCESS",
    metadata: { note: "ok" },
    createdAt: new Date("2026-11-15T10:00:00.000Z"),
    actor: { id: "crew-a", name: "Crew A", email: "crew-a@seroo.test" },
    ...overrides,
  };
}

function createDatabase({ entries = null } = {}) {
  const rows =
    entries ??
    [
      createEntry(),
      createEntry({
        id: "audit-2",
        action: "EXPENSE_CREATED",
        resourceType: "Expense",
        resourceId: "expense-1",
        createdAt: new Date("2026-11-14T10:00:00.000Z"),
      }),
      createEntry({
        id: "audit-null",
        outletId: null,
        action: "LOGIN_SUCCEEDED",
        resourceType: "AuthSession",
        resourceId: "session-crew-a",
      }),
    ];
  const calls = [];

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        const userId = where.id.replace("session-", "");
        if (!userId || userId === "missing") return null;
        return {
          id: where.id,
          userId,
          revokedAt: null,
          expiresAt: new Date("2026-11-16T00:00:00.000Z"),
          lastSeenAt: NOW,
          createdAt: NOW,
          user: { id: userId, isActive: true, mustChangePassword: false },
        };
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    refreshToken: { async updateMany() { return { count: 0 }; } },
    outletMembership: {
      async findUnique({ where }) {
        const key = where.userId_outletId;
        const membership = MEMBERSHIPS.find(
          (row) => row.userId === key.userId && row.outletId === key.outletId,
        );
        if (!membership) return null;
        return {
          ...membership,
          id: `membership-${membership.userId}-${membership.outletId}`,
          outlet: OUTLET_STATE[membership.outletId] ?? { isActive: true },
        };
      },
      async findFirst({ where }) {
        const membership = MEMBERSHIPS.find(
          (row) => row.userId === where.userId && row.role === where.role,
        );
        return membership ? { id: `membership-${membership.userId}` } : null;
      },
    },
    auditLog: {
      async findMany(args) {
        calls.push(args);
        const { where = {}, skip = 0, take = 50 } = args;
        let result = rows.filter((row) => {
          if (where.outletId !== undefined && row.outletId !== where.outletId) {
            return false;
          }
          if (typeof where.action === "string" && row.action !== where.action) {
            return false;
          }
          if (where.action?.notIn && where.action.notIn.includes(row.action)) {
            return false;
          }
          if (where.resourceType && row.resourceType !== where.resourceType) {
            return false;
          }
          if (where.actorUserId && row.actorUserId !== where.actorUserId) {
            return false;
          }
          if (where.outcome && row.outcome !== where.outcome) return false;
          if (where.createdAt?.gte && row.createdAt < where.createdAt.gte) {
            return false;
          }
          if (where.createdAt?.lt && row.createdAt >= where.createdAt.lt) {
            return false;
          }
          return true;
        });
        result = result.sort(
          (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
        );
        return result.slice(skip, skip + take);
      },
    },
  };

  return { prisma, calls, rows };
}

function tokenFor(userId) {
  return createAccessToken({
    userId,
    sessionId: `session-${userId}`,
    secret: SECRET,
    now: NOW,
  });
}

function makeApp(database) {
  return createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: SECRET },
    auditOptions: { now: () => NOW },
  });
}

function request(app, path, userId, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (userId) headers.Authorization = `Bearer ${tokenFor(userId)}`;
  return app.request(path, { ...options, headers });
}
test("manager dengan membership outlet sendiri mendapat audit outlet tersebut", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.outletId, "outlet-a");
  assert.deepEqual(
    body.data.auditLogs.map((row) => row.id),
    ["audit-1", "audit-2"],
  );
  assert.deepEqual(body.data.pagination, {
    page: 1,
    pageSize: 50,
    hasNextPage: false,
  });
});

test("query audit selalu memakai outletId dari path", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");

  assert.equal(database.calls.length, 1);
  assert.equal(database.calls[0].where.outletId, "outlet-a");
  assert.deepEqual(database.calls[0].orderBy, [
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(database.calls[0].take, 51);
  assert.equal(database.calls[0].skip, 0);
});

test("manager tidak bisa membaca outlet lain yang bukan membershipnya", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-b/audit-logs", "manager-a");

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
  assert.equal(database.calls.length, 0);
});

test("manager tanpa membership ditolak", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-none");

  assert.equal(response.status, 403);
  assert.equal(database.calls.length, 0);
});

test("crew ditolak walaupun punya membership outlet", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "crew-a");

  assert.equal(response.status, 403);
  assert.equal(database.calls.length, 0);
});

test("owner mitra ditolak dari endpoint manager", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "owner-a");

  assert.equal(response.status, 403);
  assert.equal(database.calls.length, 0);
});

test("request tanpa autentikasi ditolak", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs");

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
  assert.equal(database.calls.length, 0);
});

test("event dengan outletId null tidak pernah masuk hasil manager", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    body.data.auditLogs.some((row) => row.id === "audit-null"),
    false,
  );
  assert.equal(database.calls[0].where.outletId, "outlet-a");
});
test("filter action, resourceType, actorUserId, outcome, from, dan to diterapkan", async () => {
  const entries = [
    createEntry({
      id: "in-range",
      createdAt: new Date("2026-11-05T03:00:00.000Z"),
    }),
    createEntry({
      id: "wrong-action",
      action: "EXPENSE_CREATED",
      resourceType: "Expense",
      actorUserId: "manager-a",
      createdAt: new Date("2026-11-06T03:00:00.000Z"),
    }),
    createEntry({
      id: "out-of-range",
      createdAt: new Date("2026-11-20T03:00:00.000Z"),
    }),
  ];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const response = await request(
    app,
    "/api/v1/outlets/outlet-a/audit-logs?from=2026-11-01&to=2026-11-10&action=ORDER_CREATED&resourceType=Order&actorUserId=crew-a&outcome=SUCCESS",
    "manager-a",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.data.auditLogs.map((row) => row.id),
    ["in-range"],
  );
  const { where } = database.calls[0];
  assert.equal(where.outletId, "outlet-a");
  assert.equal(where.action, "ORDER_CREATED");
  assert.equal(where.resourceType, "Order");
  assert.equal(where.actorUserId, "crew-a");
  assert.equal(where.outcome, "SUCCESS");
  assert.equal(where.createdAt.gte.toISOString(), "2026-10-31T17:00:00.000Z");
  assert.equal(where.createdAt.lt.toISOString(), "2026-11-09T17:00:00.000Z");
});

test("pagination memakai pageSize + 1 dan skip sesuai halaman", async () => {
  const entries = [
    createEntry({ id: "page-1", createdAt: new Date("2026-11-10T03:00:00.000Z") }),
    createEntry({ id: "page-2", createdAt: new Date("2026-11-09T03:00:00.000Z") }),
    createEntry({ id: "page-3", createdAt: new Date("2026-11-08T03:00:00.000Z") }),
  ];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const first = await request(
    app,
    "/api/v1/outlets/outlet-a/audit-logs?page=1&pageSize=2",
    "manager-a",
  );
  const firstBody = await first.json();
  assert.equal(firstBody.data.auditLogs.length, 2);
  assert.equal(firstBody.data.pagination.hasNextPage, true);
  assert.equal(database.calls[0].take, 3);
  assert.equal(database.calls[0].skip, 0);

  const second = await request(
    app,
    "/api/v1/outlets/outlet-a/audit-logs?page=2&pageSize=2",
    "manager-a",
  );
  const secondBody = await second.json();
  assert.equal(secondBody.data.auditLogs.length, 1);
  assert.equal(secondBody.data.pagination.hasNextPage, false);
  assert.equal(database.calls[1].skip, 2);
});

test("metadata sensitif disanitasi rekursif dan actor email tidak dikirim", async () => {
  const entries = [
    createEntry({
      id: "sensitive",
      metadata: {
        password: "plain",
        nested: { token: "abc", keep: "ok" },
        list: [{ secret: "s", note: "n" }],
      },
    }),
  ];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");
  const body = await response.json();
  const [row] = body.data.auditLogs;

  assert.equal(row.metadata.password, "[REDACTED]");
  assert.equal(row.metadata.nested.token, "[REDACTED]");
  assert.equal(row.metadata.nested.keep, "ok");
  assert.equal(row.metadata.list[0].secret, "[REDACTED]");
  assert.equal(row.metadata.list[0].note, "n");
  assert.deepEqual(row.actor, { id: "crew-a", name: "Crew A" });
  assert.equal("email" in row.actor, false);
  assert.equal("sessionId" in row, false);
});

test("endpoint manager tidak punya handler mutasi", async () => {
  const database = createDatabase();
  const app = makeApp(database);
  const path = "/api/v1/outlets/outlet-a/audit-logs";

  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await request(app, path, "manager-a", { method });
    assert.equal(response.status, 404, `${method} seharusnya 404`);
  }
  assert.equal(database.calls.length, 0);
});

test("validasi query menolak outletId, outcome asing, rentang tanggal, dan page invalid", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const cases = [
    "/api/v1/outlets/outlet-a/audit-logs?outletId=outlet-b",
    "/api/v1/outlets/outlet-a/audit-logs?outcome=MAYBE",
    "/api/v1/outlets/outlet-a/audit-logs?from=2026-11-10&to=2026-11-01",
    "/api/v1/outlets/outlet-a/audit-logs?from=2026-11-10&to=2026-11-10",
    "/api/v1/outlets/outlet-a/audit-logs?from=2026-02-31&to=2026-03-05",
    "/api/v1/outlets/outlet-a/audit-logs?page=0",
  ];

  for (const path of cases) {
    const response = await request(app, path, "manager-a");
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }
  assert.equal(database.calls.length, 0);
});

test("endpoint admin pusat tetap berperilaku sama", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(
    app,
    "/api/v1/admin/audit-logs?page=1&pageSize=10",
    "admin",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.auditLogs.length, 3);
  assert.equal(body.data.auditLogs[0].actor.email, "crew-a@seroo.test");

  const filtered = await request(
    app,
    "/api/v1/admin/audit-logs?outletId=outlet-a",
    "admin",
  );
  const filteredBody = await filtered.json();
  assert.equal(filtered.status, 200);
  assert.equal(
    filteredBody.data.auditLogs.every((row) => row.outletId === "outlet-a"),
    true,
  );

  const crewResponse = await request(app, "/api/v1/admin/audit-logs", "crew-a");
  assert.equal(crewResponse.status, 403);
});

test("metadata manager menyensor email dan kontak tanpa mengubah data asli", async () => {
  const originalMetadata = {
    role: "CREW",
    quantity: 3,
    email: "crew@seroo.test",
    Email: "Crew@Seroo.test",
    EMAIL: "CREW@SEROO.TEST",
    phoneNumber: "0812-3456-7890",
    PhoneNumber: "0812-0000-1111",
    telepon: "0812-2222-3333",
    whatsapp: "0812-4444-5555",
    whatsappNumber: "0812-6666-7777",
    nested: { email: "nested@seroo.test", keep: "ok" },
    list: [{ phone: "0812-8888-9999", name: "Budi" }],
  };
  const entries = [createEntry({ id: "pii", metadata: originalMetadata })];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");
  const body = await response.json();
  const [row] = body.data.auditLogs;

  for (const key of [
    "email",
    "Email",
    "EMAIL",
    "phoneNumber",
    "PhoneNumber",
    "telepon",
    "whatsapp",
    "whatsappNumber",
  ]) {
    assert.equal(row.metadata[key], "[REDACTED]", key);
  }
  assert.equal(row.metadata.role, "CREW");
  assert.equal(row.metadata.quantity, 3);
  assert.equal(row.metadata.nested.email, "[REDACTED]");
  assert.equal(row.metadata.nested.keep, "ok");
  assert.equal(row.metadata.list[0].phone, "[REDACTED]");
  assert.equal(row.metadata.list[0].name, "Budi");

  assert.equal(database.rows[0].metadata.email, "crew@seroo.test");
  assert.equal(database.rows[0].metadata.phoneNumber, "0812-3456-7890");
});

test("event akun historis tidak muncul di feed manager", async () => {
  const entries = [
    createEntry({ id: "op-order", action: "ORDER_CREATED" }),
    createEntry({
      id: "acc-created",
      action: "ACCOUNT_CREATED",
      resourceType: "User",
      metadata: { role: "CREW", email: "new@seroo.test" },
    }),
    createEntry({
      id: "acc-deactivated",
      action: "ACCOUNT_DEACTIVATED",
      resourceType: "User",
    }),
    createEntry({
      id: "acc-activated",
      action: "ACCOUNT_ACTIVATED",
      resourceType: "User",
    }),
    createEntry({
      id: "password-reset",
      action: "PASSWORD_RESET",
      resourceType: "User",
    }),
  ];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const response = await request(app, "/api/v1/outlets/outlet-a/audit-logs", "manager-a");
  const body = await response.json();

  assert.deepEqual(
    body.data.auditLogs.map((row) => row.id),
    ["op-order", "acc-created"],
  );
  const created = body.data.auditLogs.find((row) => row.id === "acc-created");
  assert.equal(created.metadata.email, "[REDACTED]");
  assert.equal(created.metadata.role, "CREW");
  assert.equal(
    database.calls[0].where.action.notIn.includes("ACCOUNT_DEACTIVATED"),
    true,
  );
});

test("filter action yang dikecualikan mengembalikan halaman kosong tanpa query", async () => {
  const database = createDatabase();
  const app = makeApp(database);

  const response = await request(
    app,
    "/api/v1/outlets/outlet-a/audit-logs?action=PASSWORD_RESET",
    "manager-a",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.auditLogs, []);
  assert.equal(body.data.pagination.hasNextPage, false);
  assert.equal(database.calls.length, 0);
});

test("admin pusat tetap melihat event akun dan metadata email asli", async () => {
  const entries = [
    createEntry({
      id: "acc-deactivated",
      action: "ACCOUNT_DEACTIVATED",
      resourceType: "User",
      outletId: null,
      metadata: { isActive: false },
    }),
    createEntry({
      id: "acc-created",
      action: "ACCOUNT_CREATED",
      resourceType: "User",
      metadata: { role: "CREW", email: "new@seroo.test" },
    }),
    createEntry({
      id: "password-reset",
      action: "PASSWORD_RESET",
      resourceType: "User",
    }),
  ];
  const database = createDatabase({ entries });
  const app = makeApp(database);

  const response = await request(
    app,
    "/api/v1/admin/audit-logs?page=1&pageSize=10",
    "admin",
  );
  const body = await response.json();
  const ids = body.data.auditLogs.map((row) => row.id);

  assert.equal(response.status, 200);
  assert.equal(ids.includes("acc-deactivated"), true);
  assert.equal(ids.includes("password-reset"), true);
  const created = body.data.auditLogs.find((row) => row.id === "acc-created");
  assert.equal(created.metadata.email, "new@seroo.test");
});


