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
    now: NOW,
  });
}

function createDatabase() {
  const state = {
    users: [
      { id: "user-admin", name: "Siti Brand Owner", email: "brand@seroo.id", isActive: true },
      { id: "user-owner-rumbai", name: "Pak Agus Mitra Rumbai", email: "owner.rumbai@seroo.id", isActive: true },
      { id: "user-owner-panam", name: "Ibu Rina Mitra Panam", email: "owner.panam@seroo.id", isActive: true },
      { id: "user-manager", name: "Dewi Manager", email: "manager@seroo.id", isActive: true },
      { id: "user-crew", name: "Budi Crew", email: "crew@seroo.id", isActive: true },
      { id: "user-calon-crew", name: "Doni Calon Kasir", email: "doni@seroo.id", isActive: true },
    ],
    outlets: [
      { id: "outlet-rumbai", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-panam", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
    ],
    memberships: [
      // Siti is Brand Owner (ADMIN_PUSAT)
      { id: "mem-admin", userId: "user-admin", outletId: "outlet-rumbai", role: "ADMIN_PUSAT", createdAt: NOW },
      // Pak Agus is Owner Mitra Rumbai
      { id: "mem-owner-rumbai", userId: "user-owner-rumbai", outletId: "outlet-rumbai", role: "OWNER_MITRA", createdAt: NOW },
      // Ibu Rina is Owner Mitra Panam
      { id: "mem-owner-panam", userId: "user-owner-panam", outletId: "outlet-panam", role: "OWNER_MITRA", createdAt: NOW },
      // Manager & Crew di Rumbai
      { id: "mem-mgr", userId: "user-manager", outletId: "outlet-rumbai", role: "MANAGER", createdAt: NOW },
      { id: "mem-crew", userId: "user-crew", outletId: "outlet-rumbai", role: "CREW", createdAt: NOW },
    ],
    products: [
      {
        id: "prod-tea",
        name: "Teh Tarik Klasik",
        description: "Teh susu khas Seroo",
        category: "Tea",
        imageUrl: null,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    variants: [
      { id: "var-reg", productId: "prod-tea", name: "Regular", price: new Prisma.Decimal("10000.00"), isActive: true },
      { id: "var-lrg", productId: "prod-tea", name: "Large", price: new Prisma.Decimal("13000.00"), isActive: true },
    ],
    addOns: [
      { id: "addon-jelly", name: "Grass Jelly", price: new Prisma.Decimal("3000.00"), isActive: true, createdAt: NOW },
    ],
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
      async findFirst({ where }) {
        return state.memberships.find((m) => {
          if (where.userId && m.userId !== where.userId) return false;
          if (where.role && m.role !== where.role) return false;
          if (where.outletId && m.outletId !== where.outletId) return false;
          return true;
        }) || null;
      },
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
            outlet: outlet
              ? { ...outlet }
              : { isActive: false },
          };
        }
        return null;
      },
      async findMany({ where }) {
        return state.memberships
          .filter((m) => {
            if (where.userId && m.userId !== where.userId) return false;
            if (where.outletId && m.outletId !== where.outletId) return false;
            if (where.outlet?.isActive) {
              const outlet = state.outlets.find((item) => item.id === m.outletId);
              if (!outlet?.isActive) return false;
            }
            return true;
          })
          .map((m) => {
            const user = state.users.find((u) => u.id === m.userId);
            return {
              ...m,
              user: {
                id: user.id,
                name: user.name,
                email: user.email,
                isActive: user.isActive,
              },
              outlet: state.outlets.find((outlet) => outlet.id === m.outletId),
            };
          });
      },
      async upsert({ where, update, create }) {
        const idx = state.memberships.findIndex(
          (m) =>
            m.userId === where.userId_outletId.userId &&
            m.outletId === where.userId_outletId.outletId,
        );
        if (idx !== -1) {
          state.memberships[idx].role = update.role;
          const user = state.users.find((u) => u.id === state.memberships[idx].userId);
          return { ...state.memberships[idx], user };
        }
        const newRecord = {
          id: `mem-${state.memberships.length + 1}`,
          ...create,
          createdAt: new Date(),
        };
        state.memberships.push(newRecord);
        const user = state.users.find((u) => u.id === newRecord.userId);
        return { ...newRecord, user };
      },
      async delete({ where }) {
        const idx = state.memberships.findIndex(
          (m) =>
            m.userId === where.userId_outletId.userId &&
            m.outletId === where.userId_outletId.outletId,
        );
        if (idx !== -1) {
          const removed = state.memberships.splice(idx, 1);
          return removed[0];
        }
        return null;
      },
    },
    user: {
      async findUnique({ where }) {
        if (where.id) return state.users.find((u) => u.id === where.id) || null;
        if (where.email) return state.users.find((u) => u.email === where.email) || null;
        return null;
      },
    },
    outlet: {
      async findMany() {
        return state.outlets.filter((outlet) => outlet.isActive);
      },
      async findUnique({ where }) {
        return state.outlets.find((outlet) => outlet.id === where.id) || null;
      },
    },
    product: {
      async findMany() {
        return state.products.map((p) => ({
          ...p,
          variants: state.variants.filter((v) => v.productId === p.id),
        }));
      },
      async findUnique({ where }) {
        return state.products.find((p) => p.id === where.id) || null;
      },
      async create({ data }) {
        const newProd = {
          id: `prod-${state.products.length + 1}`,
          name: data.name,
          description: data.description || null,
          category: data.category || null,
          imageUrl: data.imageUrl || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.products.push(newProd);

        const createdVariants = (data.variants?.create || []).map((v, i) => {
          const variant = {
            id: `var-${state.variants.length + i + 1}`,
            productId: newProd.id,
            name: v.name,
            price: new Prisma.Decimal(v.price.toString()),
            isActive: v.isActive !== undefined ? v.isActive : true,
          };
          state.variants.push(variant);
          return variant;
        });

        return { ...newProd, variants: createdVariants };
      },
      async update({ where, data }) {
        const idx = state.products.findIndex((p) => p.id === where.id);
        if (idx === -1) return null;
        state.products[idx] = { ...state.products[idx], ...data, updatedAt: new Date() };
        return {
          ...state.products[idx],
          variants: state.variants.filter((v) => v.productId === where.id),
        };
      },
    },
    productVariant: {
      async findUnique({ where }) {
        return state.variants.find((v) => v.id === where.id) || null;
      },
      async update({ where, data }) {
        const idx = state.variants.findIndex((v) => v.id === where.id);
        if (idx === -1) return null;
        state.variants[idx] = { ...state.variants[idx], ...data };
        return state.variants[idx];
      },
    },
    addOn: {
      async findMany() {
        return state.addOns;
      },
      async findUnique({ where }) {
        return state.addOns.find((a) => a.id === where.id) || null;
      },
      async create({ data }) {
        const newAddOn = {
          id: `addon-${state.addOns.length + 1}`,
          name: data.name,
          price: new Prisma.Decimal(data.price.toString()),
          isActive: data.isActive !== undefined ? data.isActive : true,
          createdAt: new Date(),
        };
        state.addOns.push(newAddOn);
        return newAddOn;
      },
      async update({ where, data }) {
        const idx = state.addOns.findIndex((a) => a.id === where.id);
        if (idx === -1) return null;
        state.addOns[idx] = { ...state.addOns[idx], ...data };
        return state.addOns[idx];
      },
    },
  };

  return { prisma, state };
}

// -------------------------------------------------------------------------
// 1. ADMIN PUSAT: Pengelolaan Menu dan Harga Seluruh Outlet
// -------------------------------------------------------------------------
test("ADMIN PUSAT: Mengatur katalog dan harga secara sentral", async () => {
  const { prisma, state } = createDatabase();
  const adminToken = createToken("user-admin");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    catalogOptions: { now: () => NOW },
  });

  // A. Admin Pusat membuat produk baru lengkap dengan varian dan harga
  const createProdRes = await app.request("/api/v1/admin/catalog/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Kopi Susu Gula Aren",
      category: "Coffee",
      description: "Espresso dengan susu segar dan gula aren asli",
      variants: [
        { name: "Regular", price: "15000.00" },
        { name: "Large", price: "18000.00" },
      ],
    }),
  });

  assert.equal(createProdRes.status, 201);
  const createdProdBody = await createProdRes.json();
  assert.equal(createdProdBody.data.product.name, "Kopi Susu Gula Aren");
  assert.equal(createdProdBody.data.product.variants.length, 2);
  assert.equal(createdProdBody.data.product.variants[0].price, "15000");

  // B. Admin Pusat memperbarui harga varian produk yang berlaku untuk seluruh outlet
  const updateVariantRes = await app.request("/api/v1/admin/catalog/variants/var-reg", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ price: "11000.00" }),
  });
  assert.equal(updateVariantRes.status, 200);
  const updatedVariantBody = await updateVariantRes.json();
  assert.equal(updatedVariantBody.data.variant.price, "11000");

  // C. Admin Pusat membuat Add-on baru
  const createAddOnRes = await app.request("/api/v1/admin/catalog/add-ons", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Pudding Cokelat", price: "4000.00" }),
  });
  assert.equal(createAddOnRes.status, 201);
  const createdAddOnBody = await createAddOnRes.json();
  assert.equal(createdAddOnBody.data.addOn.name, "Pudding Cokelat");
  assert.equal(createdAddOnBody.data.addOn.price, "4000");
});

// -------------------------------------------------------------------------
// 2. ROLE BOUNDARY: Owner Mitra, Manager, dan Crew DILARANG Mengubah Katalog/Harga
// -------------------------------------------------------------------------
test("AUTHORIZATION BOUNDARY: Owner Mitra, Manager, dan Crew ditolak (403) saat mengubah katalog/harga", async () => {
  const { prisma } = createDatabase();
  const ownerMitraToken = createToken("user-owner-rumbai");
  const managerToken = createToken("user-manager");
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    catalogOptions: { now: () => NOW },
  });

  // Owner Mitra ditolak
  const ownerMitraAttempt = await app.request("/api/v1/admin/catalog/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerMitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Menu Ilegal Owner",
      variants: [{ name: "Regular", price: "20000.00" }],
    }),
  });
  assert.equal(ownerMitraAttempt.status, 403);
  const ownerMitraBody = await ownerMitraAttempt.json();
  assert.equal(ownerMitraBody.error.code, "FORBIDDEN");

  // Manager ditolak
  const managerAttempt = await app.request("/api/v1/admin/catalog/variants/var-reg", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${managerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ price: "5000.00" }),
  });
  assert.equal(managerAttempt.status, 403);

  // Crew ditolak
  const crewAttempt = await app.request("/api/v1/admin/catalog/add-ons", {
    method: "POST",
    headers: { Authorization: `Bearer ${crewToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Topping Liar", price: "1000.00" }),
  });
  assert.equal(crewAttempt.status, 403);
});

test("OUTLET SCOPE: daftar dan detail outlet hanya mengembalikan outlet yang diizinkan", async () => {
  const { prisma } = createDatabase();
  const ownerToken = createToken("user-owner-rumbai");
  const adminToken = createToken("user-admin");
  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    outletAccessOptions: { now: () => NOW },
  });

  const ownerList = await app.request("/api/v1/outlets", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerList.status, 200);
  assert.deepEqual(
    (await ownerList.json()).data.outlets.map((outlet) => outlet.id),
    ["outlet-rumbai"],
  );

  const ownerOtherOutlet = await app.request("/api/v1/outlets/outlet-panam", {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerOtherOutlet.status, 404);

  const adminList = await app.request("/api/v1/outlets", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminList.status, 200);
  assert.deepEqual(
    (await adminList.json()).data.outlets.map((outlet) => outlet.id).sort(),
    ["outlet-panam", "outlet-rumbai"],
  );
});

// -------------------------------------------------------------------------
// 3. OWNER MITRA: Mengelola Akses Staf di Outlet Miliknya
// -------------------------------------------------------------------------
test("OWNER MITRA: Dapat melihat dan mengelola keanggotaan Crew & Manager di outlet miliknya", async () => {
  const { prisma, state } = createDatabase();
  const ownerMitraToken = createToken("user-owner-rumbai");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    outletAccessOptions: { now: () => NOW },
  });

  // A. Melihat daftar staf di outlet Rumbai
  const listMembersRes = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    headers: { Authorization: `Bearer ${ownerMitraToken}` },
  });
  assert.equal(listMembersRes.status, 200);
  const listBody = await listMembersRes.json();
  assert.ok(listBody.data.members.length >= 3); // Admin, Owner, Manager, Crew

  // B. Menugaskan calon kasir baru sebagai CREW di outlet Rumbai
  const assignCrewRes = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerMitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "doni@seroo.id", role: "CREW" }),
  });
  assert.equal(assignCrewRes.status, 201);
  const assignBody = await assignCrewRes.json();
  assert.equal(assignBody.data.membership.role, "CREW");
  assert.equal(assignBody.data.membership.email, "doni@seroo.id");

  // C. Mencabut akses kasir lama dari outlet Rumbai
  const revokeCrewRes = await app.request("/api/v1/outlets/outlet-rumbai/members/user-crew", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ownerMitraToken}` },
  });
  assert.equal(revokeCrewRes.status, 200);
  const revokedMember = state.memberships.find(
    (m) => m.userId === "user-crew" && m.outletId === "outlet-rumbai",
  );
  assert.equal(revokedMember, undefined);
});

// -------------------------------------------------------------------------
// 4. ISOLASI OUTLET & PRIVILEGE ESCALATION: Owner Mitra Dibatasi
// -------------------------------------------------------------------------
test("ISOLASI OUTLET: Owner Mitra Rumbai ditolak saat mencoba mengelola akses Outlet Panam", async () => {
  const { prisma } = createDatabase();
  const ownerMitraToken = createToken("user-owner-rumbai");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    outletAccessOptions: { now: () => NOW },
  });

  // Coba melihat daftar staf Panam
  const forbiddenPanamList = await app.request("/api/v1/outlets/outlet-panam/members", {
    headers: { Authorization: `Bearer ${ownerMitraToken}` },
  });
  assert.equal(forbiddenPanamList.status, 403);

  // Coba menugaskan staf di Panam
  const forbiddenPanamAssign = await app.request("/api/v1/outlets/outlet-panam/members", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerMitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "doni@seroo.id", role: "CREW" }),
  });
  assert.equal(forbiddenPanamAssign.status, 403);
});

test("PREVENT PRIVILEGE ESCALATION: Owner Mitra tidak dapat mengangkat akun menjadi ADMIN_PUSAT atau OWNER", async () => {
  const { prisma, state } = createDatabase();
  const ownerMitraToken = createToken("user-owner-rumbai");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    outletAccessOptions: { now: () => NOW },
  });

  const escalateAttempt = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerMitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "doni@seroo.id", role: "ADMIN_PUSAT" }),
  });
  assert.equal(escalateAttempt.status, 400);

  const demoteAdminAttempt = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerMitraToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user-admin", role: "CREW" }),
  });
  assert.equal(demoteAdminAttempt.status, 403);
  assert.equal(
    state.memberships.find(
      (membership) => membership.userId === "user-admin" && membership.outletId === "outlet-rumbai",
    ).role,
    "ADMIN_PUSAT",
  );

  // Owner Mitra tidak dapat menurunkan role lalu mencabut akses Admin Pusat
  const revokeAdminAttempt = await app.request("/api/v1/outlets/outlet-rumbai/members/user-admin", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ownerMitraToken}` },
  });
  assert.equal(revokeAdminAttempt.status, 403);
});

test("ROLE BOUNDARY: Manager dan Crew DITOLAK saat mencoba mengelola staf outlet", async () => {
  const { prisma } = createDatabase();
  const managerToken = createToken("user-manager");
  const crewToken = createToken("user-crew");

  const app = createApp({
    prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    outletAccessOptions: { now: () => NOW },
  });

  const managerRes = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  assert.equal(managerRes.status, 403);

  const crewRes = await app.request("/api/v1/outlets/outlet-rumbai/members", {
    headers: { Authorization: `Bearer ${crewToken}` },
  });
  assert.equal(crewRes.status, 403);
});

