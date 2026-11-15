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
      { id: "user-admin", name: "Admin Pusat", email: "admin@seroo.id", isActive: true },
      { id: "user-crew", name: "Budi Kasir", email: "crew@seroo.id", isActive: true },
      { id: "user-manager", name: "Dewi Manager", email: "manager@seroo.id", isActive: true },
      { id: "user-mitra", name: "Pak Hendra Owner Mitra", email: "mitra@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
    ],
    memberships: [
      { id: "mem-admin", userId: "user-admin", outletId: "outlet-rumbai", role: "ADMIN_PUSAT" },
      { id: "mem-crew", userId: "user-crew", outletId: "outlet-rumbai", role: "CREW" },
      { id: "mem-manager", userId: "user-manager", outletId: "outlet-rumbai", role: "MANAGER" },
      { id: "mem-mitra", userId: "user-mitra", outletId: "outlet-rumbai", role: "OWNER_MITRA" },
    ],
    products: [
      { id: "prod-tea", name: "Teh Tarik", category: "Minuman", isActive: true },
      { id: "prod-coffee", name: "Kopi Susu", category: "Minuman", isActive: true },
    ],
    variants: [
      { id: "var-tea-med", productId: "prod-tea", name: "Medium", price: new Prisma.Decimal("15000.00"), isActive: true },
      { id: "var-coffee-med", productId: "prod-coffee", name: "Medium", price: new Prisma.Decimal("18000.00"), isActive: true },
    ],
    inventoryItems: [
      { id: "item-tea", name: "Bubuk Teh", unit: "gram", isActive: true },
      { id: "item-milk", name: "Susu Evaporasi", unit: "ml", isActive: true },
      { id: "item-sugar", name: "Gula Pasir", unit: "gram", isActive: true },
      { id: "item-coffee", name: "Bubuk Kopi", unit: "gram", isActive: true },
    ],
    recipes: [],
    stocks: [
      { outletId: "outlet-rumbai", inventoryItemId: "item-tea", quantity: new Prisma.Decimal("1000.000"), updatedAt: NOW },
      { outletId: "outlet-rumbai", inventoryItemId: "item-milk", quantity: new Prisma.Decimal("2000.000"), updatedAt: NOW },
      { outletId: "outlet-rumbai", inventoryItemId: "item-sugar", quantity: new Prisma.Decimal("1500.000"), updatedAt: NOW },
      { outletId: "outlet-rumbai", inventoryItemId: "item-coffee", quantity: new Prisma.Decimal("1000.000"), updatedAt: NOW },
    ],
    movements: [],
    orders: [],
    payments: [],
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
      async findFirst({ where }) {
        return (
          state.memberships.find(
            (m) =>
              (!where.userId || m.userId === where.userId) &&
              (!where.role || m.role === where.role),
          ) || null
        );
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
      async findUnique({ where, include }) {
        const v = state.variants.find((item) => item.id === where.id);
        if (!v) return null;
        const p = state.products.find((prod) => prod.id === v.productId);
        return {
          ...v,
          product: p || { id: v.productId, name: "Produk" },
        };
      },
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
    inventoryItem: {
      async findUnique({ where }) {
        return state.inventoryItems.find((i) => i.id === where.id) || null;
      },
      async findMany({ where }) {
        return state.inventoryItems.filter((i) => {
          if (where?.id?.in && !where.id.in.includes(i.id)) return false;
          if (where?.isActive !== undefined && i.isActive !== where.isActive) return false;
          return true;
        });
      },
    },
    recipeItem: {
      async findMany({ where, include }) {
        return state.recipes
          .filter((r) => {
            if (where?.productVariantId) {
              if (where.productVariantId.in && !where.productVariantId.in.includes(r.productVariantId)) return false;
              if (typeof where.productVariantId === "string" && r.productVariantId !== where.productVariantId) return false;
            }
            if (where?.productVariant?.productId) {
              const v = state.variants.find((item) => item.id === r.productVariantId);
              if (!v || v.productId !== where.productVariant.productId) return false;
            }
            return true;
          })
          .map((r) => {
            const v = state.variants.find((item) => item.id === r.productVariantId);
            const p = v ? state.products.find((prod) => prod.id === v.productId) : null;
            const inv = state.inventoryItems.find((item) => item.id === r.inventoryItemId);
            return {
              ...r,
              quantity: new Prisma.Decimal(r.quantity.toString()),
              productVariant: v ? { ...v, product: p } : null,
              inventoryItem: inv || null,
            };
          });
      },
      async findUnique({ where }) {
        const r = state.recipes.find((item) => item.id === where.id);
        if (!r) return null;
        const v = state.variants.find((item) => item.id === r.productVariantId);
        const p = v ? state.products.find((prod) => prod.id === v.productId) : null;
        const inv = state.inventoryItems.find((item) => item.id === r.inventoryItemId);
        return {
          ...r,
          quantity: new Prisma.Decimal(r.quantity.toString()),
          productVariant: v ? { ...v, product: p } : null,
          inventoryItem: inv || null,
        };
      },
      async create({ data }) {
        const item = {
          id: `recipe-${state.recipes.length + 1}`,
          productVariantId: data.productVariantId,
          inventoryItemId: data.inventoryItemId,
          quantity: new Prisma.Decimal(data.quantity.toString()),
        };
        state.recipes.push(item);
        const v = state.variants.find((x) => x.id === item.productVariantId);
        const p = v ? state.products.find((prod) => prod.id === v.productId) : null;
        const inv = state.inventoryItems.find((x) => x.id === item.inventoryItemId);
        return {
          ...item,
          productVariant: v ? { ...v, product: p } : null,
          inventoryItem: inv || null,
        };
      },
      async upsert({ where, create, update }) {
        const key = where.productVariantId_inventoryItemId;
        let r = state.recipes.find(
          (x) => x.productVariantId === key.productVariantId && x.inventoryItemId === key.inventoryItemId,
        );
        if (!r) {
          r = {
            id: `recipe-${state.recipes.length + 1}`,
            productVariantId: create.productVariantId,
            inventoryItemId: create.inventoryItemId,
            quantity: new Prisma.Decimal(create.quantity.toString()),
          };
          state.recipes.push(r);
        } else {
          r.quantity = new Prisma.Decimal(update.quantity.toString());
        }
        const v = state.variants.find((x) => x.id === r.productVariantId);
        const p = v ? state.products.find((prod) => prod.id === v.productId) : null;
        const inv = state.inventoryItems.find((x) => x.id === r.inventoryItemId);
        return {
          ...r,
          productVariant: v ? { ...v, product: p } : null,
          inventoryItem: inv || null,
        };
      },
      async deleteMany({ where }) {
        const initialCount = state.recipes.length;
        state.recipes = state.recipes.filter((r) => r.productVariantId !== where.productVariantId);
        return { count: initialCount - state.recipes.length };
      },
      async delete({ where }) {
        const idx = state.recipes.findIndex((r) => r.id === where.id);
        if (idx >= 0) {
          const removed = state.recipes.splice(idx, 1)[0];
          return removed;
        }
        throw new Error("Recipe item not found");
      },
    },
    outletStock: {
      async findMany({ where }) {
        return state.stocks
          .filter((s) => s.outletId === where.outletId)
          .map((s) => ({
            ...s,
            quantity: new Prisma.Decimal(s.quantity.toString()),
          }));
      },
      async upsert({ where, create, update }) {
        const key = where.outletId_inventoryItemId;
        let s = state.stocks.find(
          (x) => x.outletId === key.outletId && x.inventoryItemId === key.inventoryItemId,
        );
        if (!s) {
          s = {
            outletId: create.outletId,
            inventoryItemId: create.inventoryItemId,
            quantity: new Prisma.Decimal(create.quantity.toString()),
            updatedAt: NOW,
          };
          state.stocks.push(s);
        } else if (update.quantity?.decrement) {
          s.quantity = s.quantity.sub(new Prisma.Decimal(update.quantity.decrement.toString()));
          s.updatedAt = NOW;
        } else if (update.quantity?.increment) {
          s.quantity = s.quantity.add(new Prisma.Decimal(update.quantity.increment.toString()));
          s.updatedAt = NOW;
        }
        return s;
      },
    },
    stockMovement: {
      async create({ data }) {
        const movement = {
          id: `mov-${state.movements.length + 1}`,
          outletId: data.outletId,
          inventoryItemId: data.inventoryItemId,
          createdById: data.createdById,
          clientTransactionId: data.clientTransactionId,
          type: data.type,
          quantity: new Prisma.Decimal(data.quantity.toString()),
          note: data.note,
          referenceCode: data.referenceCode,
          createdAt: data.createdAt || NOW,
        };
        state.movements.push(movement);
        return movement;
      },
      async findMany({ where }) {
        return state.movements
          .filter((m) => m.outletId === where.outletId)
          .map((m) => ({
            ...m,
            inventoryItem: state.inventoryItems.find((i) => i.id === m.inventoryItemId),
            createdBy: state.users.find((u) => u.id === m.createdById),
          }));
      },
    },
    order: {
      async findUnique({ where }) {
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
        return state.orders.find((o) => o.id === where.id) || null;
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
          createdAt: data.createdAt || NOW,
          completedAt: data.completedAt || NOW,
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
    },
    $transaction: async (cb) => cb(prisma),
  };

  return { prisma, state };
}

// -------------------------------------------------------------------------
// 1. RECIPE MANAGEMENT: Admin Pusat Mengatur Resep Minuman
// -------------------------------------------------------------------------
test("RECIPE MANAGEMENT: Admin Pusat mengatur resep minuman lengkap (produk, ukuran, bahan, takaran, satuan)", async () => {
  const { prisma, state } = createDatabase();
  const adminToken = createToken("user-admin");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    recipeOptions: { now: () => NOW },
  });

  // Admin Pusat mengatur resep Teh Tarik Medium:
  // - Bubuk Teh: 15 gr
  // - Susu Evaporasi: 50 ml
  // - Gula Pasir: 20 gr
  const setRes = await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { inventoryItemId: "item-tea", quantity: "15.000" },
        { inventoryItemId: "item-milk", quantity: "50.000" },
        { inventoryItemId: "item-sugar", quantity: "20.000" },
      ],
    }),
  });

  assert.equal(setRes.status, 200);
  const setBody = await setRes.json();
  const recipe = setBody.data;

  assert.equal(recipe.productName, "Teh Tarik");
  assert.equal(recipe.variantName, "Medium");
  assert.equal(recipe.items.length, 3);

  // Verifikasi kelengkapan data: Produk, Ukuran, Bahan baku, Jumlah pemakaian, Satuan bahan
  const teaItem = recipe.items.find((i) => i.inventoryItemId === "item-tea");
  assert.equal(teaItem.ingredientName, "Bubuk Teh");
  assert.equal(teaItem.quantity, "15.000");
  assert.equal(teaItem.unit, "gram");

  const milkItem = recipe.items.find((i) => i.inventoryItemId === "item-milk");
  assert.equal(milkItem.ingredientName, "Susu Evaporasi");
  assert.equal(milkItem.quantity, "50.000");
  assert.equal(milkItem.unit, "ml");

  const sugarItem = recipe.items.find((i) => i.inventoryItemId === "item-sugar");
  assert.equal(sugarItem.ingredientName, "Gula Pasir");
  assert.equal(sugarItem.quantity, "20.000");
  assert.equal(sugarItem.unit, "gram");

  assert.equal(state.recipes.length, 3);
});

// -------------------------------------------------------------------------
// 2. RECIPE AUTHORIZATION: Crew dan Manager hanya dapat melihat resep, tidak dapat mengubah
// -------------------------------------------------------------------------
test("RECIPE AUTHORIZATION: Crew/Manager/Owner Mitra ditolak saat mengubah resep, tapi dapat melihat resep", async () => {
  const { prisma } = createDatabase();
  const adminToken = createToken("user-admin");
  const crewToken = createToken("user-crew");
  const managerToken = createToken("user-manager");
  const mitraToken = createToken("user-mitra");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    recipeOptions: { now: () => NOW },
  });

  // Admin buat resep
  await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ inventoryItemId: "item-tea", quantity: "15.000" }],
    }),
  });

  // Crew mencoba mengubah -> 403
  const crewUpdate = await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(crewUpdate.status, 403);

  // Manager mencoba mengubah -> 403
  const managerUpdate = await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(managerUpdate.status, 403);

  // Owner Mitra mencoba mengubah -> 403
  const mitraUpdate = await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${mitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(mitraUpdate.status, 403);

  // Crew dapat membaca resep untuk keperluan operasional/pembuatan minuman
  const crewRead = await app.request("/api/v1/recipes/variants/var-tea-med", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(crewRead.status, 200);
  const readBody = await crewRead.json();
  assert.equal(readBody.data.items.length, 1);
});

// -------------------------------------------------------------------------
// 3. AUTO STOCK DEDUCTION: Pesanan POS otomatis mengurangi stok sesuai resep
// -------------------------------------------------------------------------
test("AUTO STOCK DEDUCTION: Transaksi POS otomatis memotong stok bahan baku dan mencatat ledger StockMovement", async () => {
  const { prisma, state } = createDatabase();
  const adminToken = createToken("user-admin");
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    recipeOptions: { now: () => NOW },
    posOptions: { now: () => NOW },
  });

  // 1. Admin atur resep Teh Tarik Medium: Teh 15gr, Susu 50ml, Gula 20gr
  await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { inventoryItemId: "item-tea", quantity: "15.000" },
        { inventoryItemId: "item-milk", quantity: "50.000" },
        { inventoryItemId: "item-sugar", quantity: "20.000" },
      ],
    }),
  });

  // Stok awal Outlet Rumbai:
  // - Teh: 1000 gr
  // - Susu: 2000 ml
  // - Gula: 1500 gr
  const teaBefore = state.stocks.find((s) => s.inventoryItemId === "item-tea").quantity;
  assert.equal(teaBefore.toString(), "1000");

  // 2. Kasir (Crew) membuat transaksi POS: 2 porsi Teh Tarik Medium
  const orderRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "11111111-2222-4333-8444-555555555555",
      paymentMethod: "CASH",
      items: [
        { productVariantId: "var-tea-med", quantity: 2, expectedVariantPrice: "15000.00", addOns: [] },
      ],
    }),
  });

  assert.equal(orderRes.status, 201);
  const orderBody = await orderRes.json();
  const order = orderBody.data.order;
  assert.equal(order.total, "30000");

  // 3. Verifikasi pengurangan stok outlet:
  // - Teh: 1000 - (15 * 2) = 970 gr
  // - Susu: 2000 - (50 * 2) = 1900 ml
  // - Gula: 1500 - (20 * 2) = 1460 gr
  const teaAfter = state.stocks.find((s) => s.inventoryItemId === "item-tea").quantity;
  const milkAfter = state.stocks.find((s) => s.inventoryItemId === "item-milk").quantity;
  const sugarAfter = state.stocks.find((s) => s.inventoryItemId === "item-sugar").quantity;

  assert.equal(teaAfter.toString(), "970");
  assert.equal(milkAfter.toString(), "1900");
  assert.equal(sugarAfter.toString(), "1460");

  // 4. Verifikasi riwayat pergerakan stok (StockMovement):
  // Tercipta 3 baris StockMovement bertipe 'OUT' dengan referensi nomor order
  const movements = state.movements.filter((m) => m.referenceCode === order.orderNumber);
  assert.equal(movements.length, 3);

  const teaMovement = movements.find((m) => m.inventoryItemId === "item-tea");
  assert.equal(teaMovement.type, "OUT");
  assert.equal(teaMovement.quantity.toString(), "-30");
  assert.ok(teaMovement.note.includes("Auto deduction"));

  const milkMovement = movements.find((m) => m.inventoryItemId === "item-milk");
  assert.equal(milkMovement.type, "OUT");
  assert.equal(milkMovement.quantity.toString(), "-100");

  const sugarMovement = movements.find((m) => m.inventoryItemId === "item-sugar");
  assert.equal(sugarMovement.type, "OUT");
  assert.equal(sugarMovement.quantity.toString(), "-40");
});

// -------------------------------------------------------------------------
// 4. MULTI ITEM DEDUCTION: Pesanan dengan beberapa produk menggabungkan pemakaian bahan yang sama
// -------------------------------------------------------------------------
test("AUTO STOCK DEDUCTION: Beberapa minuman yang memakai bahan sama diakumulasikan pemotongannya", async () => {
  const { prisma, state } = createDatabase();
  const adminToken = createToken("user-admin");
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    recipeOptions: { now: () => NOW },
    posOptions: { now: () => NOW },
  });

  // Teh Tarik Medium: Susu 50ml
  await app.request("/api/v1/recipes/variants/var-tea-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ inventoryItemId: "item-milk", quantity: "50.000" }],
    }),
  });

  // Kopi Susu Medium: Susu 60ml, Kopi 20gr
  await app.request("/api/v1/recipes/variants/var-coffee-med", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { inventoryItemId: "item-milk", quantity: "60.000" },
        { inventoryItemId: "item-coffee", quantity: "20.000" },
      ],
    }),
  });

  // Pesan 1 Teh Tarik (Susu: 50) + 2 Kopi Susu (Susu: 60 * 2 = 120, Kopi: 20 * 2 = 40)
  // Total Susu = 50 + 120 = 170 ml
  // Total Kopi = 40 gr
  const orderRes = await app.request("/api/v1/outlets/outlet-rumbai/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTransactionId: "99999999-8888-4777-8666-555555555555",
      paymentMethod: "CASH",
      items: [
        { productVariantId: "var-tea-med", quantity: 1, expectedVariantPrice: "15000.00", addOns: [] },
        { productVariantId: "var-coffee-med", quantity: 2, expectedVariantPrice: "18000.00", addOns: [] },
      ],
    }),
  });
  assert.equal(orderRes.status, 201);

  // Stok susu awal 2000 - 170 = 1830 ml
  const milkAfter = state.stocks.find((s) => s.inventoryItemId === "item-milk").quantity;
  assert.equal(milkAfter.toString(), "1830");

  // Stok kopi awal 1000 - 40 = 960 gr
  const coffeeAfter = state.stocks.find((s) => s.inventoryItemId === "item-coffee").quantity;
  assert.equal(coffeeAfter.toString(), "960");
});
