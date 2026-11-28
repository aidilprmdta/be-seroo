import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-13T10:00:00.000Z");

function token(userId, sessionId = "session-admin") {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createDb({ adminUserIds = new Set(["admin"]), outlets = [], orders = [] } = {}) {
  const sessions = {
    "session-admin": "admin",
    "session-manager": "manager",
  };

  return {
    authSession: {
      async findUnique({ where }) {
        const userId = sessions[where.id];
        if (!userId) return null;
        return {
          id: where.id,
          userId,
          revokedAt: null,
          expiresAt: new Date("2026-11-15T00:00:00.000Z"),
          lastSeenAt: NOW,
          createdAt: NOW,
          user: { id: userId, isActive: true, mustChangePassword: false },
        };
      },
      async updateMany() {},
    },
    outletMembership: {
      async findFirst({ where }) {
        if (where.role !== "ADMIN_PUSAT") return null;
        return adminUserIds.has(where.userId) ? { id: `mem-${where.userId}` } : null;
      },
    },
    outlet: {
      async findMany({ where }) {
        return outlets
          .filter(
            (outlet) =>
              outlet.ownershipType === where.ownershipType &&
              outlet.isActive === where.isActive,
          )
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    },
    order: {
      async groupBy({ where }) {
        const rows = orders.filter((order) => {
          if (!where.outletId.in.includes(order.outletId)) return false;
          if (order.status !== where.status) return false;
          if (where.createdAt.gte && order.createdAt < where.createdAt.gte) return false;
          if (where.createdAt.lt && order.createdAt >= where.createdAt.lt) return false;
          return true;
        });
        const grouped = new Map();
        for (const order of rows) {
          const current = grouped.get(order.outletId) || {
            outletId: order.outletId,
            total: new Prisma.Decimal("0.00"),
            count: 0,
          };
          current.total = current.total.add(new Prisma.Decimal(order.total));
          current.count += 1;
          grouped.set(order.outletId, current);
        }
        return [...grouped.values()].map((row) => ({
          outletId: row.outletId,
          _sum: { total: row.total },
          _count: { _all: row.count },
        }));
      },
    },
  };
}

function makeApp(prisma) {
  return createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    adminReportOptions: { now: () => NOW },
  });
}

async function request(app, path, sessionToken) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

const CENTRAL_A = {
  id: "central-a",
  code: "CENTRAL-A",
  name: "Central A",
  ownershipType: "PUSAT",
  isActive: true,
};
const CENTRAL_B = {
  id: "central-b",
  code: "CENTRAL-B",
  name: "Central B",
  ownershipType: "PUSAT",
  isActive: true,
};

test("central aggregation includes PUSAT outlets and excludes MITRA, NULL, and inactive outlets", async () => {
  const prisma = createDb({
    outlets: [
      CENTRAL_A,
      CENTRAL_B,
      { id: "partner", code: "PARTNER", name: "Partner", ownershipType: "MITRA", isActive: true },
      { id: "unknown", code: "UNKNOWN", name: "Unknown", ownershipType: null, isActive: true },
      { id: "inactive", code: "INACTIVE", name: "Inactive", ownershipType: "PUSAT", isActive: false },
    ],
    orders: [
      { outletId: "central-a", status: "COMPLETED", total: "50000.00", createdAt: new Date("2026-11-05T10:00:00Z") },
      { outletId: "central-a", status: "CANCELLED", total: "99999.00", createdAt: new Date("2026-11-05T11:00:00Z") },
      { outletId: "partner", status: "COMPLETED", total: "90000.00", createdAt: new Date("2026-11-05T10:00:00Z") },
      { outletId: "unknown", status: "COMPLETED", total: "70000.00", createdAt: new Date("2026-11-05T10:00:00Z") },
      { outletId: "inactive", status: "COMPLETED", total: "123.00", createdAt: new Date("2026-11-05T10:00:00Z") },
    ],
  });
  const app = makeApp(prisma);

  const response = await request(app, "/api/v1/admin/reports/outlets?month=2026-11", token("admin"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.outlets.map((outlet) => outlet.outletId), [
    "central-a",
    "central-b",
  ]);
  assert.equal(body.data.outlets[0].totalIncome, "50000.00");
  assert.equal(body.data.outlets[0].transactionCount, 1);
  assert.equal(body.data.outlets[1].totalIncome, "0.00");
  assert.equal(body.data.outlets[1].transactionCount, 0);
  assert.equal(body.data.totalIncome, "50000.00");
  assert.equal(body.data.transactionCount, 1);
  assert.equal(body.data.period.type, "MONTHLY");
  assert.equal(body.data.period.month, "2026-11");
  assert.equal(body.data.period.timezone, "Asia/Jakarta");
});

test("only COMPLETED orders inside Jakarta month boundaries are counted", async () => {
  const prisma = createDb({
    outlets: [CENTRAL_A],
    orders: [
      { outletId: "central-a", status: "COMPLETED", total: "10.00", createdAt: new Date("2026-10-31T16:59:59.999Z") },
      { outletId: "central-a", status: "COMPLETED", total: "100.00", createdAt: new Date("2026-10-31T17:00:00.000Z") },
      { outletId: "central-a", status: "COMPLETED", total: "200.00", createdAt: new Date("2026-11-30T16:59:59.999Z") },
      { outletId: "central-a", status: "COMPLETED", total: "300.00", createdAt: new Date("2026-11-30T17:00:00.000Z") },
      { outletId: "central-a", status: "CANCELLED", total: "400.00", createdAt: new Date("2026-11-15T10:00:00.000Z") },
    ],
  });
  const app = makeApp(prisma);

  const response = await request(app, "/api/v1/admin/reports/outlets?month=2026-11", token("admin"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.outlets[0].totalIncome, "300.00");
  assert.equal(body.data.outlets[0].transactionCount, 2);
});


test("admin without any PUSAT outlet receives an empty successful response", async () => {
  const prisma = createDb({
    outlets: [
      { id: "partner", code: "PARTNER", name: "Partner", ownershipType: "MITRA", isActive: true },
      { id: "unknown", code: "UNKNOWN", name: "Unknown", ownershipType: null, isActive: true },
    ],
  });
  const app = makeApp(prisma);

  const response = await request(app, "/api/v1/admin/reports/outlets?month=2026-11", token("admin"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.outlets, []);
  assert.equal(body.data.totalIncome, "0.00");
  assert.equal(body.data.transactionCount, 0);
});

test("non-admin is forbidden from the central aggregation endpoint", async () => {
  const prisma = createDb({ outlets: [CENTRAL_A] });
  const app = makeApp(prisma);

  const response = await request(
    app,
    "/api/v1/admin/reports/outlets?month=2026-11",
    token("manager", "session-manager"),
  );
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "FORBIDDEN");
});

test("month is required and validated", async () => {
  const prisma = createDb({ outlets: [CENTRAL_A] });
  const app = makeApp(prisma);

  const missing = await request(app, "/api/v1/admin/reports/outlets", token("admin"));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, "VALIDATION_ERROR");

  const invalid = await request(
    app,
    "/api/v1/admin/reports/outlets?month=2026-13",
    token("admin"),
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "VALIDATION_ERROR");
});

