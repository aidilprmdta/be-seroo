import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-14T10:00:00.000Z");

function createToken(userId, sessionId) {
  const finalSessionId = sessionId || `session-${userId.replace("user-", "")}`;
  return createAccessToken({
    userId,
    sessionId: finalSessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createE2eDatabase() {
  const state = {
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai Pilot", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-panam", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
      { id: "outlet-disabled", name: "Seroo Nonaktif", code: "SR-DISABLED", isActive: false },
    ],
    users: [
      { id: "user-crew", name: "Budi Crew", email: "crew@seroo.id", isActive: true },
      { id: "user-manager", name: "Dewi Manager", email: "manager@seroo.id", isActive: true },
      { id: "user-owner", name: "Pak Agus Owner", email: "owner@seroo.id", isActive: true },
    ],
    memberships: [
      { userId: "user-crew", outletId: "outlet-rumbai", role: "CREW" },
      { userId: "user-manager", outletId: "outlet-rumbai", role: "MANAGER" },
      { userId: "user-owner", outletId: "outlet-rumbai", role: "OWNER" },
      // Manager & Owner also have access to Panam, but Crew only has access to Rumbai
      { userId: "user-manager", outletId: "outlet-panam", role: "MANAGER" },
      { userId: "user-owner", outletId: "outlet-panam", role: "OWNER" },
    ],
    products: [
      { id: "prod-1", name: "Teh Tarik Klasik", isActive: true },
    ],
    variants: [
      { id: "var-reg", productId: "prod-1", name: "Regular", price: new Prisma.Decimal("10000.00"), isActive: true },
      { id: "var-lrg", productId: "prod-1", name: "Large", price: new Prisma.Decimal("13000.00"), isActive: true },
    ],
    inventoryItems: [
      { id: "inv-teh", name: "Daun Teh Hitam", unit: "gram", isActive: true },
      { id: "inv-susu", name: "Susu Evaporasi", unit: "ml", isActive: true },
    ],
    stocks: [
      { outletId: "outlet-rumbai", inventoryItemId: "inv-teh", quantity: new Prisma.Decimal("500.000") },
      { outletId: "outlet-rumbai", inventoryItemId: "inv-susu", quantity: new Prisma.Decimal("20.000") }, // low stock
      { outletId: "outlet-panam", inventoryItemId: "inv-teh", quantity: new Prisma.Decimal("100.000") },
    ],
    stockMovements: [],
    orders: [],
    expenses: [],
    waste: [],
    closings: [],
    histories: [],
    audits: [],
  };

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        const user = state.users.find((u) => u.id === where.id.replace("session-", "user-")) || state.users[0];
        return {
          id: where.id,
          userId: user.id,
          revokedAt: null,
          expiresAt: new Date("2026-11-20T00:00:00.000Z"),
          user: { id: user.id, isActive: user.isActive },
        };
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        const mem = state.memberships.find(
          (m) =>
            m.userId === where.userId_outletId.userId &&
            m.outletId === where.userId_outletId.outletId,
        );
        if (!mem) return null;
        const outlet = state.outlets.find((o) => o.id === mem.outletId);
        return {
          role: mem.role,
          outlet: { isActive: outlet?.isActive ?? false },
        };
      },
    },
    outlet: {
      async findUnique({ where }) {
        return state.outlets.find((o) => o.id === where.id) || null;
      },
    },
    product: {
      async findMany() {
        return state.products
          .filter((p) => p.isActive)
          .map((p) => ({
            ...p,
            variants: state.variants
              .filter((v) => v.productId === p.id && v.isActive)
              .map(({ id, name, price }) => ({ id, name, price })),
          }))
          .filter((p) => p.variants.length > 0);
      },
    },
    productVariant: {
      async findMany({ where }) {
        return state.variants
          .filter((v) => {
            if (where?.id?.in && !where.id.in.includes(v.id)) return false;
            return v.isActive;
          })
          .map((v) => ({
            ...v,
            product: state.products.find((p) => p.id === v.productId) || {
              id: v.productId,
              name: "Teh Tarik Klasik",
              isActive: true,
            },
          }));
      },
    },
    outletProductAvailability: {
      async findMany({ where, select }) {
        const results = [];
        if (where?.outletId === "outlet-rumbai") {
          const data = [
            { productId: "prod-1", outletId: "outlet-rumbai", isAvailable: true },
          ];
          if (select?.productId) {
            return data.map((d) => ({ productId: d.productId }));
          }
          results.push(...data);
        }
        return results;
      },
    },

    addOn: {
      async findMany() {
        return [];
      },
    },
    inventoryItem: {
      async findMany({ where }) {
        return state.inventoryItems.filter((i) => (where?.isActive !== undefined ? i.isActive === where.isActive : true));
      },
    },
    outletStock: {
      async findMany({ where }) {
        return state.stocks
          .filter((s) => s.outletId === where.outletId)
          .map((s) => ({ ...s, quantity: new Prisma.Decimal(s.quantity.toString()) }));
      },
      async findUnique({ where }) {
        const key = where.outletId_inventoryItemId;
        const found = state.stocks.find(
          (s) => s.outletId === key.outletId && s.inventoryItemId === key.inventoryItemId,
        );
        if (!found) return null;
        return { ...found, quantity: new Prisma.Decimal(found.quantity.toString()) };
      },
      async update({ where, data }) {
        const key = where.outletId_inventoryItemId;
        const idx = state.stocks.findIndex(
          (s) => s.outletId === key.outletId && s.inventoryItemId === key.inventoryItemId,
        );
        state.stocks[idx].quantity = data.quantity;
        return state.stocks[idx];
      },
    },
    stockMovement: {
      async create({ data }) {
        state.stockMovements.push(data);
        return data;
      },
      async findMany({ where }) {
        return state.stockMovements.filter((m) => m.outletId === where.outletId);
      },
    },
    order: {
      async findMany({ where }) {
        return state.orders
          .filter((o) => {
            if (where.outletId && o.outletId !== where.outletId) return false;
            if (where.status && o.status !== where.status) return false;
            if (where.paymentStatus && o.paymentStatus !== where.paymentStatus) return false;
            if (where.createdAt) {
              if (where.createdAt.gte && o.createdAt < where.createdAt.gte) return false;
              if (where.createdAt.lt && o.createdAt >= where.createdAt.lt) return false;
            }
            return true;
          })
          .map((o) => ({
            ...o,
            total: new Prisma.Decimal(o.total.toString()),
            subtotal: new Prisma.Decimal(o.subtotal.toString()),
            crew: { id: o.crewId, name: "Budi Crew" },
            items: (o.items || []).map((i) => ({
              ...i,
              unitPrice: new Prisma.Decimal(i.unitPrice.toString()),
              subtotal: new Prisma.Decimal(i.subtotal.toString()),
            })),
          }));
      },
      async findUnique({ where }) {
        const key = where.outletId_crewId_clientTransactionId;
        if (key) {
          return state.orders.find(
            (o) =>
              o.outletId === key.outletId &&
              o.crewId === key.crewId &&
              o.clientTransactionId === key.clientTransactionId,
          ) || null;
        }
        return state.orders.find((o) => o.id === where.id) || null;
      },
      async create({ data }) {
        if (
          state.orders.some(
            (o) =>
              o.outletId === data.outletId &&
              o.crewId === data.crewId &&
              o.clientTransactionId === data.clientTransactionId,
          )
        ) {
          const error = new Error("unique conflict");
          error.code = "P2002";
          throw error;
        }
        const ord = {
          id: `ord-${state.orders.length + 1}`,
          ...data,
          total: new Prisma.Decimal(data.total.toString()),
          subtotal: new Prisma.Decimal(data.subtotal.toString()),
          createdAt: data.createdAt || new Date(),
          items: data.items.create.map((it, idx) => ({
            id: `item-${idx + 1}`,
            productVariantId: it.productVariantId,
            productName: it.productName,
            variantName: it.variantName,
            quantity: it.quantity,
            unitPrice: new Prisma.Decimal(it.unitPrice.toString()),
            subtotal: new Prisma.Decimal(it.subtotal.toString()),
            addOns: [],
          })),
        };
        state.orders.push(ord);
        return ord;
      },
    },
    expense: {
      async findMany({ where }) {
        return state.expenses
          .filter((e) => {
            if (where.outletId && e.outletId !== where.outletId) return false;
            if (where.status && e.status !== where.status) return false;
            if (where.expenseDate) {
              if (where.expenseDate.gte && e.expenseDate < where.expenseDate.gte) return false;
              if (where.expenseDate.lt && e.expenseDate >= where.expenseDate.lt) return false;
            }
            return true;
          })
          .map((e) => ({
            ...e,
            amount: new Prisma.Decimal(e.amount.toString()),
            category: { id: "cat-1", name: e.categoryName || "Operasional" },
            createdBy: { id: e.createdById, name: "Dewi Manager" },
            audits: [],
          }));
      },
      async findUnique({ where }) {
        const key = where.outletId_createdById_clientTransactionId;
        if (key) {
          return state.expenses.find(
            (e) =>
              e.outletId === key.outletId &&
              e.createdById === key.createdById &&
              e.clientTransactionId === key.clientTransactionId,
          ) || null;
        }
        return state.expenses.find((e) => e.id === where.id) || null;
      },
      async create({ data }) {
        const exp = {
          id: `exp-${state.expenses.length + 1}`,
          ...data,
          category: { id: data.categoryId, name: "Bahan Baku Darurat" },
          createdBy: { id: data.createdById, name: "Dewi Manager" },
          audits: [],
        };
        state.expenses.push(exp);
        return exp;
      },
    },
    expenseAudit: {
      async findUnique() { return null; },
      async create({ data }) { return data; },
    },
    wasteRecord: {
      async findMany({ where }) {
        return state.waste.filter((w) => w.outletId === where.outletId);
      },
      async create({ data }) {
        state.waste.push(data);
        return data;
      },
    },
    closingRecord: {
      async findUnique({ where }) {
        if (where.id) return state.closings.find((c) => c.id === where.id) || null;
        const key = where.outletId_closingType_periodKey;
        if (key) {
          const found = state.closings.find(
            (c) =>
              c.outletId === key.outletId &&
              c.closingType === key.closingType &&
              c.periodKey === key.periodKey,
          );
          if (!found) return null;
          return {
            ...found,
            closedBy: { id: found.closedById, name: "Dewi Manager" },
            reopenedBy: found.reopenedById ? { id: found.reopenedById, name: "Dewi Manager" } : null,
            history: state.histories.filter((h) => h.closingId === found.id),
            audits: state.audits.filter((a) => a.closingId === found.id),
          };
        }
        return null;
      },
      async findFirst({ where }) {
        return state.closings.find((c) => (where.id ? c.id === where.id : true) && (where.outletId ? c.outletId === where.outletId : true)) || null;
      },
      async findMany({ where }) {
        return state.closings.filter((c) => (where.outletId ? c.outletId === where.outletId : true));
      },
      async create({ data }) {
        const rec = {
          id: `cls-${state.closings.length + 1}`,
          ...data,
          closedBy: { id: data.closedById, name: "Dewi Manager" },
          reopenedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.closings.push(rec);
        return rec;
      },
      async update({ where, data }) {
        const idx = state.closings.findIndex((c) => c.id === where.id);
        const updated = { ...state.closings[idx], ...data, updatedAt: new Date() };
        state.closings[idx] = updated;
        return updated;
      },
    },
    closingHistory: {
      async create({ data }) {
        state.histories.push({ id: `hist-${state.histories.length + 1}`, ...data });
        return data;
      },
      async findFirst({ where }) {
        return state.histories.find((h) => h.closingId === where.closingId && h.version === where.version) || null;
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
        return state.audits.find(
          (a) => a.outletId === key.outletId && a.actorId === key.actorId && a.clientTransactionId === key.clientTransactionId,
        ) || null;
      },
      async create({ data }) {
        const aud = { id: `aud-${state.audits.length + 1}`, ...data };
        state.audits.push(aud);
        return aud;
      },
    },
    outletStockRequest: {
      async findMany() { return []; },
    },
    $executeRaw: () => Promise.resolve({ command: "SELECT", rowCount: 1 }),
    $queryRaw: async function(...args) {
      return Promise.resolve({ command: "SELECT", rowCount: 1 });
    },
    $transaction: async (cb) => cb(prisma),
  };

  return { prisma, state };
}

// -------------------------------------------------------------------------
// 1. UJI ALUR TRANSAKSI DARI AWAL SAMPAI AKHIR (END-TO-END)
// -------------------------------------------------------------------------
test("E2E: alur pesanan Crew dari katalog, checkout POS, dan refleksi otomatis ke laporan keuangan", async () => {
  const { prisma, state } = createE2eDatabase();
  const crewToken = createToken("user-crew", "session-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
    dashboardOptions: { now: () => NOW },
  });

  // Step 1: Crew mengambil katalog
  const catalogRes = await app.request("/api/v1/outlets/outlet-rumbai/catalog", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(catalogRes.status, 200);
  const catalog = await catalogRes.json();
  assert.equal(catalog.data.products.length, 1);
  assert.equal(catalog.data.products[0].name, "Teh Tarik Klasik");

  // Step 2: Crew membuat pesanan POS (Cash)
  const orderRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientTransactionId: "11111111-1111-4111-8111-111111111111",
      paymentMethod: "CASH",
      items: [
        {
          productVariantId: "var-reg",
          quantity: 2,
          expectedVariantPrice: "10000.00",
          addOns: [],
        },
      ],
    }),
  });

  assert.equal(orderRes.status, 201);
  const order = await orderRes.json();
  assert.equal(order.data.order.total, "20000");
  assert.equal(order.data.order.status, "COMPLETED");

  // Step 3: Laporan Penjualan langsung merefleksikan order secara otomatis tanpa input ganda
  const reportRes = await app.request(
    "/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14",
    {
      headers: { Authorization: `Bearer ${createToken("user-manager")}` },
    },
  );
  assert.equal(reportRes.status, 200);
  const report = await reportRes.json();
  assert.equal(report.data.summary.totalIncome, "20000.00");
  assert.equal(report.data.summary.transactionCount, 1);
  assert.equal(report.data.paymentSummary.cash.total, "20000.00");
  assert.equal(report.data.productSales[0].productName, "Teh Tarik Klasik");
  assert.equal(report.data.productSales[0].quantity, 2);
});

// -------------------------------------------------------------------------
// 2. UJI AKSES CREW, MANAGER, DAN OWNER (RBAC)
// -------------------------------------------------------------------------
test("RBAC: Memastikan batas izin hak akses Crew, Manager, dan Owner ditegakkan", async () => {
  const { prisma } = createE2eDatabase();
  const crewToken = createToken("user-crew", "session-crew");
  const managerToken = createToken("user-manager", "session-manager");
  const ownerToken = createToken("user-owner", "session-owner");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
    reportOptions: { now: () => NOW },
    expenseOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
    dashboardOptions: { now: () => NOW },
  });

  // A. Crew DILARANG melihat laporan keuangan, pengeluaran, dan closing
  const crewReport = await app.request("/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(crewReport.status, 403);

  const crewExpense = await app.request("/api/v1/outlets/outlet-rumbai/expenses", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(crewExpense.status, 403);

  const crewClosing = await app.request("/api/v1/outlets/outlet-rumbai/closings", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clientTransactionId: "c-1", closingType: "DAILY", periodKey: "2026-11-14" }),
  });
  assert.equal(crewClosing.status, 403);

  // B. Owner dapat membaca laporan, pengeluaran, dan dashboard
  const ownerReport = await app.request("/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerReport.status, 200);

  const ownerDashboard = await app.request("/api/v1/outlets/outlet-rumbai/dashboard", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerDashboard.status, 200);

  // C. Owner DILARANG melakukan mutasi (create/edit/approve/closing)
  const ownerClose = await app.request("/api/v1/outlets/outlet-rumbai/closings", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clientTransactionId: "c-2", closingType: "DAILY", periodKey: "2026-11-14" }),
  });
  assert.equal(ownerClose.status, 403);

  const ownerExpensePost = await app.request("/api/v1/outlets/outlet-rumbai/expenses", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clientTransactionId: "e-1", categoryId: "c-1", amount: "50000.00", expenseDate: NOW.toISOString() }),
  });
  assert.equal(ownerExpensePost.status, 403);

  // D. Manager diizinkan mencatat pengeluaran dan melakukan closing
  const managerClose = await app.request("/api/v1/outlets/outlet-rumbai/closings", {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "c-mgr-1",
      closingType: "DAILY",
      periodKey: "2026-11-14",
      notes: "Closing sah Manager",
    }),
  });
  assert.equal(managerClose.status, 201);
});

// -------------------------------------------------------------------------
// 3. UJI ISOLASI OUTLET (MULTI-OUTLET TENANT ISOLATION)
// -------------------------------------------------------------------------
test("ISOLASI OUTLET: Data transaksi di Outlet A tidak bocor ke Outlet B, dan akses tanpa membership diblokir", async () => {
  const { prisma, state } = createE2eDatabase();
  const crewToken = createToken("user-crew", "session-crew");
  const managerToken = createToken("user-manager", "session-manager");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
    reportOptions: { now: () => NOW },
    dashboardOptions: { now: () => NOW },
  });

  // Order di Rumbai
  state.orders.push({
    id: "ord-rumbai",
    outletId: "outlet-rumbai",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "50000.00",
    total: "50000.00",
    createdAt: NOW,
    items: [],
  });

  // Order di Panam
  state.orders.push({
    id: "ord-panam",
    outletId: "outlet-panam",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    subtotal: "90000.00",
    total: "90000.00",
    createdAt: NOW,
    items: [],
  });

  // 1. Crew Rumbai mencoba mengakses outlet Panam -> DITOLAK 403
  const forbiddenPanam = await app.request("/api/v1/outlets/outlet-panam/catalog", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(forbiddenPanam.status, 403);

  // 2. Manager melihat laporan Rumbai -> hanya 50.000, tidak tercampur dengan Panam (90.000)
  const reportRumbai = await app.request("/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  const bodyRumbai = await reportRumbai.json();
  assert.equal(bodyRumbai.data.summary.totalIncome, "50000.00");
  assert.equal(bodyRumbai.data.summary.transactionCount, 1);

  // 3. Manager melihat laporan Panam -> hanya 90.000
  const reportPanam = await app.request("/api/v1/outlets/outlet-panam/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  const bodyPanam = await reportPanam.json();
  assert.equal(bodyPanam.data.summary.totalIncome, "90000.00");
  assert.equal(bodyPanam.data.summary.transactionCount, 1);
});

// -------------------------------------------------------------------------
// 4. UJI TRANSAKSI GANDA DAN KONSISTENSI STOK (IDEMPOTENCY & STOCK)
// -------------------------------------------------------------------------
test("IDEMPOTENCY: Transaksi ganda dengan key sama menghasilkan replay, payload berbeda ditolak conflict", async () => {
  const { prisma, state } = createE2eDatabase();
  const crewToken = createToken("user-crew", "session-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const txId = "22222222-2222-4222-8222-222222222222";
  const payload1 = {
    clientTransactionId: txId,
    paymentMethod: "CASH",
    items: [{ productVariantId: "var-reg", quantity: 1, expectedVariantPrice: "10000.00", addOns: [] }],
  };

  // Kirim order pertama kali
  const firstRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload1),
  });
  assert.equal(firstRes.status, 201);
  assert.equal(state.orders.length, 1);

  // Retry identik dengan clientTransactionId sama -> me-replay hasil, tidak membuat order ganda
  const retryRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload1),
  });
  assert.equal(retryRes.status, 200);
  assert.equal(state.orders.length, 1); // Tetap 1!

  // Kirim dengan clientTransactionId sama tetapi payload beda -> 409 IDEMPOTENCY_KEY_REUSED
  const conflictRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload1,
      items: [{ productVariantId: "var-lrg", quantity: 2, expectedVariantPrice: "13000.00", addOns: [] }],
    }),
  });
  assert.equal(conflictRes.status, 409);
  const conflictBody = await conflictRes.json();
  assert.equal(conflictBody.error.code, "IDEMPOTENCY_KEY_REUSED");
});

// -------------------------------------------------------------------------
// 5. UJI CLOSING DAN REOPEN DENGAN AUDIT LOG LENGKAP
// -------------------------------------------------------------------------
test("CLOSING & REOPEN: Closing mengunci periode, reopen wajib alasan, dan closing ulang mempertahankan riwayat", async () => {
  const { prisma, state } = createE2eDatabase();
  const managerToken = createToken("user-manager", "session-manager");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
    closingOptions: { now: () => NOW },
  });

  // Step 1: Closing Harian pertama kali (v1)
  const closeRes = await app.request("/api/v1/outlets/outlet-rumbai/closings", {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "close-1",
      closingType: "DAILY",
      periodKey: "2026-11-14",
      notes: "Tutup buku shift 1",
    }),
  });
  assert.equal(closeRes.status, 201);
  const closeBody = await closeRes.json();
  assert.equal(closeBody.data.record.version, 1);
  assert.equal(closeBody.data.record.status, "CLOSED");

  // Step 2: Reopen closing tanpa alasan -> Ditolak 400
  const noReasonRes = await app.request("/api/v1/outlets/outlet-rumbai/closings/reopen", {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "reopen-fail",
      closingId: closeBody.data.record.id,
      reason: " ", // Kosong!
    }),
  });
  assert.equal(noReasonRes.status, 400);

  // Step 3: Reopen dengan alasan lengkap
  const reopenRes = await app.request("/api/v1/outlets/outlet-rumbai/closings/reopen", {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "reopen-valid",
      closingId: closeBody.data.record.id,
      reason: "Koreksi selisih kas fisik dan nota pengeluaran es batu",
    }),
  });
  assert.equal(reopenRes.status, 200);
  const reopenBody = await reopenRes.json();
  assert.equal(reopenBody.data.record.status, "REOPENED");

  // Step 4: Closing ulang (Re-closing)
  const recloseRes = await app.request("/api/v1/outlets/outlet-rumbai/closings", {
    method: "POST",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "reclose-1",
      closingType: "DAILY",
      periodKey: "2026-11-14",
      notes: "Closing final setelah koreksi",
    }),
  });
  assert.equal(recloseRes.status, 201);
  const recloseBody = await recloseRes.json();
  assert.equal(recloseBody.data.record.version, 2);
  assert.equal(recloseBody.data.record.status, "CLOSED");

  // Step 5: Verifikasi riwayat closing lama dan jejak audit tersimpan
  assert.equal(state.histories.length, 2);
  assert.equal(state.histories[0].version, 1);
  assert.equal(state.histories[1].version, 2);

  const audits = state.audits.map((a) => a.action);
  assert.ok(audits.includes("CLOSED"));
  assert.ok(audits.includes("REOPENED"));
  assert.ok(audits.includes("RECLOSED"));
});

// -------------------------------------------------------------------------
// 6. UJI EKSPOR LAPORAN (CSV & HTML PRINTABLE)
// -------------------------------------------------------------------------
test("EKSPOR: Ekspor CSV (Excel) dan HTML cetak menghasilkan format resmi dengan badge closing", async () => {
  const { prisma, state } = createE2eDatabase();
  const ownerToken = createToken("user-owner", "session-owner");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    reportOptions: { now: () => NOW },
  });

  // Ekspor CSV
  const csvRes = await app.request(
    "/api/v1/outlets/outlet-rumbai/reports/export/csv?type=DAILY&date=2026-11-14",
    {
      headers: { Authorization: `Bearer ${ownerToken}` },
    },
  );
  assert.equal(csvRes.status, 200);
  assert.equal(csvRes.headers.get("content-type"), "text/csv; charset=utf-8");
  const csvText = await csvRes.text();
  assert.ok(csvText.includes("LAPORAN PENJUALAN & KEUANGAN TEH TARIK SEROO"));
  assert.ok(csvText.includes("Seroo Rumbai Pilot"));
  assert.ok(csvText.includes("RINGKASAN KEUANGAN"));

  // Ekspor HTML
  const htmlRes = await app.request(
    "/api/v1/outlets/outlet-rumbai/reports/export/html?type=DAILY&date=2026-11-14",
    {
      headers: { Authorization: `Bearer ${ownerToken}` },
    },
  );
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get("content-type"), "text/html; charset=utf-8");
  const htmlText = await htmlRes.text();
  assert.ok(htmlText.includes("TEH TARIK SEROO"));
  assert.ok(htmlText.includes("BELUM CLOSING - BUKAN LAPORAN FINAL"));
});
