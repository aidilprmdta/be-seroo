import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-14T10:00:00.000Z");

function createToken(userId) {
  return createAccessToken({
    userId,
    sessionId: `session-${userId}`,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function createDatabase() {
  const state = {
    users: [
      { id: "user-crew", name: "Budi Kasir", email: "crew@seroo.id", isActive: true },
      { id: "user-manager", name: "Dewi Manager", email: "manager@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
    ],
    memberships: [
      { id: "mem-crew", userId: "user-crew", outletId: "outlet-rumbai", role: "CREW" },
      { id: "mem-manager", userId: "user-manager", outletId: "outlet-rumbai", role: "MANAGER" },
    ],
    products: [
      { id: "prod-tea", name: "Teh Tarik Klasik", isActive: true },
      { id: "prod-coffee", name: "Kopi Susu", isActive: true },
    ],
    variants: [
      { id: "var-tea-reg", productId: "prod-tea", name: "Regular", price: new Prisma.Decimal("15000.00"), isActive: true },
      { id: "var-coffee-lrg", productId: "prod-coffee", name: "Large", price: new Prisma.Decimal("20000.00"), isActive: true },
    ],
    addOns: [],
    orders: [],
    payments: [],
    expenses: [],
  };

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        const userId = where.id.replace("session-", "");
        const user = state.users.find((u) => u.id === userId) || state.users[0];
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
        const m = state.memberships.find(
          (item) =>
            item.userId === where.userId_outletId.userId &&
            item.outletId === where.userId_outletId.outletId,
        );
        if (!m) return null;
        return {
          role: m.role,
          outlet: { isActive: true },
        };
      },
    },
    product: {
      async findMany() {
        return state.products.map((p) => ({
          ...p,
          variants: state.variants.filter((v) => v.productId === p.id),
        }));
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
            product: state.products.find((p) => p.id === v.productId),
          }));
      },
    },
    addOn: {
      async findMany() {
        return [];
      },
    },
    order: {
      async findUnique({ where }) {
        if (where.id) {
          const ord = state.orders.find((o) => o.id === where.id);
          if (!ord) return null;
          return {
            ...ord,
            payments: state.payments.filter((p) => p.orderId === ord.id),
          };
        }
        const key = where.outletId_crewId_clientTransactionId;
        if (key) {
          const ord = state.orders.find(
            (o) =>
              o.outletId === key.outletId &&
              o.crewId === key.crewId &&
              o.clientTransactionId === key.clientTransactionId,
          );
          if (!ord) return null;
          return {
            ...ord,
            payments: state.payments.filter((p) => p.orderId === ord.id),
          };
        }
        return null;
      },
      async findMany({ where }) {
        return state.orders
          .filter((o) => {
            if (where.outletId && o.outletId !== where.outletId) return false;
            if (where.status && o.status !== where.status) return false;
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
            items: o.items || [],
            payments: state.payments.filter((p) => p.orderId === o.id),
          }));
      },
      async create({ data }) {
        const ord = {
          id: `ord-${state.orders.length + 1}`,
          outletId: data.outletId,
          crewId: data.crewId,
          orderNumber: data.orderNumber,
          clientTransactionId: data.clientTransactionId,
          payloadHash: data.payloadHash,
          status: data.status,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          subtotal: new Prisma.Decimal(data.subtotal.toString()),
          total: new Prisma.Decimal(data.total.toString()),
          createdAt: data.createdAt || new Date(),
          completedAt: data.completedAt || new Date(),
          items: (data.items?.create || []).map((it, idx) => ({
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

        const createdPayments = (data.payments?.create || []).map((p, idx) => {
          const rec = {
            id: `pay-${state.payments.length + idx + 1}`,
            orderId: ord.id,
            paymentMethod: p.paymentMethod,
            amount: new Prisma.Decimal(p.amount.toString()),
            paymentStatus: p.paymentStatus,
          };
          state.payments.push(rec);
          return rec;
        });

        return { ...ord, payments: createdPayments };
      },
      async update({ where, data }) {
        const o = state.orders.find((x) => x.id === where.id);
        if (!o) throw new Error("Order not found");
        Object.assign(o, data);
        return {
          ...o,
          payments: state.payments.filter((p) => p.orderId === o.id),
        };
      },
    },
    orderPayment: {
      async update({ where, data }) {
        const p = state.payments.find((x) => x.id === where.id);
        if (!p) throw new Error("Payment not found");
        Object.assign(p, data);
        return p;
      },
    },
    expense: {
      async findMany() {
        return [];
      },
    },
    $transaction: async (cb) => cb(prisma),
  };

  return { prisma, state };
}

// -------------------------------------------------------------------------
// 1. SPLIT PAYMENT SUKSES: Cash Rp 20.000 + QRIS Rp 15.000 = Rp 35.000 (Lunas)
// -------------------------------------------------------------------------
test("SPLIT PAYMENT: Kasir membagi pembayaran Cash dan QRIS dengan validasi total pas -> status LUNAS", async () => {
  const { prisma, state } = createDatabase();
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  // Total belanja: 1 Teh Tarik Reg (15.000) + 1 Kopi Susu Lrg (20.000) = Rp 35.000
  const orderRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "33333333-3333-4333-8333-333333333333",
      paymentMethod: "SPLIT",
      payments: [
        { paymentMethod: "CASH", amount: "20000.00" },
        { paymentMethod: "QRIS", amount: "15000.00" },
      ],
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
        { productVariantId: "var-coffee-lrg", quantity: 1, expectedVariantPrice: "20000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(orderRes.status, 201);
  const body = await orderRes.json();
  const order = body.data.order;

  assert.equal(order.total, "35000");
  assert.equal(order.paymentMethod, "SPLIT");
  // Sebelum verifikasi: order berstatus PENDING_RECONCILIATION (transaksi tidak langsung lunas)
  assert.equal(order.paymentStatus, "PENDING_RECONCILIATION");
  assert.equal(order.payments.length, 2);

  // Rincian Cash langsung LUNAS
  const cashPay = order.payments.find((p) => p.paymentMethod === "CASH");
  assert.equal(cashPay.amount, "20000");
  assert.equal(cashPay.paymentStatus, "LUNAS");

  // Rincian QRIS berstatus PENDING_RECONCILIATION
  const qrisPay = order.payments.find((p) => p.paymentMethod === "QRIS");
  assert.equal(qrisPay.amount, "15000");
  assert.equal(qrisPay.paymentStatus, "PENDING_RECONCILIATION");

  // Verifikasi tersimpan di database
  assert.equal(state.payments.length, 2);

  // Crew memverifikasi QRIS setelah memeriksa aplikasi merchant
  const verifyRes = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${order.id}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Masuk via merchant app" }),
    },
  );
  assert.equal(verifyRes.status, 200);
  const verifyBody = await verifyRes.json();
  assert.equal(verifyBody.data.order.paymentStatus, "LUNAS");
  assert.equal(verifyBody.data.verifiedBy.id, "user-crew");
  assert.ok(verifyBody.data.verifiedAt);

  const verifiedQris = verifyBody.data.order.payments.find((p) => p.paymentMethod === "QRIS");
  assert.equal(verifiedQris.paymentStatus, "LUNAS");
  assert.equal(verifiedQris.verifiedById, "user-crew");
  assert.ok(verifiedQris.verifiedAt);
});

// -------------------------------------------------------------------------
// 2. VALIDASI: Pembayaran Kurang dari Total -> Ditolak 400 (Status: Belum Lunas)
// -------------------------------------------------------------------------
test("VALIDASI: Pembayaran kurang dari total tagihan ditolak 400 dengan status belum lunas", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  // Total 35.000, tapi kasir hanya input Cash 20.000 + QRIS 10.000 = 30.000 (Kurang 5.000)
  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "44444444-4444-4444-8444-444444444444",
      payments: [
        { paymentMethod: "CASH", amount: "20000.00" },
        { paymentMethod: "QRIS", amount: "10000.00" },
      ],
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
        { productVariantId: "var-coffee-lrg", quantity: 1, expectedVariantPrice: "20000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "PAYMENT_AMOUNT_MISMATCH");
  assert.ok(body.error.message.includes("kurang dari total transaksi"));
  assert.ok(body.error.message.includes("belum lunas"));
});

// -------------------------------------------------------------------------
// 3. VALIDASI: Pembayaran Lebih dari Total -> Ditolak 400
// -------------------------------------------------------------------------
test("VALIDASI: Pembayaran melebihi total tagihan ditolak 400", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  // Total 35.000, input 25.000 + 15.000 = 40.000
  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "55555555-5555-4555-8555-555555555555",
      payments: [
        { paymentMethod: "CASH", amount: "25000.00" },
        { paymentMethod: "QRIS", amount: "15000.00" },
      ],
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
        { productVariantId: "var-coffee-lrg", quantity: 1, expectedVariantPrice: "20000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "PAYMENT_AMOUNT_MISMATCH");
  assert.ok(body.error.message.includes("melebihi total transaksi"));
});

// -------------------------------------------------------------------------
// 4. METODE TUNGGAL: Pembayaran single tetap lunas dan menghasilkan rincian
// -------------------------------------------------------------------------
test("SINGLE PAYMENT: Pembayaran tunggal (Cash saja) tetap tersimpan rincian pembayarannya", async () => {
  const { prisma, state } = createDatabase();
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "66666666-6666-4666-8666-666666666666",
      paymentMethod: "CASH",
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.order.paymentStatus, "LUNAS");
  assert.equal(body.data.order.paymentMethod, "CASH");
  assert.equal(body.data.order.payments.length, 1);
  assert.equal(body.data.order.payments[0].amount, "15000");
  assert.equal(state.payments.length, 1);
});

// -------------------------------------------------------------------------
// 5. LAPORAN KEUANGAN: Memecah nominal Cash dan QRIS secara akurat dari Split
// -------------------------------------------------------------------------
test("LAPORAN: Pemasukan dari transaksi split payment teralokasi akurat ke rincian Cash & QRIS", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew");
  const managerToken = createToken("user-manager");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
    reportOptions: { now: () => NOW },
  });

  // Transaksi 1: Split Cash 20.000 + QRIS 15.000 (Total 35.000)
  const tx1Res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "77777777-7777-4777-8777-777777777777",
      payments: [
        { paymentMethod: "CASH", amount: "20000.00" },
        { paymentMethod: "QRIS", amount: "15000.00" },
      ],
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
        { productVariantId: "var-coffee-lrg", quantity: 1, expectedVariantPrice: "20000.00", addOns: [] },
      ],
    }),
  });
  const tx1Body = await tx1Res.json();
  const tx1Id = tx1Body.data.order.id;

  // Transaksi 2: Cash murni 15.000
  await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "88888888-8888-4888-8888-888888888888",
      paymentMethod: "CASH",
      items: [
        { productVariantId: "var-tea-reg", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });

  // Sebelum verifikasi: QRIS 15.000 masuk ke pendingReconciliation
  const preReportRes = await app.request("/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  const preReport = await preReportRes.json();
  assert.equal(preReport.data.paymentSummary.qris.pendingReconciliation.total, "15000.00");
  assert.equal(preReport.data.paymentSummary.qris.recorded.total, "0.00");

  // Crew memeriksa aplikasi merchant dan memverifikasi QRIS
  await app.request(`/api/v1/outlets/outlet-rumbai/orders/${tx1Id}/verify-qris`, {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}` },
  });

  // Buka laporan harian setelah verifikasi
  const reportRes = await app.request("/api/v1/outlets/outlet-rumbai/reports/daily?date=2026-11-14", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });

  assert.equal(reportRes.status, 200);
  const reportBody = await reportRes.json();
  const summary = reportBody.data.summary;
  const paySummary = reportBody.data.paymentSummary;

  // Total Pemasukan: 35.000 + 15.000 = 50.000
  assert.equal(summary.totalIncome, "50000.00");
  assert.equal(summary.transactionCount, 2);

  // Total Cash: 20.000 + 15.000 = 35.000
  assert.equal(paySummary.cash.total, "35000.00");

  // Total QRIS: 15.000
  assert.equal(paySummary.qris.total, "15000.00");
  assert.equal(paySummary.qris.recorded.total, "15000.00");
});

