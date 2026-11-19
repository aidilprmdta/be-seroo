import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-19T10:00:00.000Z");

function createToken(userId, sessionId = `session-${userId}`) {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: new Date(),
  });
}

function createLossReportDatabase() {
  const state = {
    users: [
      { id: "user-manager-rumbai", name: "Manager Rumbai", email: "mgr.rumbai@seroo.id", isActive: true },
      { id: "user-crew-rumbai", name: "Crew Rumbai", email: "crew.rumbai@seroo.id", isActive: true },
      { id: "user-manager-panam", name: "Manager Panam", email: "mgr.panam@seroo.id", isActive: true },
      { id: "user-owner", name: "Owner Outlet", email: "owner@seroo.id", isActive: true },
      { id: "user-owner-mitra", name: "Owner Mitra", email: "owner.mitra@seroo.id", isActive: true },
      { id: "user-unauthorized", name: "Stranger", email: "stranger@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-panam", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
    ],
    memberships: [
      { userId: "user-manager-rumbai", outletId: "outlet-rumbai", role: "MANAGER" },
      { userId: "user-crew-rumbai", outletId: "outlet-rumbai", role: "CREW" },
      { userId: "user-manager-panam", outletId: "outlet-panam", role: "MANAGER" },
      { userId: "user-owner", outletId: "outlet-rumbai", role: "OWNER" },
      { userId: "user-owner-mitra", outletId: "outlet-rumbai", role: "OWNER_MITRA" },
    ],
    inventoryItems: [
      { id: "item-tea-leaves", name: "Daun Teh Hitam", unit: "kg", isActive: true },
      { id: "item-sugar", name: "Gula Pasir", unit: "kg", isActive: true },
      { id: "item-panam-only", name: "Sirup Pandan", unit: "botol", isActive: true },
      { id: "item-inactive", name: "Susu Basi", unit: "kaleng", isActive: false },
    ],
    outletStocks: [
      {
        id: "stock-tea-rumbai",
        outletId: "outlet-rumbai",
        inventoryItemId: "item-tea-leaves",
        quantity: new Prisma.Decimal("10.000"),
        minimumQuantity: new Prisma.Decimal("1.000"),
        updatedAt: NOW,
      },
      {
        id: "stock-sugar-rumbai",
        outletId: "outlet-rumbai",
        inventoryItemId: "item-sugar",
        quantity: new Prisma.Decimal("2.500"),
        minimumQuantity: new Prisma.Decimal("0.500"),
        updatedAt: NOW,
      },
      {
        id: "stock-panam-item",
        outletId: "outlet-panam",
        inventoryItemId: "item-panam-only",
        quantity: new Prisma.Decimal("5.000"),
        minimumQuantity: new Prisma.Decimal("1.000"),
        updatedAt: NOW,
      },
    ],
    lossReports: [],
    stockMovements: [],
    auditLogs: [],
  };

  const prisma = {
    $queryRaw: async () => [{ 1: 1 }],
    authSession: {
      findUnique: async ({ where }) => {
        const userId = where.id.replace("session-", "");
        const user = state.users.find((u) => u.id === userId);
        if (!user) return null;
        return {
          id: where.id,
          userId: user.id,
          revokedAt: null,
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          user: { id: user.id, isActive: user.isActive, mustChangePassword: false },
        };
      },
    },
    outletMembership: {
      findUnique: async ({ where }) => {
        const { userId, outletId } = where.userId_outletId || {};
        const m = state.memberships.find(
          (item) => item.userId === userId && item.outletId === outletId,
        );
        if (!m) return null;
        const outlet = state.outlets.find((o) => o.id === outletId);
        return { ...m, outlet };
      },
    },
    inventoryItem: {
      findUnique: async ({ where }) => {
        return state.inventoryItems.find((i) => i.id === where.id) || null;
      },
    },
    outletStock: {
      findUnique: async ({ where }) => {
        const { outletId, inventoryItemId } = where.outletId_inventoryItemId || {};
        const s = state.outletStocks.find(
          (item) => item.outletId === outletId && item.inventoryItemId === inventoryItemId,
        );
        if (!s) return null;
        const item = state.inventoryItems.find((i) => i.id === inventoryItemId);
        return { ...s, inventoryItem: item };
      },
      updateMany: async ({ where, data }) => {
        const { outletId, inventoryItemId, quantity } = where;
        const s = state.outletStocks.find(
          (item) => item.outletId === outletId && item.inventoryItemId === inventoryItemId,
        );
        if (!s) return { count: 0 };
        if (quantity?.gte) {
          const reqGte = new Prisma.Decimal(quantity.gte);
          if (new Prisma.Decimal(s.quantity).lt(reqGte)) {
            return { count: 0 };
          }
        }
        if (data.quantity?.decrement) {
          s.quantity = new Prisma.Decimal(s.quantity).sub(new Prisma.Decimal(data.quantity.decrement));
        } else if (data.quantity?.increment) {
          s.quantity = new Prisma.Decimal(s.quantity).add(new Prisma.Decimal(data.quantity.increment));
        }
        return { count: 1 };
      },
    },
    lossReport: {
      findUnique: async ({ where, select, include }) => {
        const r = state.lossReports.find((item) => item.id === where.id);
        if (!r) return null;
        const res = { ...r };
        if (include?.reportedBy) {
          const u = state.users.find((user) => user.id === r.reportedById);
          res.reportedBy = u ? { id: u.id, name: u.name } : null;
        }
        if (include?.reviewedBy) {
          const u = state.users.find((user) => user.id === r.reviewedById);
          res.reviewedBy = u ? { id: u.id, name: u.name } : null;
        }
        if (include?.inventoryItem) {
          const itm = state.inventoryItems.find((i) => i.id === r.inventoryItemId);
          res.inventoryItem = itm ? { id: itm.id, name: itm.name, unit: itm.unit } : null;
        }
        return res;
      },
      findMany: async ({ where, include, orderBy }) => {
        let list = state.lossReports.filter((item) => {
          if (where.outletId && item.outletId !== where.outletId) return false;
          if (where.reportedById && item.reportedById !== where.reportedById) return false;
          if (where.status && item.status !== where.status) return false;
          return true;
        });

        return list.map((r) => {
          const res = { ...r };
          if (include?.reportedBy) {
            const u = state.users.find((user) => user.id === r.reportedById);
            res.reportedBy = u ? { id: u.id, name: u.name } : null;
          }
          if (include?.reviewedBy) {
            const u = state.users.find((user) => user.id === r.reviewedById);
            res.reviewedBy = u ? { id: u.id, name: u.name } : null;
          }
          if (include?.inventoryItem) {
            const itm = state.inventoryItems.find((i) => i.id === r.inventoryItemId);
            res.inventoryItem = itm ? { id: itm.id, name: itm.name, unit: itm.unit } : null;
          }
          return res;
        });
      },
      create: async ({ data, include }) => {
        const id = `report-${state.lossReports.length + 1}`;
        const newReport = {
          id,
          outletId: data.outletId,
          reportedById: data.reportedById,
          inventoryItemId: data.inventoryItemId,
          itemName: data.itemName,
          quantity: new Prisma.Decimal(data.quantity),
          unit: data.unit,
          reason: data.reason,
          description: data.description ?? null,
          status: data.status || "PENDING",
          reviewedById: null,
          reviewedAt: null,
          reviewNote: null,
          createdAt: data.createdAt || NOW,
          updatedAt: data.createdAt || NOW,
        };
        state.lossReports.push(newReport);
        const res = { ...newReport };
        if (include?.reportedBy) {
          const u = state.users.find((user) => user.id === newReport.reportedById);
          res.reportedBy = u ? { id: u.id, name: u.name } : null;
        }
        if (include?.inventoryItem) {
          const itm = state.inventoryItems.find((i) => i.id === newReport.inventoryItemId);
          res.inventoryItem = itm ? { id: itm.id, name: itm.name, unit: itm.unit } : null;
        }
        return res;
      },
      updateMany: async ({ where, data }) => {
        const r = state.lossReports.find(
          (item) => item.id === where.id && (!where.status || item.status === where.status),
        );
        if (!r) return { count: 0 };
        if (data.status) r.status = data.status;
        if (data.reviewedById) r.reviewedById = data.reviewedById;
        if (data.reviewedAt) r.reviewedAt = data.reviewedAt;
        if (data.reviewNote !== undefined) r.reviewNote = data.reviewNote;
        return { count: 1 };
      },
    },
    stockMovement: {
      create: async ({ data }) => {
        const movement = {
          id: data.id || `sm-${state.stockMovements.length + 1}`,
          outletId: data.outletId,
          inventoryItemId: data.inventoryItemId,
          createdById: data.createdById,
          type: data.type,
          quantity: new Prisma.Decimal(data.quantity),
          note: data.note ?? null,
          lossReportId: data.lossReportId ?? null,
          createdAt: data.createdAt || NOW,
        };
        state.stockMovements.push(movement);
        return movement;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const audit = {
          id: `audit-${state.auditLogs.length + 1}`,
          ...data,
          createdAt: NOW,
        };
        state.auditLogs.push(audit);
        return audit;
      },
    },
    $transaction: async (fn) => {
      const snapshot = JSON.stringify({
        lossReports: state.lossReports,
        outletStocks: state.outletStocks,
        stockMovements: state.stockMovements,
        auditLogs: state.auditLogs,
      });
      try {
        return await fn(prisma);
      } catch (err) {
        if (err?.code !== "ALREADY_PROCESSED") {
          const parsed = JSON.parse(snapshot);
          state.lossReports = parsed.lossReports.map((r) => ({
            ...r,
            quantity: new Prisma.Decimal(r.quantity),
          }));
          state.outletStocks = parsed.outletStocks.map((s) => ({
            ...s,
            quantity: new Prisma.Decimal(s.quantity),
            minimumQuantity: new Prisma.Decimal(s.minimumQuantity),
          }));
          state.stockMovements = parsed.stockMovements.map((m) => ({
            ...m,
            quantity: new Prisma.Decimal(m.quantity),
          }));
          state.auditLogs = parsed.auditLogs;
        }
        throw err;
      }
    },
  };

  return { prisma, state };
}

test("1. Crew berhasil membuat laporan kehilangan", async () => {
  const { prisma, state } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-crew-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-tea-leaves",
      quantity: "1.500",
      reason: "Tumpah di meja racik",
      description: "Tersenggol saat shift siang",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.itemName, "Daun Teh Hitam");
  assert.equal(body.data.quantity, "1.5");
  assert.equal(body.data.unit, "kg");
  assert.equal(body.data.status, "PENDING");
  assert.equal(body.data.reason, "Tumpah di meja racik");
});

test("2. Laporan baru selalu berstatus PENDING", async () => {
  const { prisma, state } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-crew-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-sugar",
      quantity: "0.500",
      reason: "Kemasan sobek",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.status, "PENDING");
  assert.equal(state.lossReports[0].status, "PENDING");
});

test("3. Membuat laporan TIDAK mengubah stok outlet", async () => {
  const { prisma, state } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const initialStock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  ).quantity.toString();

  const token = createToken("user-crew-rumbai");
  await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-tea-leaves",
      quantity: "2.000",
      reason: "Kehilangan",
    }),
  });

  const currentStock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  ).quantity.toString();

  assert.equal(currentStock, initialStock);
});

test("4. Membuat laporan TIDAK membuat StockMovement", async () => {
  const { prisma, state } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-crew-rumbai");
  await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-tea-leaves",
      quantity: "1.000",
      reason: "Hilang",
    }),
  });

  assert.equal(state.stockMovements.length, 0);
});

test("5. Crew tidak dapat memproses/review laporan (403)", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-1",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Hilang",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-crew-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-1/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: "CONFIRMED",
      reviewNote: "Saya setujui sendiri",
    }),
  });

  assert.equal(res.status, 403);
  assert.equal(state.lossReports[0].status, "PENDING");
});

test("6. Manager dapat melihat laporan outletnya", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-1",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Hilang",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, "rep-1");
  assert.equal(body.meta.summary.PENDING, 1);
});

test("7. Manager tidak dapat melihat laporan outlet lain", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-rumbai",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Hilang",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  // Manager Panam mencoba melihat laporan outlet Rumbai -> 403 (membership check fails)
  const token = createToken("user-manager-panam");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 403);
});

test("8. Manager berhasil mengonfirmasi laporan (CONFIRMED)", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-confirm",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("2.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-confirm/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: "CONFIRMED",
      reviewNote: "Diverifikasi CCTV, disetujui",
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.status, "CONFIRMED");
  assert.equal(body.data.reviewNote, "Diverifikasi CCTV, disetujui");
});

test("9. Konfirmasi menghasilkan satu StockMovement bertipe LOSS", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-sm",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Bocor",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-sm/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "CONFIRMED" }),
  });

  assert.equal(state.stockMovements.length, 1);
  const sm = state.stockMovements[0];
  assert.equal(sm.type, "LOSS");
  assert.equal(sm.lossReportId, "rep-sm");
  assert.equal(sm.quantity.toString(), "-1");
});

test("10. Konfirmasi mengurangi stok dengan benar", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-deduct",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("3.000"),
    unit: "kg",
    reason: "Bocor",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-deduct/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "CONFIRMED" }),
  });

  const stock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  );
  // Awalnya 10.000, dikurangi 3.000 -> sisa 7.000
  assert.equal(stock.quantity.toString(), "7");
});

test("11. Penolakan (REJECTED) tidak mengurangi stok", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-reject",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("2.000"),
    unit: "kg",
    reason: "Klaim hilang",
    status: "PENDING",
    createdAt: NOW,
  });

  const initialStock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  ).quantity.toString();

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-reject/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: "REJECTED",
      reviewNote: "Barang ternyata terselip, tidak hilang",
    }),
  });

  assert.equal(res.status, 200);
  const currentStock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  ).quantity.toString();
  assert.equal(currentStock, initialStock);
});

test("12. Penolakan tidak menghasilkan StockMovement", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-reject-2",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Klaim hilang",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-reject-2/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "REJECTED", reviewNote: "Barang tidak rusak" }),
  });

  assert.equal(state.stockMovements.length, 0);
});

test("13. Penolakan menyimpan reviewNote", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-note",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Klaim",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-note/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      status: "REJECTED",
      reviewNote: "Tidak valid karena tidak ada bukti fisik",
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.reviewNote, "Tidak valid karena tidak ada bukti fisik");
});

test("14. Laporan yang sudah diproses tidak dapat diproses ulang (409)", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-done",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "CONFIRMED",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-done/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "REJECTED", reviewNote: "Sudah diproses sebelumnya" }),
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "ALREADY_PROCESSED");
});

test("15. Dua request konfirmasi bersamaan tidak mengurangi stok dua kali", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-race",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("2.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const [res1, res2] = await Promise.all([
    app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-race/review", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    }),
    app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-race/review", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    }),
  ]);

  const statuses = [res1.status, res2.status];
  assert.ok(statuses.includes(200));
  assert.ok(statuses.includes(409));

  // Pastikan hanya berkurang 2.000 (dari 10 -> 8), bukan 4.000
  const stock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  );
  assert.equal(stock.quantity.toString(), "8");
  assert.equal(state.stockMovements.length, 1);
});

test("16. Quantity kehilangan lebih besar daripada stok menghasilkan error (409)", async () => {
  const { prisma, state } = createLossReportDatabase();
  // Gula pasir hanya 2.500 kg
  state.lossReports.push({
    id: "rep-over",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-sugar",
    itemName: "Gula Pasir",
    quantity: new Prisma.Decimal("5.000"), // melebihi stok 2.500
    unit: "kg",
    reason: "Bocor total",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-over/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "CONFIRMED" }),
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "INSUFFICIENT_STOCK");

  // Status laporan tetap PENDING dan stok tidak berubah
  assert.equal(state.lossReports[0].status, "PENDING");
  const sugarStock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-sugar",
  );
  assert.equal(sugarStock.quantity.toString(), "2.5");
});

test("17. Jika transaction gagal, perubahan status dan stok di-rollback", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-rollback",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Rollback test",
    status: "PENDING",
    createdAt: NOW,
  });

  // Simulasi error di tengah transaksi pada stockMovement.create
  prisma.stockMovement.create = async () => {
    throw new Error("DB_CRASH");
  };

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports/rep-rollback/review", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: "CONFIRMED" }),
  });

  assert.equal(res.status, 500);
  // Laporan tetap PENDING
  const report = state.lossReports.find((r) => r.id === "rep-rollback");
  assert.equal(report.status, "PENDING");
});

test("18. User yang tidak memiliki akses tidak dapat membaca laporan (403)", async () => {
  const { prisma } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-unauthorized");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 403);
});

test("19. Inventory item yang tidak termasuk outlet tidak dapat dilaporkan (404)", async () => {
  const { prisma } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-crew-rumbai");
  const res = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-panam-only", // tidak ada di outlet-rumbai
      quantity: "1.000",
      reason: "Item nyasar",
    }),
  });

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "INVENTORY_ITEM_NOT_FOUND");
});

test("20. AuditLog tercatat untuk tindakan yang berhasil", async () => {
  const { prisma, state } = createLossReportDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const crewToken = createToken("user-crew-rumbai");
  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${crewToken}`,
    },
    body: JSON.stringify({
      inventoryItemId: "item-tea-leaves",
      quantity: "1.000",
      reason: "Tumpah",
    }),
  });
  assert.equal(createRes.status, 201);
  const reportData = await createRes.json();

  const mgrToken = createToken("user-manager-rumbai");
  const reviewRes = await app.request(
    `/api/v1/outlets/outlet-rumbai/loss-reports/${reportData.data.id}/review`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mgrToken}`,
      },
      body: JSON.stringify({ status: "CONFIRMED", reviewNote: "Audit checked" }),
    },
  );
  assert.equal(reviewRes.status, 200);

  const actions = state.auditLogs.map((a) => a.action);
  assert.ok(actions.includes("LOSS_REPORT_CREATED"));
  assert.ok(actions.includes("LOSS_REPORT_CONFIRMED"));
});

test("21. TASK 04.1: Penolakan (REJECTED) tanpa reviewNote ditolak 400 VALIDATION_ERROR", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-reject-no-note",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-reject-no-note/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "REJECTED" }),
    },
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(state.lossReports[0].status, "PENDING");
});

test("22. TASK 04.1: Penolakan (REJECTED) dengan reviewNote hanya spasi ditolak 400", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-reject-space",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-reject-space/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "REJECTED", reviewNote: "     " }),
    },
  );

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(state.lossReports[0].status, "PENDING");
});

test("23. TASK 04.1: Role OWNER atau OWNER_MITRA tidak dapat melakukan review (403 FORBIDDEN)", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-owner-test",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Tumpah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  // Test OWNER
  const ownerToken = createToken("user-owner");
  const resOwner = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-owner-test/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    },
  );
  assert.equal(resOwner.status, 403);

  // Test OWNER_MITRA
  const ownerMitraToken = createToken("user-owner-mitra");
  const resOwnerMitra = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-owner-test/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerMitraToken}`,
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    },
  );
  assert.equal(resOwnerMitra.status, 403);
  assert.equal(state.lossReports[0].status, "PENDING");
});

test("24. TASK 04.1: AuditLog tercatat menggunakan transaction client yang sama (atomik)", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-audit-tx",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Pecah",
    status: "PENDING",
    createdAt: NOW,
  });

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-audit-tx/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "CONFIRMED", reviewNote: "Setuju" }),
    },
  );

  assert.equal(res.status, 200);
  assert.equal(state.auditLogs.length, 1);
  assert.equal(state.auditLogs[0].action, "LOSS_REPORT_CONFIRMED");
  assert.equal(state.auditLogs[0].resourceId, "rep-audit-tx");
});

test("25. TASK 04.1: Rollback transaksi mencegah tersimpannya AuditLog jika transaksi gagal", async () => {
  const { prisma, state } = createLossReportDatabase();
  state.lossReports.push({
    id: "rep-audit-rollback",
    outletId: "outlet-rumbai",
    reportedById: "user-crew-rumbai",
    inventoryItemId: "item-tea-leaves",
    itemName: "Daun Teh Hitam",
    quantity: new Prisma.Decimal("1.000"),
    unit: "kg",
    reason: "Pecah",
    status: "PENDING",
    createdAt: NOW,
  });

  // Simulasikan crash di tahap akhir transaksi
  const originalAuditCreate = prisma.auditLog.create;
  prisma.auditLog.create = async () => {
    throw new Error("AUDIT_LOG_CRASH");
  };

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });

  const token = createToken("user-manager-rumbai");
  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/loss-reports/rep-audit-rollback/review",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    },
  );

  assert.equal(res.status, 500);
  // Status laporan tidak boleh CONFIRMED (harus rollback ke PENDING)
  const report = state.lossReports.find((r) => r.id === "rep-audit-rollback");
  assert.equal(report.status, "PENDING");
  // Stok tidak boleh berkurang
  const stock = state.outletStocks.find(
    (s) => s.outletId === "outlet-rumbai" && s.inventoryItemId === "item-tea-leaves",
  );
  assert.equal(stock.quantity.toString(), "10");
  // StockMovement tidak boleh ada
  assert.equal(state.stockMovements.length, 0);
  // AuditLog tidak boleh ada yang tersimpan
  assert.equal(state.auditLogs.length, 0);
});
