import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-14T10:00:00.000Z");

function createToken(userId, sessionId = `session-${userId}`) {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: new Date(),
  });
}

function createAvailabilityDatabase() {
  const state = {
    users: [
      { id: "user-manager-rumbai", name: "Manager Rumbai", email: "mgr.rumbai@seroo.id", isActive: true },
      { id: "user-manager-panam", name: "Manager Panam", email: "mgr.panam@seroo.id", isActive: true },
      { id: "user-crew-rumbai", name: "Crew Rumbai", email: "crew.rumbai@seroo.id", isActive: true },
      { id: "user-owner", name: "Owner Mitra", email: "owner@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-panam", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
    ],
    memberships: [
      { userId: "user-manager-rumbai", outletId: "outlet-rumbai", role: "MANAGER" },
      { userId: "user-manager-panam", outletId: "outlet-panam", role: "MANAGER" },
      { userId: "user-crew-rumbai", outletId: "outlet-rumbai", role: "CREW" },
      { userId: "user-owner", outletId: "outlet-rumbai", role: "OWNER_MITRA" },
      { userId: "user-owner", outletId: "outlet-panam", role: "OWNER_MITRA" },
    ],
    products: [
      {
        id: "prod-tea",
        name: "Teh Tarik Klasik",
        category: "Tea",
        description: "Teh susu khas Seroo",
        imageUrl: null,
        isActive: true,
      },
      {
        id: "prod-coffee",
        name: "Kopi Tarik",
        category: "Coffee",
        description: "Kopi susu khas",
        imageUrl: null,
        isActive: true,
      },
      {
        id: "prod-seasonal",
        name: "Es Cendol Spesial",
        category: "Dessert",
        description: "Menu musiman",
        imageUrl: null,
        isActive: false, // Global inactive
      },
    ],
    variants: [
      { id: "var-tea-reg", productId: "prod-tea", name: "Regular", price: new Prisma.Decimal("10000.00"), isActive: true },
      { id: "var-coffee-reg", productId: "prod-coffee", name: "Regular", price: new Prisma.Decimal("12000.00"), isActive: true },
      { id: "var-seasonal-reg", productId: "prod-seasonal", name: "Regular", price: new Prisma.Decimal("15000.00"), isActive: true },
    ],
    addOns: [
      { id: "addon-jelly", name: "Grass Jelly", price: new Prisma.Decimal("3000.00"), isActive: true },
    ],
    availabilities: [
      // Outlet Rumbai initially has prod-tea available
      {
        id: "avail-1",
        outletId: "outlet-rumbai",
        productId: "prod-tea",
        isAvailable: true,
        updatedById: "user-manager-rumbai",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // prod-seasonal availability is set to true on rumbai, BUT globally inactive!
      {
        id: "avail-seasonal",
        outletId: "outlet-rumbai",
        productId: "prod-seasonal",
        isAvailable: true,
        updatedById: "user-manager-rumbai",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Outlet Panam has prod-coffee available
      {
        id: "avail-2",
        outletId: "outlet-panam",
        productId: "prod-coffee",
        isAvailable: true,
        updatedById: "user-manager-panam",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    auditLogs: [],
    orders: [],
  };

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        const userId = where.id.replace("session-", "");
        const user = state.users.find((u) => u.id === userId);
        if (!user) return null;
        return {
          id: where.id,
          userId: user.id,
          revokedAt: null,
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          user: { id: user.id, isActive: user.isActive },
        };
      },
    },
    outlet: {
      async findUnique({ where }) {
        return state.outlets.find((o) => o.id === where.id) || null;
      },
    },
    outletMembership: {
      async findUnique({ where }) {
        if (where.userId_outletId) {
          const m = state.memberships.find(
            (item) =>
              item.userId === where.userId_outletId.userId &&
              item.outletId === where.userId_outletId.outletId,
          );
          if (!m) return null;
          const outlet = state.outlets.find((o) => o.id === m.outletId);
          return {
            ...m,
            outlet: outlet ? { isActive: outlet.isActive } : { isActive: false },
          };
        }
        return null;
      },
    },
    product: {
      async findUnique({ where }) {
        return state.products.find((p) => p.id === where.id) || null;
      },
      async findMany(args = {}) {
        const where = args?.where || {};
        const select = args?.select || {};
        const outletIdForAvail =
          select.outletAvailabilities?.where?.outletId ||
          where.outletAvailabilities?.where?.outletId;

        return state.products
          .filter((p) => {
            if (where.isActive !== undefined && p.isActive !== where.isActive) return false;
            if (where.outletAvailabilities?.some) {
              const { outletId, isAvailable } = where.outletAvailabilities.some;
              const hasAvail = state.availabilities.some(
                (a) =>
                  a.productId === p.id &&
                  a.outletId === outletId &&
                  a.isAvailable === isAvailable,
              );
              if (!hasAvail) return false;
            }
            return true;
          })
          .map((p) => ({
            ...p,
            variants: state.variants
              .filter((v) => v.productId === p.id && (where.variants?.some?.isActive ? v.isActive : true))
              .map((v) => ({ id: v.id, name: v.name, price: v.price })),
            outletAvailabilities: state.availabilities
              .filter((a) => a.productId === p.id && (outletIdForAvail ? a.outletId === outletIdForAvail : true))
              .map((a) => ({ id: a.id, isAvailable: a.isAvailable, updatedAt: a.updatedAt, updatedById: a.updatedById })),
          }));
      },
    },
    productVariant: {
      async findMany({ where }) {
        return state.variants
          .filter((v) => {
            if (where?.id?.in && !where.id.in.includes(v.id)) return false;
            if (where?.isActive !== undefined && v.isActive !== where.isActive) return false;
            return true;
          })
          .map((v) => ({
            ...v,
            product: state.products.find((p) => p.id === v.productId),
          }));
      },
    },
    addOn: {
      async findMany() {
        return state.addOns.filter((a) => a.isActive);
      },
    },
    outletProductAvailability: {
      async findMany({ where }) {
        return state.availabilities.filter((a) => {
          if (where.outletId && a.outletId !== where.outletId) return false;
          if (where.productId?.in && !where.productId.in.includes(a.productId)) return false;
          if (where.isAvailable !== undefined && a.isAvailable !== where.isAvailable) return false;
          return true;
        });
      },
      async upsert({ where, create, update }) {
        const existingIdx = state.availabilities.findIndex(
          (a) =>
            a.outletId === where.outletId_productId.outletId &&
            a.productId === where.outletId_productId.productId,
        );
        if (existingIdx >= 0) {
          state.availabilities[existingIdx] = {
            ...state.availabilities[existingIdx],
            ...update,
            updatedAt: new Date(),
          };
          return state.availabilities[existingIdx];
        } else {
          const newRecord = {
            id: `avail-${Date.now()}`,
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.availabilities.push(newRecord);
          return newRecord;
        }
      },
    },
    auditLog: {
      async create({ data }) {
        const entry = { id: `audit-${Date.now()}`, ...data };
        state.auditLogs.push(entry);
        return entry;
      },
    },
    order: {
      async findUnique() {
        return null;
      },
      async create({ data }) {
        const newOrder = {
          id: `ord-${state.orders.length + 1}`,
          orderNumber: `ORD-${state.orders.length + 1}`,
          ...data,
          status: "COMPLETED",
          total: new Prisma.Decimal("10000.00"),
        };
        state.orders.push(newOrder);
        return newOrder;
      },
    },
    $transaction: async (cb) => cb(prisma),
  };

  return { state, prisma };
}

function setupApp() {
  const { state, prisma } = createAvailabilityDatabase();
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
  });
  return { state, prisma, app };
}

// ---------------------------------------------------------------------------
// SUITE: P1 Outlet Product Availability Backend Tests
// ---------------------------------------------------------------------------

test("1. Manager berhasil mengaktifkan produk (PATCH isAvailable: true)", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/prod-coffee/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.isAvailable, true);
  assert.equal(body.data.productId, "prod-coffee");
});

test("2. Manager berhasil menonaktifkan produk (PATCH isAvailable: false)", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/prod-tea/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: false }),
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.isAvailable, false);
});

test("3. Manager tidak dapat mengubah availability outlet lain (403 Forbidden)", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai"); // Manager of Rumbai, NOT Panam

  const res = await app.request(
    "/api/v1/outlets/outlet-panam/catalog/products/prod-tea/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "FORBIDDEN");
});

test("4. Crew tidak dapat mengubah availability (403 Forbidden)", async () => {
  const { app } = setupApp();
  const token = createToken("user-crew-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/prod-tea/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "FORBIDDEN");
});

test("5. Produk tidak ditemukan menghasilkan 404 Not Found", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/prod-nonexistent/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_FOUND");
});

test("6. Outlet tidak ditemukan menghasilkan 404 Not Found", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-unknown/catalog/products/prod-tea/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_FOUND");
});

test("7. Produk tanpa record availability dianggap tidak tersedia (isAvailable: false)", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/availability",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  // prod-coffee belum memiliki record di outlet-rumbai
  const coffee = body.data.products.find((p) => p.id === "prod-coffee");
  assert.ok(coffee);
  assert.equal(coffee.isAvailable, false);
  assert.equal(coffee.hasAvailabilityRecord, false);
});

test("8. GET availability hanya mengembalikan data outlet yang diminta", async () => {
  const { app } = setupApp();
  const token = createToken("user-manager-rumbai");

  const res = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/availability",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.outletId, "outlet-rumbai");

  // prod-tea tersedia di Rumbai
  const tea = body.data.products.find((p) => p.id === "prod-tea");
  assert.equal(tea.isAvailable, true);

  // prod-coffee tidak tersedia di Rumbai (meskipun tersedia di Panam)
  const coffee = body.data.products.find((p) => p.id === "prod-coffee");
  assert.equal(coffee.isAvailable, false);
});

test("9. Katalog Crew hanya mengembalikan produk yang tersedia", async () => {
  const { app } = setupApp();
  const token = createToken("user-crew-rumbai");

  const res = await app.request("/api/v1/outlets/outlet-rumbai/catalog", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  const productIds = body.data.products.map((p) => p.id);

  // prod-tea tersedia di Rumbai -> muncul
  assert.ok(productIds.includes("prod-tea"));
  // prod-coffee tidak tersedia di Rumbai -> TIDAK muncul
  assert.ok(!productIds.includes("prod-coffee"));
});

test("10. Produk global nonaktif tidak muncul walaupun availability outlet aktif", async () => {
  const { app } = setupApp();
  const token = createToken("user-crew-rumbai");

  const res = await app.request("/api/v1/outlets/outlet-rumbai/catalog", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  const productIds = body.data.products.map((p) => p.id);

  // prod-seasonal punya availability true di Rumbai, tetapi isActive: false secara global
  // Produk ini TIDAK boleh muncul di POS Crew!
  assert.ok(!productIds.includes("prod-seasonal"));
});

test("11. Backend menolak checkout produk yang tidak tersedia (409 CATALOG_ITEM_UNAVAILABLE)", async () => {
  const { app } = setupApp();
  const token = createToken("user-crew-rumbai");

  // Coba checkout var-coffee-reg (prod-coffee tidak tersedia di Rumbai)
  const orderPayload = {
    clientTransactionId: "e75f8268-4ed1-4f5c-b853-b4c25178a107",
    paymentMethod: "CASH",
    payments: [{ paymentMethod: "CASH", amount: "12000.00" }],
    items: [
      {
        productVariantId: "var-coffee-reg",
        quantity: 1,
        expectedVariantPrice: "12000.00",
        addOns: [],
      },
    ],
  };

  const res = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orderPayload),
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "CATALOG_ITEM_UNAVAILABLE");
  assert.ok(body.error.message.includes("tidak tersedia di outlet ini"));
});

test("12. Outlet lain tetap memiliki availability masing-masing secara terisolasi", async () => {
  const { app } = setupApp();
  const mgrRumbaiToken = createToken("user-manager-rumbai");
  const mgrPanamToken = createToken("user-manager-panam");

  // Manager Rumbai mengaktifkan prod-coffee di Rumbai
  await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/prod-coffee/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${mgrRumbaiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: true }),
    },
  );

  // Manager Panam mematikan prod-coffee di Panam
  await app.request(
    "/api/v1/outlets/outlet-panam/catalog/products/prod-coffee/availability",
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${mgrPanamToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isAvailable: false }),
    },
  );

  // Periksa GET availability Panam: prod-coffee harus false
  const panamRes = await app.request(
    "/api/v1/outlets/outlet-panam/catalog/products/availability",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${mgrPanamToken}` },
    },
  );
  const panamData = await panamRes.json();
  const panamCoffee = panamData.data.products.find((p) => p.id === "prod-coffee");
  assert.equal(panamCoffee.isAvailable, false);

  // Periksa GET availability Rumbai: prod-coffee harus true
  const rumbaiRes = await app.request(
    "/api/v1/outlets/outlet-rumbai/catalog/products/availability",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${mgrRumbaiToken}` },
    },
  );
  const rumbaiData = await rumbaiRes.json();
  const rumbaiCoffee = rumbaiData.data.products.find((p) => p.id === "prod-coffee");
  assert.equal(rumbaiCoffee.isAvailable, true);
});
