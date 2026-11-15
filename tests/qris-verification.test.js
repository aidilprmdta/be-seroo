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
      { id: "user-crew-1", name: "Budi Kasir", email: "crew1@seroo.id", isActive: true },
      { id: "user-crew-2", name: "Siti Kasir", email: "crew2@seroo.id", isActive: true },
      { id: "user-manager", name: "Dewi Manager", email: "manager@seroo.id", isActive: true },
      { id: "user-outside", name: "User Luar", email: "outside@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-panam", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
    ],
    memberships: [
      { id: "mem-crew-1", userId: "user-crew-1", outletId: "outlet-rumbai", role: "CREW" },
      { id: "mem-crew-2", userId: "user-crew-2", outletId: "outlet-panam", role: "CREW" },
      { id: "mem-manager", userId: "user-manager", outletId: "outlet-rumbai", role: "MANAGER" },
    ],
    products: [
      { id: "prod-tea", name: "Teh Tarik", isActive: true },
    ],
    variants: [
      { id: "var-tea", productId: "prod-tea", name: "Regular", price: new Prisma.Decimal("15000.00"), isActive: true },
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
          verifiedAt: null,
          verifiedById: null,
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
            verifiedAt: null,
            verifiedById: null,
            notes: null,
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
// 1. QRIS tidak langsung lunas saat nominal diinput
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: Transaksi QRIS tidak langsung lunas saat dibuat", async () => {
  const { prisma, state } = createDatabase();
  const crewToken = createToken("user-crew-1");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "11111111-1111-4111-8111-111111111111",
      paymentMethod: "QRIS",
      items: [
        { productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  const order = body.data.order;

  // Transaksi TIDAK boleh dianggap lunas hanya karena nominal QRIS sudah diinput
  assert.equal(order.paymentMethod, "QRIS");
  assert.equal(order.paymentStatus, "PENDING_RECONCILIATION");
  assert.equal(order.verifiedAt, null);
  assert.equal(order.verifiedById, null);

  const qrisPayment = order.payments.find((p) => p.paymentMethod === "QRIS");
  assert.equal(qrisPayment.paymentStatus, "PENDING_RECONCILIATION");
  assert.equal(qrisPayment.verifiedAt, null);
  assert.equal(qrisPayment.verifiedById, null);
});

// -------------------------------------------------------------------------
// 2. Crew menandai verifikasi setelah cek aplikasi merchant
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: Crew menandai pembayaran QRIS setelah verifikasi -> status LUNAS, mencatat waktu dan verifikator", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew-1");
  const verifyTime = new Date("2026-11-14T10:05:00.000Z");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => verifyTime },
  });

  // Buat order QRIS
  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "22222222-2222-4222-8222-222222222222",
      paymentMethod: "QRIS",
      items: [
        { productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });
  const createBody = await createRes.json();
  const orderId = createBody.data.order.id;

  // Crew memeriksa mutasi aplikasi merchant dan menandai verifikasi
  const verifyRes = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Sesuai mutasi aplikasi merchant BCA" }),
    },
  );

  assert.equal(verifyRes.status, 200);
  const verifyBody = await verifyRes.json();
  const verifiedOrder = verifyBody.data.order;

  // Status order kini LUNAS
  assert.equal(verifiedOrder.paymentStatus, "LUNAS");
  assert.equal(verifiedOrder.verifiedById, "user-crew-1");
  assert.equal(verifiedOrder.verifiedAt, verifyTime.toISOString());

  // Rincian payment QRIS kini LUNAS
  const verifiedPayment = verifiedOrder.payments.find((p) => p.paymentMethod === "QRIS");
  assert.equal(verifiedPayment.paymentStatus, "LUNAS");
  assert.equal(verifiedPayment.verifiedById, "user-crew-1");
  assert.equal(verifiedPayment.verifiedAt, verifyTime.toISOString());
  assert.ok(verifiedPayment.notes.includes("BCA"));
});

// -------------------------------------------------------------------------
// 3. Verifikasi QRIS pada transaksi murni Cash ditolak (400)
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: Verifikasi ditolak pada transaksi Cash tanpa QRIS", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew-1");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "33333333-3333-4333-8333-333333333333",
      paymentMethod: "CASH",
      items: [
        { productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });
  const createBody = await createRes.json();
  const orderId = createBody.data.order.id;

  const verifyRes = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crewToken}` },
    },
  );

  assert.equal(verifyRes.status, 400);
  const errBody = await verifyRes.json();
  assert.equal(errBody.error.code, "INVALID_PAYMENT_METHOD");
});

// -------------------------------------------------------------------------
// 4. Verifikasi ulang transaksi yang sudah Lunas ditolak (400)
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: Verifikasi ulang pada transaksi yang sudah lunas ditolak", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew-1");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "44444444-4444-4444-8444-444444444444",
      paymentMethod: "QRIS",
      items: [
        { productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });
  const createBody = await createRes.json();
  const orderId = createBody.data.order.id;

  // Verifikasi pertama -> sukses
  const firstVerify = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crewToken}` },
    },
  );
  assert.equal(firstVerify.status, 200);

  // Verifikasi kedua -> ditolak
  const secondVerify = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crewToken}` },
    },
  );
  assert.equal(secondVerify.status, 400);
  const errBody = await secondVerify.json();
  assert.equal(errBody.error.code, "PAYMENT_ALREADY_VERIFIED");
});

// -------------------------------------------------------------------------
// 5. Isolasi outlet dan otorisasi: Crew outlet lain atau user tanpa akses ditolak
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: Pembatasan akses outlet ditegakkan", async () => {
  const { prisma } = createDatabase();
  const crew1Token = createToken("user-crew-1");
  const crew2Token = createToken("user-crew-2"); // outlet Panam
  const outsideToken = createToken("user-outside"); // tanpa membership

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  const createRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crew1Token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "55555555-5555-4555-8555-555555555555",
      paymentMethod: "QRIS",
      items: [
        { productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });
  const createBody = await createRes.json();
  const orderId = createBody.data.order.id;

  // Crew Panam mencoba verifikasi order Rumbai -> 403
  const panamVerify = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${crew2Token}` },
    },
  );
  assert.equal(panamVerify.status, 403);

  // User luar tanpa membership -> 403
  const outsideVerify = await app.request(
    `/api/v1/outlets/outlet-rumbai/orders/${orderId}/verify-qris`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${outsideToken}` },
    },
  );
  assert.equal(outsideVerify.status, 403);
});

// -------------------------------------------------------------------------
// 6. Query list orders berdasarkan paymentStatus
// -------------------------------------------------------------------------
test("VERIFIKASI QRIS: List orders dapat difilter berdasarkan PENDING_RECONCILIATION", async () => {
  const { prisma } = createDatabase();
  const crewToken = createToken("user-crew-1");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    posOptions: { now: () => NOW },
  });

  // Buat 1 QRIS (pending) dan 1 Cash (lunas)
  await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "66666666-6666-4666-8666-666666666666",
      paymentMethod: "QRIS",
      items: [{ productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] }],
    }),
  });

  await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "77777777-7777-4777-8777-777777777777",
      paymentMethod: "CASH",
      items: [{ productVariantId: "var-tea", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] }],
    }),
  });

  // Filter pending reconciliation
  const pendingList = await app.request(
    "/api/v1/outlets/outlet-rumbai/orders?paymentStatus=PENDING_RECONCILIATION",
    { headers: { Authorization: `Bearer ${crewToken}` } },
  );
  assert.equal(pendingList.status, 200);
  const pendingBody = await pendingList.json();
  assert.equal(pendingBody.data.orders.length, 1);
  assert.equal(pendingBody.data.orders[0].paymentMethod, "QRIS");
  assert.equal(pendingBody.data.orders[0].paymentStatus, "PENDING_RECONCILIATION");
});

