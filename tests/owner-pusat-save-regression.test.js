import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createAdminAccountRoutes } from "../src/accounts/adminRoutes.js";
import { createCatalogAdminRoutes } from "../src/catalog/routes.js";
import { createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-19T12:00:00.000Z");

function createMockPrisma() {
  const users = [
    {
      id: "admin-pusat-1",
      name: "Owner Pusat",
      email: "owner@seroo.id",
      passwordHash: "hashed",
      isActive: true,
      memberships: [
        {
          id: "m-admin",
          role: "ADMIN_PUSAT",
          outletId: "outlet-1",
          outlet: { id: "outlet-1", name: "Rumbai", code: "RMB", isActive: true },
        },
      ],
    },
    {
      id: "manager-1",
      name: "Manager Rumbai",
      email: "mgr@seroo.id",
      passwordHash: "hashed",
      isActive: true,
      memberships: [
        {
          id: "m-mgr",
          role: "MANAGER",
          outletId: "outlet-1",
          outlet: { id: "outlet-1", name: "Rumbai", code: "RMB", isActive: true },
        },
      ],
    },
  ];

  const outlets = [
    { id: "outlet-1", name: "Rumbai", code: "RMB", isActive: true },
    { id: "outlet-2", name: "Panam", code: "PNM", isActive: false },
  ];

  const products = [];
  const variants = [];
  const addOns = [];
  const auditLogs = [];

  const db = {
    users,
    outlets,
    products,
    variants,
    addOns,
    auditLogs,
    user: {
      findMany: async () => users,
      count: async () => users.length,
      findUnique: async ({ where }) => users.find((u) => u.id === where.id || u.email === where.email) ?? null,
      create: async ({ data }) => {
        const newUser = {
          id: `user-${users.length + 1}`,
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
          isActive: data.isActive,
          memberships: [
            {
              role: data.memberships.create.role,
              outlet: outlets.find((o) => o.id === data.memberships.create.outlet.connect.id),
            },
          ],
        };
        users.push(newUser);
        return newUser;
      },
      update: async ({ where, data }) => {
        const u = users.find((item) => item.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      },
    },
    outletMembership: {
      findFirst: async ({ where }) => {
        for (const u of users) {
          if (u.id === where.userId) {
            const m = u.memberships.find((mem) => !where.role || mem.role === where.role);
            if (m) return m;
          }
        }
        return null;
      },
    },
    outlet: {
      findMany: async () => outlets.filter((o) => o.isActive),
      findUnique: async ({ where }) => outlets.find((o) => o.id === where.id) ?? null,
    },
    product: {
      findMany: async () => products,
      findUnique: async ({ where }) => products.find((p) => p.id === where.id) ?? null,
      create: async ({ data }) => {
        const newProduct = {
          id: `prod-${products.length + 1}`,
          name: data.name,
          category: data.category ?? null,
          description: data.description ?? null,
          imageUrl: data.imageUrl ?? null,
          isActive: data.isActive ?? true,
          variants: (data.variants?.create ?? []).map((v, idx) => ({
            id: `var-${products.length + 1}-${idx + 1}`,
            name: v.name,
            price: v.price,
            isActive: v.isActive ?? true,
          })),
        };
        products.push(newProduct);
        newProduct.variants.forEach((v) => variants.push(v));
        return newProduct;
      },
      update: async ({ where, data }) => {
        const p = products.find((item) => item.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      },
    },
    productVariant: {
      findUnique: async ({ where }) => variants.find((v) => v.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const v = variants.find((item) => item.id === where.id);
        if (v) Object.assign(v, data);
        return v;
      },
    },
    addOn: {
      findMany: async () => addOns,
      create: async ({ data }) => {
        const newAddOn = {
          id: `addon-${addOns.length + 1}`,
          name: data.name,
          price: data.price,
          isActive: data.isActive ?? true,
        };
        addOns.push(newAddOn);
        return newAddOn;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditLogs.push(data);
        return { id: `audit-${auditLogs.length}`, ...data };
      },
    },
    authSession: {
      findUnique: async ({ where }) => {
        const sessionUserId = where.id.replace("session-", "");
        const user = users.find((u) => u.id === sessionUserId);
        if (!user) return null;
        return {
          id: where.id,
          userId: user.id,
          revokedAt: null,
          expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
          lastSeenAt: NOW,
          user: {
            id: user.id,
            isActive: user.isActive,
            mustChangePassword: false,
          },
        };
      },
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
    },
    refreshToken: {
      updateMany: async () => ({ count: 1 }),
    },
    userPasswordAudit: {
      create: async () => ({ id: "audit-pass-1" }),
    },
    $transaction: async (callback) => callback(db),
  };

  return db;
}

function createAdminToken(userId = "admin-pusat-1") {
  return createAccessToken({
    userId,
    sessionId: `session-${userId}`,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

test("REGRESSION: Owner Pusat create account with standard object JSON succeeds and persists", async () => {
  const prisma = createMockPrisma();
  const app = new Hono();
  app.route(
    "/api/v1/admin",
    createAdminAccountRoutes({
      prisma,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      now: () => NOW,
      hashPasswordFn: async (pw) => `hashed:${pw}`,
    }),
  );

  const token = createAdminToken();

  const response = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Barista Baru",
      email: "barista@seroo.id",
      password: "password-valid-12-karakter",
      role: "CREW",
      outletId: "outlet-1",
    }),
  });

  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.data.account.name, "Barista Baru");
  assert.equal(data.data.account.email, "barista@seroo.id");
  assert.equal(data.data.account.memberships[0].role, "CREW");

  // Verify persistence in prisma mock
  assert.equal(prisma.users.length, 3);
  const created = prisma.users.find((u) => u.email === "barista@seroo.id");
  assert.ok(created);
  assert.equal(created.name, "Barista Baru");
});

test("REGRESSION: Owner Pusat create account handles double-stringified payload defensifely", async () => {
  const prisma = createMockPrisma();
  const app = new Hono();
  app.route(
    "/api/v1/admin",
    createAdminAccountRoutes({
      prisma,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      now: () => NOW,
      hashPasswordFn: async (pw) => `hashed:${pw}`,
    }),
  );

  const token = createAdminToken();

  // Double stringified JSON simulate double encoding
  const doubleEncoded = JSON.stringify(
    JSON.stringify({
      name: "Manager Cabang",
      email: "manager.cabang@seroo.id",
      password: "password-valid-12-karakter",
      role: "MANAGER",
      outletId: "outlet-1",
    }),
  );

  const response = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: doubleEncoded,
  });

  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.data.account.name, "Manager Cabang");
  assert.equal(data.data.account.memberships[0].role, "MANAGER");
});

test("REGRESSION: Owner Pusat create catalog products with object and double-stringified payload succeeds", async () => {
  const prisma = createMockPrisma();
  const app = new Hono();
  app.route(
    "/api/v1/admin/catalog",
    createCatalogAdminRoutes({
      prisma,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      now: () => NOW,
    }),
  );

  const token = createAdminToken();

  // 1. Standard Object Payload
  const res1 = await app.request("/api/v1/admin/catalog/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Kopi Susu Seroo",
      category: "Coffee",
      description: "Signature coffee",
      variants: [
        { name: "Regular", price: "18000" },
        { name: "Large", price: "22000" },
      ],
    }),
  });

  assert.equal(res1.status, 201);
  const data1 = await res1.json();
  assert.equal(data1.success, true);
  assert.equal(data1.data.product.name, "Kopi Susu Seroo");
  assert.equal(data1.data.product.variants.length, 2);
  assert.equal(prisma.products.length, 1);

  // 2. Double-stringified Payload (defensiveness)
  const doubleEncodedProduct = JSON.stringify(
    JSON.stringify({
      name: "Matcha Latte",
      category: "Non-Coffee",
      description: "Authentic matcha",
      variants: [{ name: "Regular", price: "20000" }],
    }),
  );

  const res2 = await app.request("/api/v1/admin/catalog/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: doubleEncodedProduct,
  });

  assert.equal(res2.status, 201);
  const data2 = await res2.json();
  assert.equal(data2.success, true);
  assert.equal(data2.data.product.name, "Matcha Latte");
  assert.equal(prisma.products.length, 2);
});
