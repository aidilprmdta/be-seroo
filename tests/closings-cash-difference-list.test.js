import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createClosingRoutes } from "../src/closings/routes.js";
import { ClosingError } from "../src/closings/errors.js";

function createPrisma() {
  const queries = [];
  const prisma = {
    outletMembership: {
      async findUnique() {
        return { role: "MANAGER", outlet: { isActive: true } };
      },
    },
    closingRecord: {
      async findMany(args) {
        queries.push(args);
        return [
          {
            id: "closing-1",
            outletId: "outlet-a",
            closingType: "DAILY",
            periodKey: "2026-11-25",
            status: "CLOSED",
            version: 1,
            closedAt: new Date("2026-11-25T10:00:00Z"),
            closedBy: { id: "user-manager", name: "Manager" },
            reopenedAt: null,
            reopenedBy: null,
            reopenReason: null,
            notes: null,
            unfinishedCount: 0,
            actualCash: { toString: () => "1000000" },
            cashDifference: { toString: () => "15000" },
            differenceReason: "kurang setor",
            cashDifferenceStatus: "SEDANG_DIPERIKSA",
            cashDifferenceReviewNote: "sedang dicek",
            cashDifferenceReviewedAt: new Date("2026-11-25T11:00:00Z"),
            summarySnapshot: { totalIncome: "0" },
            history: [],
            audits: [],
          },
        ];
      },
    },
  };
  return { prisma, queries };
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
    return c.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR" } },
      500,
    );
  });
  return app.route("/api/v1/outlets", routes);
}

test("closing list mengembalikan field selisih kas yang dipakai layar pemeriksaan", async () => {
  const { prisma, queries } = createPrisma();
  const app = createApp(prisma);

  const response = await app.request(
    "/api/v1/outlets/outlet-a/closings?type=DAILY",
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(queries[0].where.closingType, "DAILY");
  assert.equal(queries[0].take, 50);
  assert.equal(body.data.closings.length, 1);

  const [closing] = body.data.closings;
  assert.equal(closing.periodKey, "2026-11-25");
  assert.equal(closing.cashDifference, "15000");
  assert.equal(closing.cashDifferenceStatus, "SEDANG_DIPERIKSA");
  assert.equal(closing.cashDifferenceReviewNote, "sedang dicek");
  assert.equal(closing.cashDifferenceReviewedAt, "2026-11-25T11:00:00.000Z");
});

test("closing list tanpa filter tipe mengembalikan semua tipe closing", async () => {
  const { prisma, queries } = createPrisma();
  const app = createApp(prisma);

  const response = await app.request("/api/v1/outlets/outlet-a/closings");

  assert.equal(response.status, 200);
  assert.equal(queries[0].where.closingType, undefined);
});
