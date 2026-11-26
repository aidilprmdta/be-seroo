import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createClosingRoutes } from "../src/closings/routes.js";
import { ClosingError } from "../src/closings/errors.js";

function createPrisma({ role = "MANAGER", difference = "15000" } = {}) {
  const state = { updated: null, audits: [] };
  const prisma = {
    outletMembership: {
      async findUnique() {
        return { role, outlet: { isActive: true } };
      },
    },
    closingRecord: {
      async findFirst() {
        return {
          id: "closing-1",
          outletId: "outlet-a",
          closingType: "DAILY",
          periodKey: "2026-11-25",
          cashDifference: difference,
          cashDifferenceStatus: "BELUM_DIPERIKSA",
          cashDifferenceReviewNote: null,
        };
      },
      async update({ data }) {
        state.updated = data;
        return {
          id: "closing-1",
          outletId: "outlet-a",
          closingType: "DAILY",
          periodKey: "2026-11-25",
          cashDifference: { toString: () => "15000" },
          ...data,
          cashDifferenceReviewedAt: data.cashDifferenceReviewedAt,
        };
      },
    },
    auditLog: {
      async create({ data }) {
        state.audits.push(data);
        return { id: `audit-${state.audits.length}` };
      },
    },
  };
  return { prisma, state };
}

function createApp(prisma) {
  const authenticate = async (c, next) => {
    c.set("auth", { userId: "user-manager", sessionId: "session-1" });
    await next();
  };
  const routes = createClosingRoutes({
    prisma,
    authenticationMiddleware: authenticate,
    now: () => new Date("2026-11-25T12:00:00Z"),
  });
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof ClosingError) {
      return c.json(
        { success: false, error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    return c.json({ success: false, error: { code: "INTERNAL_SERVER_ERROR" } }, 500);
  });
  return app.route("/api/v1/outlets", routes);
}

test("manager can update cash difference investigation status", async () => {
  const { prisma, state } = createPrisma();
  const app = createApp(prisma);

  const response = await app.request(
    "/api/v1/outlets/outlet-a/closings/closing-1/cash-difference",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "SUDAH_DIKETAHUI", note: "Sudah dihitung ulang" }),
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.closing.cashDifferenceStatus, "SUDAH_DIKETAHUI");
  assert.equal(body.data.closing.cashDifferenceReviewNote, "Sudah dihitung ulang");
  assert.equal(state.updated.cashDifferenceReviewedById, "user-manager");
  assert.equal(state.audits[0].action, "CASH_DIFFERENCE_REVIEWED");
  assert.equal(state.audits[0].metadata.status, "SUDAH_DIKETAHUI");
});

test("invalid investigation status is rejected", async () => {
  const { prisma } = createPrisma();
  const app = createApp(prisma);

  const response = await app.request(
    "/api/v1/outlets/outlet-a/closings/closing-1/cash-difference",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "SELESAI" }),
    },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});

test("closing without cash difference cannot be reviewed", async () => {
  const { prisma } = createPrisma({ difference: null });
  const app = createApp(prisma);

  const response = await app.request(
    "/api/v1/outlets/outlet-a/closings/closing-1/cash-difference",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "SEDANG_DIPERIKSA" }),
    },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "NO_CASH_DIFFERENCE");
});

test("owner cannot update cash difference status", async () => {
  const { prisma } = createPrisma({ role: "OWNER_MITRA" });
  const app = createApp(prisma);

  const response = await app.request(
    "/api/v1/outlets/outlet-a/closings/closing-1/cash-difference",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "SUDAH_DIKETAHUI" }),
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
});
