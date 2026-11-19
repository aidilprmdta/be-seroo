import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";
import {
  TEST_USERS,
  TEST_OUTLETS,
  TEST_PRODUCTS,
  TEST_ADD_ONS,
  TEST_INVENTORY,
  seedE2eData,
} from "../prisma/seed-e2e.js";

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

function createOperationalDatabase() {
  const state = {
    users: [],
    outlets: [],
    memberships: [],
    products: [],
    variants: [],
    addOns: [],
    availabilities: [],
    inventoryItems: [],
    outletStocks: [],
    stockMovements: [],
    orders: [],
    orderItems: [],
    orderAddOns: [],
    orderPayments: [],
    orderStatusHistory: [],
    wasteRecords: [],
    lossReports: [],
    lossReportAudits: [],
    expenses: [],
    expenseCategories: [],
    closings: [],
    cashOpenings: [],
    closingAudits: [],
  };

  const prisma = {
    // Transaction wrapper
    async $transaction(fn) {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      return Promise.all(fn);
    },

    user: {
      async upsert({ where, create, update }) {
        let u = state.users.find((x) => x.id === where.id || x.email === where.email);
        if (u) {
          Object.assign(u, update);
          return u;
        }
        u = { ...create };
        state.users.push(u);
        return u;
      },
      async findUnique({ where }) {
        return state.users.find((u) => u.id === where.id || u.email === where.email) || null;
      },
      async findMany({ skip = 0, take = 50 } = {}) {
        return state.users.slice(skip, skip + take).map((u) => {
          const userMemberships = state.memberships
            .filter((m) => m.userId === u.id)
            .map((m) => {
              const outlet = state.outlets.find((o) => o.id === m.outletId);
              return { role: m.role, outlet };
            });
          return { ...u, memberships: userMemberships };
        });
      },
      async count() {
        return state.users.length;
      },
    },

    outlet: {
      async upsert({ where, create, update }) {
        let o = state.outlets.find((x) => x.id === where.id);
        if (o) {
          Object.assign(o, update);
          return o;
        }
        o = { ...create };
        state.outlets.push(o);
        return o;
      },
      async findUnique({ where }) {
        return state.outlets.find((o) => o.id === where.id) || null;
      },
      async findMany({ where } = {}) {
        return state.outlets.filter((o) => !where || where.isActive === undefined || o.isActive === where.isActive);
      },
    },

    outletMembership: {
      async upsert({ where, create, update }) {
        let m = state.memberships.find(
          (x) => x.userId === where.userId_outletId.userId && x.outletId === where.userId_outletId.outletId,
        );
        if (m) {
          Object.assign(m, update);
          return m;
        }
        m = { ...create };
        state.memberships.push(m);
        return m;
      },
      async findUnique({ where }) {
        const m = state.memberships.find(
          (x) => x.userId === where.userId_outletId.userId && x.outletId === where.userId_outletId.outletId,
        );
        if (!m) return null;
        const outlet = state.outlets.find((o) => o.id === m.outletId);
        return { ...m, outlet };
      },
      async findFirst({ where } = {}) {
        const m = state.memberships.find((x) => {
          if (where?.userId && x.userId !== where.userId) return false;
          if (where?.role && x.role !== where.role) return false;
          return true;
        });
        if (!m) return null;
        const outlet = state.outlets.find((o) => o.id === m.outletId);
        return { ...m, outlet };
      },
      async findMany({ where } = {}) {
        return state.memberships.filter((m) => {
          if (where?.userId && m.userId !== where.userId) return false;
          if (where?.outletId && m.outletId !== where.outletId) return false;
          return true;
        });
      },
    },

    authSession: {
      async findUnique({ where }) {
        const user = state.users.find((u) => `session-${u.id}` === where.id);
        if (!user) return null;
        return {
          id: where.id,
          userId: user.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86400000),
          user,
        };
      },
    },

    product: {
      async upsert({ where, create, update }) {
        let p = state.products.find((x) => x.id === where.id);
        if (p) {
          Object.assign(p, update);
          return p;
        }
        p = { ...create };
        state.products.push(p);
        return p;
      },
      async findMany({ where }) {
        return state.products.filter((p) => {
          if (where?.isActive !== undefined && p.isActive !== where.isActive) return false;
          return true;
        });
      },
    },

    productVariant: {
      async upsert({ where, create, update }) {
        let v = state.variants.find(
          (x) => x.productId === where.productId_name.productId && x.name === where.productId_name.name,
        );
        if (v) {
          Object.assign(v, update);
          return v;
        }
        v = { ...create };
        state.variants.push(v);
        return v;
      },
      async findMany({ where }) {
        return state.variants
          .filter((v) => {
            if (where?.id?.in && !where.id.in.includes(v.id)) return false;
            if (where?.isActive !== undefined && v.isActive !== where.isActive) return false;
            return true;
          })
          .map((v) => {
            const product = state.products.find((p) => p.id === v.productId);
            return { ...v, product };
          });
      },
    },

    addOn: {
      async upsert({ where, create, update }) {
        let a = state.addOns.find((x) => x.id === where.id);
        if (a) {
          Object.assign(a, update);
          return a;
        }
        a = { ...create };
        state.addOns.push(a);
        return a;
      },
      async findMany({ where }) {
        return state.addOns.filter((a) => {
          if (where?.id?.in && !where.id.in.includes(a.id)) return false;
          if (where?.isActive !== undefined && a.isActive !== where.isActive) return false;
          return true;
        });
      },
    },

    outletProductAvailability: {
      async upsert({ where, create, update }) {
        let av = state.availabilities.find(
          (x) => x.outletId === where.outletId_productId.outletId && x.productId === where.outletId_productId.productId,
        );
        if (av) {
          Object.assign(av, update);
          return av;
        }
        av = { ...create };
        state.availabilities.push(av);
        return av;
      },
      async findMany({ where }) {
        return state.availabilities.filter((av) => {
          if (where?.outletId && av.outletId !== where.outletId) return false;
          if (where?.productId?.in && !where.productId.in.includes(av.productId)) return false;
          if (where?.isAvailable !== undefined && av.isAvailable !== where.isAvailable) return false;
          return true;
        });
      },
    },

    inventoryItem: {
      async upsert({ where, create, update }) {
        let item = state.inventoryItems.find((x) => x.id === where.id);
        if (item) {
          Object.assign(item, update);
          return item;
        }
        item = { ...create };
        state.inventoryItems.push(item);
        return item;
      },
      async findMany({ where }) {
        return state.inventoryItems.filter((i) => {
          if (where?.isActive !== undefined && i.isActive !== where.isActive) return false;
          return true;
        });
      },
    },

    outletStock: {
      async upsert({ where, create, update }) {
        let s = state.outletStocks.find(
          (x) =>
            x.outletId === where.outletId_inventoryItemId.outletId &&
            x.inventoryItemId === where.outletId_inventoryItemId.inventoryItemId,
        );
        if (s) {
          Object.assign(s, update);
          return s;
        }
        s = { ...create };
        state.outletStocks.push(s);
        return s;
      },
      async findUnique({ where }) {
        let s = null;
        if (where?.id) {
          s = state.outletStocks.find((x) => x.id === where.id);
        } else if (where?.outletId_inventoryItemId) {
          s = state.outletStocks.find(
            (x) =>
              x.outletId === where.outletId_inventoryItemId.outletId &&
              x.inventoryItemId === where.outletId_inventoryItemId.inventoryItemId,
          );
        }
        if (!s) return null;
        const inventoryItem = state.inventoryItems.find((i) => i.id === s.inventoryItemId);
        return { ...s, inventoryItem };
      },
      async findMany({ where }) {
        return state.outletStocks
          .filter((s) => !where?.outletId || s.outletId === where.outletId)
          .map((s) => {
            const inventoryItem = state.inventoryItems.find((i) => i.id === s.inventoryItemId);
            return { ...s, inventoryItem };
          });
      },
      async update({ where, data }) {
        const s = state.outletStocks.find((x) => x.id === where.id);
        if (!s) throw new Error("Stock not found");
        if (data.quantity) s.quantity = new Prisma.Decimal(data.quantity);
        s.updatedAt = new Date();
        return s;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const s of state.outletStocks) {
          if (where?.outletId && s.outletId !== where.outletId) continue;
          if (where?.inventoryItemId && s.inventoryItemId !== where.inventoryItemId) continue;
          if (where?.quantity?.gte) {
            if (Number(s.quantity) < Number(where.quantity.gte)) continue;
          }
          if (data?.quantity?.decrement) {
            s.quantity = new Prisma.Decimal(Number(s.quantity) - Number(data.quantity.decrement));
          } else if (data?.quantity) {
            s.quantity = new Prisma.Decimal(data.quantity);
          }
          s.updatedAt = new Date();
          count++;
        }
        return { count };
      },
    },

    stockMovement: {
      async create({ data }) {
        const m = { id: `mov-${state.stockMovements.length + 1}`, ...data };
        state.stockMovements.push(m);
        return m;
      },
      async findMany({ where }) {
        return state.stockMovements.filter((m) => !where?.outletId || m.outletId === where.outletId);
      },
    },

    order: {
      async findUnique({ where }) {
        if (where?.id) {
          return state.orders.find((o) => o.id === where.id) || null;
        }
        if (where?.outletId_crewId_clientTransactionId) {
          const { outletId, crewId, clientTransactionId } = where.outletId_crewId_clientTransactionId;
          return (
            state.orders.find(
              (o) =>
                o.outletId === outletId &&
                o.crewId === crewId &&
                o.clientTransactionId === clientTransactionId,
            ) || null
          );
        }
        return null;
      },
      async create({ data }) {
        const orderId = `ord-${state.orders.length + 1}`;
        const createdOrder = {
          id: orderId,
          ...data,
          items: (data.items?.create || []).map((it, idx) => ({
            id: `item-${orderId}-${idx + 1}`,
            ...it,
            addOns: (it.addOns?.create || []).map((ad, adIdx) => ({
              id: `ad-${orderId}-${idx + 1}-${adIdx + 1}`,
              ...ad,
            })),
          })),
          payments: (data.payments?.create || []).map((p, idx) => ({
            id: `pay-${orderId}-${idx + 1}`,
            ...p,
          })),
          statusHistory: [],
        };
        state.orders.push(createdOrder);
        return createdOrder;
      },
      async findMany({ where }) {
        return state.orders.filter((o) => !where?.outletId || o.outletId === where.outletId);
      },
      async update({ where, data }) {
        const o = state.orders.find((x) => x.id === where.id);
        if (!o) throw new Error("Order not found");
        Object.assign(o, data);
        return o;
      },
    },

    auditLog: {
      async create({ data }) {
        state.lossReportAudits.push(data);
        return { id: `audit-${state.lossReportAudits.length}`, ...data };
      },
    },

    lossReport: {
      async findUnique({ where }) {
        const l = state.lossReports.find((x) => x.id === where.id);
        if (!l) return null;
        const item = state.inventoryItems.find((i) => i.id === l.inventoryItemId);
        const reportedBy = state.users.find((u) => u.id === l.reportedById);
        const reviewedBy = state.users.find((u) => u.id === l.reviewedById);
        return { ...l, inventoryItem: item, reportedBy, reviewedBy };
      },
      async findMany({ where }) {
        return state.lossReports
          .filter((l) => {
            if (where?.outletId && l.outletId !== where.outletId) return false;
            if (where?.status && l.status !== where.status) return false;
            return true;
          })
          .map((l) => {
            const item = state.inventoryItems.find((i) => i.id === l.inventoryItemId);
            const reportedBy = state.users.find((u) => u.id === l.reportedById);
            const reviewedBy = state.users.find((u) => u.id === l.reviewedById);
            return { ...l, inventoryItem: item, reportedBy, reviewedBy };
          });
      },
      async create({ data }) {
        const id = `loss-${state.lossReports.length + 1}`;
        const item = state.inventoryItems.find((i) => i.id === data.inventoryItemId);
        const reportedBy = state.users.find((u) => u.id === data.reportedById);
        const record = {
          id,
          ...data,
          status: "PENDING",
          createdAt: new Date(),
          inventoryItem: item,
          reportedBy,
          reviewedBy: null,
        };
        state.lossReports.push(record);
        return record;
      },
      async update({ where, data }) {
        const l = state.lossReports.find((x) => x.id === where.id);
        if (!l) throw new Error("Loss report not found");
        Object.assign(l, data);
        const item = state.inventoryItems.find((i) => i.id === l.inventoryItemId);
        const reportedBy = state.users.find((u) => u.id === l.reportedById);
        const reviewedBy = state.users.find((u) => u.id === l.reviewedById);
        return { ...l, inventoryItem: item, reportedBy, reviewedBy };
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const l of state.lossReports) {
          if (where?.id && l.id !== where.id) continue;
          if (where?.status && l.status !== where.status) continue;
          Object.assign(l, data);
          count++;
        }
        return { count };
      },
    },

    lossReportAudit: {
      async create({ data }) {
        state.lossReportAudits.push(data);
        return data;
      },
    },

    expenseCategory: {
      async upsert({ where, create }) {
        let cat = state.expenseCategories.find((c) => c.name === where.name);
        if (!cat) {
          cat = { id: `cat-${state.expenseCategories.length + 1}`, ...create };
          state.expenseCategories.push(cat);
        }
        return cat;
      },
      async findMany() {
        return state.expenseCategories;
      },
    },

    expense: {
      async create({ data }) {
        const exp = { id: `exp-${state.expenses.length + 1}`, ...data };
        state.expenses.push(exp);
        return exp;
      },
      async findMany({ where }) {
        return state.expenses.filter((e) => !where?.outletId || e.outletId === where.outletId);
      },
    },

    closingRecord: {
      async findMany({ where }) {
        return state.closings.filter((c) => !where?.outletId || c.outletId === where.outletId);
      },
      async create({ data }) {
        const id = `closing-${state.closings.length + 1}`;
        const rec = { id, ...data, createdAt: new Date() };
        state.closings.push(rec);
        return rec;
      },
    },

    cashOpening: {
      async create({ data }) {
        const id = `open-${state.cashOpenings.length + 1}`;
        const rec = { id, ...data, createdAt: new Date() };
        state.cashOpenings.push(rec);
        return rec;
      },
      async findUnique({ where }) {
        return (
          state.cashOpenings.find(
            (o) => o.outletId === where.outletId_periodKey.outletId && o.periodKey === where.outletId_periodKey.periodKey,
          ) || null
        );
      },
    },

    wasteRecord: {
      async create({ data }) {
        const id = `waste-${state.wasteRecords.length + 1}`;
        const rec = { id, ...data, createdAt: new Date() };
        state.wasteRecords.push(rec);
        return rec;
      },
      async findMany({ where }) {
        return state.wasteRecords.filter((w) => !where?.outletId || w.outletId === where.outletId);
      },
    },

    $transaction: async (fn) => (typeof fn === "function" ? fn(prisma) : Promise.all(fn)),

    _dump: () => state,
  };

  return { prisma, state };
}

// ========================================================
// SUITE PENGUJIAN OPERASIONAL E2E SEROO
// ========================================================

test("1. SEED DATA IDEMPOTENCY: Menjalankan seed 2 kali tidak membuat duplikasi", async () => {
  const { prisma, state } = createOperationalDatabase();

  // Eksekusi seed pertama
  const summary1 = await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });
  assert.equal(summary1.outlets, 2);
  assert.equal(summary1.users, 6);
  assert.equal(summary1.products, 4);

  const initialUsersCount = state.users.length;
  const initialProductsCount = state.products.length;
  const initialVariantsCount = state.variants.length;

  // Eksekusi seed kedua (idempoten)
  const summary2 = await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });
  assert.equal(summary2.outlets, 2);
  assert.equal(state.users.length, initialUsersCount, "User tidak boleh bertambah (idempoten)");
  assert.equal(state.products.length, initialProductsCount, "Produk tidak boleh bertambah (idempoten)");
  assert.equal(state.variants.length, initialVariantsCount, "Varian tidak boleh bertambah (idempoten)");
});

test("2. AUTH & RBAC E2E: Admin Pusat, Owner Mitra, Manager, Crew memiliki hak akses terisolasi", async () => {
  const { prisma } = createOperationalDatabase();
  await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });

  const app = createApp({
    prisma,
    authConfig: {
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      refreshTokenSecret: "test-refresh-secret-at-least-32-chars",
    },
    logger: { info() { }, error() { }, warn() { } },
  });

  const adminToken = createToken("user-admin-pusat");
  const managerToken = createToken("user-manager-rumbai");
  const crewToken = createToken("user-crew-rumbai");

  // 1. Admin Pusat berhak melihat daftar akun admin
  const adminRes = await app.request("/api/v1/admin/accounts", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminRes.status, 200);

  // 2. Crew dilarang keras mengakses endpoint admin (403 Forbidden)
  const crewOnAdmin = await app.request("/api/v1/admin/accounts", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(crewOnAdmin.status, 403);

  // 3. Manager dilarang mengakses admin accounts (403 Forbidden)
  const mgrOnAdmin = await app.request("/api/v1/admin/accounts", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(mgrOnAdmin.status, 403);

  // 4. Akses tanpa token ditolak (401 Unauthorized)
  const noTokenRes = await app.request("/api/v1/admin/accounts");
  assert.equal(noTokenRes.status, 401);
});

test("3. CATALOG & AVAILABILITY E2E: Menu yang tidak aktif/tersedia di outlet ditolak saat checkout POS", async () => {
  const { prisma, state } = createOperationalDatabase();
  await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });

  const app = createApp({
    prisma,
    authConfig: {
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      refreshTokenSecret: "test-refresh-secret-at-least-32-chars",
    },
    logger: { info() { }, error() { }, warn() { } },
  });

  const crewToken = createToken("user-crew-rumbai");

  // Teh Putih (prod-teh-putih / var-teh-putih-dingin) sengaja TIDAK diaktifkan di outlet-rumbai
  const checkoutPayload = {
    clientTransactionId: "11111111-1111-4111-8111-111111111111",
    paymentMethod: "CASH",
    items: [
      {
        productVariantId: "var-teh-putih-dingin",
        quantity: 1,
        expectedVariantPrice: "10000.00",
        addOns: [],
      },
    ],
  };

  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(checkoutPayload),
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "CATALOG_ITEM_UNAVAILABLE");
  assert.equal(state.orders.length, 0, "Pesanan tidak boleh tersimpan");
});

test("4. POS OPERASIONAL E2E: Checkout Tunai, QRIS Manual, dan Split Payment dengan Idempotensi", async () => {
  const { prisma, state } = createOperationalDatabase();
  await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });

  const app = createApp({
    prisma,
    authConfig: {
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      refreshTokenSecret: "test-refresh-secret-at-least-32-chars",
    },
    logger: { info() { }, error() { }, warn() { } },
  });

  const crewToken = createToken("user-crew-rumbai");

  // 1. Order Tunai (CASH) untuk menu tersedia (Teh Tarik Regular)
  const cashPayload = {
    clientTransactionId: "22222222-2222-4222-8222-222222222222",
    paymentMethod: "CASH",
    items: [
      {
        productVariantId: "var-teh-regular",
        quantity: 2,
        expectedVariantPrice: "10000.00",
        addOns: [{ addOnId: "addon-extra-susu", quantity: 1, expectedUnitPrice: "3000.00" }],
      },
    ],
  };

  const cashRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cashPayload),
  });

  assert.equal(cashRes.status, 201);
  const cashBody = await cashRes.json();
  assert.equal(cashBody.data.order.paymentMethod, "CASH");
  assert.equal(cashBody.data.order.paymentStatus, "LUNAS");
  // Subtotal: 2 * (10000 + 3000) = 26000
  assert.equal(Number(cashBody.data.order.total), 26000);

  // 2. Idempotensi: Mengirim ulang request yang sama menghasilkan 200 OK dengan order identik
  const retryRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cashPayload),
  });
  assert.equal(retryRes.status, 200);
  assert.equal(state.orders.length, 1, "Order tidak boleh terduplikasi");

  // 3. Split Payment (CASH + QRIS)
  const splitPayload = {
    clientTransactionId: "33333333-3333-4333-8333-333333333333",
    paymentMethod: "SPLIT",
    payments: [
      { paymentMethod: "CASH", amount: "10000.00" },
      { paymentMethod: "QRIS", amount: "18000.00" },
    ],
    items: [
      {
        productVariantId: "var-kopi-regular",
        quantity: 2,
        expectedVariantPrice: "12000.00",
        addOns: [{ addOnId: "addon-extra-teh", quantity: 1, expectedUnitPrice: "2000.00" }],
      },
    ],
  };

  const splitRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(splitPayload),
  });
  assert.equal(splitRes.status, 201);
  const splitBody = await splitRes.json();
  assert.equal(splitBody.data.order.paymentMethod, "SPLIT");
  assert.equal(splitBody.data.order.payments.length, 2);
});

test("5. LOSS REPORT LIFECYCLE E2E: Crew lapor PENDING -> Manager APPROVE (stok berkurang) & REJECT", async () => {
  const { prisma, state } = createOperationalDatabase();
  await seedE2eData(prisma, { hashPasswordFn: async (p) => `hash-${p}` });

  const app = createApp({
    prisma,
    authConfig: {
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      refreshTokenSecret: "test-refresh-secret-at-least-32-chars",
    },
    logger: { info() { }, error() { }, warn() { } },
  });

  const crewToken = createToken("user-crew-rumbai");
  const managerToken = createToken("user-manager-rumbai");

  // Stok awal susu kental: 48
  const initialStock = await prisma.outletStock.findUnique({
    where: {
      outletId_inventoryItemId: {
        outletId: "outlet-rumbai",
        inventoryItemId: "inv-susu-kental",
      },
    },
  });
  assert.equal(Number(initialStock.quantity), 48);

  // 1. Crew membuat Loss Report (status PENDING, stok belum berkurang)
  const reportPayload = {
    inventoryItemId: "inv-susu-kental",
    quantity: "3.000",
    reason: "Kaleng penyok dan bocor saat penerimaan",
  };

  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/loss-reports", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${crewToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reportPayload),
  });
  assert.equal(createRes.status, 201);
  const report = (await createRes.json()).data;
  assert.equal(report.status, "PENDING");

  // Verifikasi stok tetap 48
  const stockAfterPending = await prisma.outletStock.findUnique({
    where: {
      outletId_inventoryItemId: {
        outletId: "outlet-rumbai",
        inventoryItemId: "inv-susu-kental",
      },
    },
  });
  assert.equal(Number(stockAfterPending.quantity), 48);

  // 2. Manager melakukan APPROVE (CONFIRMED)
  const approveRes = await app.request(
    `/api/v1/outlets/outlet-rumbai/loss-reports/${report.id}/review`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${managerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "CONFIRMED", reviewNote: "Disetujui untuk pemusnahan" }),
    },
  );
  assert.equal(approveRes.status, 200);

  // Verifikasi stok berkurang 3 -> menjadi 45
  const stockAfterApprove = await prisma.outletStock.findUnique({
    where: {
      outletId_inventoryItemId: {
        outletId: "outlet-rumbai",
        inventoryItemId: "inv-susu-kental",
      },
    },
  });
  assert.equal(Number(stockAfterApprove.quantity), 45);

  // Verifikasi tercipta StockMovement tipe LOSS
  assert.equal(state.stockMovements.length, 1);
  assert.equal(state.stockMovements[0].type, "LOSS");
  assert.equal(Number(state.stockMovements[0].quantity), -3);

  // 3. Percobaan approve ulang ditolak (Idempoten / State Protection)
  const secondApprove = await app.request(
    `/api/v1/outlets/outlet-rumbai/loss-reports/${report.id}/review`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${managerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "CONFIRMED" }),
    },
  );
  assert.equal(secondApprove.status, 409); // Already processed
  assert.equal(Number(stockAfterApprove.quantity), 45, "Stok tidak boleh berkurang ganda");
});
