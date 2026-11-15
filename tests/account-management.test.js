import assert from "node:assert/strict";
import test from "node:test";
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
      { id: "admin", name: "Admin Pusat", email: "admin@seroo.id", passwordHash: "admin-hash", isActive: true },
      { id: "admin-two", name: "Admin Kedua", email: "admin-two@seroo.id", passwordHash: "admin-hash", isActive: true },
      { id: "owner", name: "Owner Mitra", email: "owner@seroo.id", passwordHash: "owner-hash", isActive: true },
      { id: "manager", name: "Manager Outlet", email: "manager@seroo.id", passwordHash: "manager-hash", isActive: true },
      { id: "crew", name: "Crew Outlet", email: "crew@seroo.id", passwordHash: "crew-hash", isActive: true },
    ],
    outlets: [
      { id: "outlet-a", name: "Seroo Rumbai", code: "SR-RUMBAI", isActive: true },
      { id: "outlet-b", name: "Seroo Panam", code: "SR-PANAM", isActive: true },
      { id: "outlet-off", name: "Outlet Nonaktif", code: "SR-OFF", isActive: false },
    ],
    memberships: [
      { id: "membership-admin", userId: "admin", outletId: "outlet-a", role: "ADMIN_PUSAT" },
      { id: "membership-admin-two", userId: "admin-two", outletId: "outlet-a", role: "ADMIN_PUSAT" },
      { id: "membership-owner", userId: "owner", outletId: "outlet-a", role: "OWNER_MITRA" },
      { id: "membership-manager", userId: "manager", outletId: "outlet-a", role: "MANAGER" },
      { id: "membership-crew", userId: "crew", outletId: "outlet-a", role: "CREW" },
    ],
    sessions: ["admin", "admin-two", "owner", "manager", "crew"].map((userId) => ({
      id: `session-${userId}`,
      userId,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    })),
  };

  function withMemberships(user) {
    if (!user) return null;
    return {
      ...user,
      memberships: state.memberships
        .filter((membership) => membership.userId === user.id)
        .map((membership) => ({
          ...membership,
          outlet: state.outlets.find((outlet) => outlet.id === membership.outletId),
        })),
    };
  }

  const prisma = {
    authSession: {
      async findUnique({ where }) {
        const session = state.sessions.find((item) => item.id === where.id);
        if (!session) return null;
        const user = state.users.find((item) => item.id === session.userId);
        return {
          ...session,
          user: user ? { id: user.id, isActive: user.isActive } : null,
        };
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const session of state.sessions) {
          if (session.userId === where.userId && session.revokedAt === where.revokedAt) {
            session.revokedAt = data.revokedAt;
            count += 1;
          }
        }
        return { count };
      },
    },
    outletMembership: {
      async findFirst({ where }) {
        return state.memberships.find(
          (membership) =>
            membership.userId === where.userId &&
            membership.role === where.role,
        ) ?? null;
      },
    },
    outlet: {
      async findUnique({ where }) {
        return state.outlets.find((outlet) => outlet.id === where.id) ?? null;
      },
      async findMany({ where }) {
        return state.outlets
          .filter((outlet) => outlet.isActive === where.isActive)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    },
    user: {
      async findMany({ skip, take, orderBy }) {
        const users = [...state.users].sort((a, b) =>
          a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
        assert.deepEqual(orderBy, [{ name: "asc" }, { id: "asc" }]);
        return users.slice(skip, skip + take).map(withMemberships);
      },
      async count() {
        return state.users.length;
      },
      async findUnique({ where }) {
        const user = where.id
          ? state.users.find((item) => item.id === where.id)
          : state.users.find((item) => item.email === where.email);
        return withMemberships(user);
      },
      async create({ data }) {
        if (state.users.some((user) => user.email === data.email)) {
          const error = new Error("Unique constraint");
          error.code = "P2002";
          throw error;
        }
        const user = {
          id: `user-${state.users.length + 1}`,
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
          isActive: data.isActive,
        };
        state.users.push(user);
        state.memberships.push({
          id: `membership-${state.memberships.length + 1}`,
          userId: user.id,
          outletId: data.memberships.create.outlet.connect.id,
          role: data.memberships.create.role,
        });
        return withMemberships(user);
      },
      async update({ where, data }) {
        const user = state.users.find((item) => item.id === where.id);
        Object.assign(user, data);
        return withMemberships(user);
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return { prisma, state };
}

function createAccountApp(database, hashPasswordFn = async (value) => `argon2id:${value}`) {
  return createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    adminAccountOptions: { now: () => NOW, hashPasswordFn },
  });
}

function authenticatedHeaders(userId) {
  return { Authorization: `Bearer ${createToken(userId)}` };
}

test("Admin Pusat can list accounts and active outlets and create an outlet-bound account", async () => {
  const database = createDatabase();
  const hashedPasswords = [];
  const app = createAccountApp(database, async (password) => {
    hashedPasswords.push(password);
    return `argon2id:${password}`;
  });

  const outletsResponse = await app.request("/api/v1/admin/outlets", {
    headers: authenticatedHeaders("admin"),
  });
  assert.equal(outletsResponse.status, 200);
  const outletsBody = await outletsResponse.json();
  assert.deepEqual(
    outletsBody.data.outlets.map((outlet) => outlet.id),
    ["outlet-b", "outlet-a"],
  );

  const createResponse = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers: {
      ...authenticatedHeaders("admin"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Crew Baru",
      email: "NEW.CREW@SEROO.ID",
      password: "password-awal-kuat",
      role: "CREW",
      outletId: "outlet-b",
    }),
  });
  assert.equal(createResponse.status, 201);
  const createdBody = await createResponse.json();
  assert.equal(createdBody.data.account.email, "new.crew@seroo.id");
  assert.equal(createdBody.data.account.isActive, true);
  assert.deepEqual(createdBody.data.account.memberships, [
    {
      role: "CREW",
      outlet: {
        id: "outlet-b",
        name: "Seroo Panam",
        code: "SR-PANAM",
        isActive: true,
      },
    },
  ]);
  assert.deepEqual(hashedPasswords, ["password-awal-kuat"]);
  assert.equal(
    JSON.stringify(createdBody).includes("passwordHash"),
    false,
  );
  assert.equal(database.state.users.at(-1).passwordHash, "argon2id:password-awal-kuat");

  const listResponse = await app.request("/api/v1/admin/accounts?page=1&pageSize=2", {
    headers: authenticatedHeaders("admin"),
  });
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.data.accounts.length, 2);
  assert.equal(listBody.data.total, 6);
  assert.equal(listBody.data.hasNextPage, true);
});

test("account management rejects Owner Mitra, Manager, and Crew regardless of request role", async () => {
  const database = createDatabase();
  const app = createAccountApp(database);

  for (const userId of ["owner", "manager", "crew"]) {
    const createResponse = await app.request("/api/v1/admin/accounts", {
      method: "POST",
      headers: {
        ...authenticatedHeaders(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Admin Palsu",
        email: `fake-${userId}@seroo.id`,
        password: "password-awal-kuat",
        role: "ADMIN_PUSAT",
        outletId: "outlet-b",
      }),
    });
    assert.equal(createResponse.status, 403);
  }
  assert.equal(database.state.users.length, 5);

  const outletResponse = await app.request("/api/v1/admin/outlets", {
    headers: authenticatedHeaders("crew"),
  });
  assert.equal(outletResponse.status, 403);

  const listResponse = await app.request("/api/v1/admin/accounts", {
    headers: authenticatedHeaders("owner"),
  });
  assert.equal(listResponse.status, 403);

  const anonymousResponse = await app.request("/api/v1/admin/accounts");
  assert.equal(anonymousResponse.status, 401);
});

test("account creation rejects unsupported roles, inactive outlets, and duplicate emails", async () => {
  const database = createDatabase();
  const app = createAccountApp(database);
  const headers = {
    ...authenticatedHeaders("admin"),
    "Content-Type": "application/json",
  };

  const adminRoleResponse = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Admin Baru",
      email: "new-admin@seroo.id",
      password: "password-awal-kuat",
      role: "ADMIN_PUSAT",
      outletId: "outlet-a",
    }),
  });
  assert.equal(adminRoleResponse.status, 400);

  const shortPasswordResponse = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Crew Baru",
      email: "short-password@seroo.id",
      password: "short",
      role: "CREW",
      outletId: "outlet-a",
    }),
  });
  assert.equal(shortPasswordResponse.status, 400);

  const inactiveOutletResponse = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Crew Baru",
      email: "new-crew@seroo.id",
      password: "password-awal-kuat",
      role: "CREW",
      outletId: "outlet-off",
    }),
  });
  assert.equal(inactiveOutletResponse.status, 409);

  const duplicateEmailResponse = await app.request("/api/v1/admin/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Nama Duplikat",
      email: "MANAGER@SEROO.ID",
      password: "password-awal-kuat",
      role: "CREW",
      outletId: "outlet-a",
    }),
  });
  assert.equal(duplicateEmailResponse.status, 409);
  assert.equal(database.state.users.length, 5);
});

test("deactivation revokes sessions, reactivation does not restore old sessions, and protected accounts stay active", async () => {
  const database = createDatabase();
  const app = createAccountApp(database);

  const deactivateResponse = await app.request(
    "/api/v1/admin/accounts/manager/status",
    {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders("admin"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: false }),
    },
  );
  assert.equal(deactivateResponse.status, 200);
  assert.equal(database.state.users.find((user) => user.id === "manager").isActive, false);
  const oldManagerSession = database.state.sessions.find(
    (session) => session.userId === "manager",
  );
  assert.ok(oldManagerSession.revokedAt);

  const oldSessionResponse = await app.request("/api/v1/admin/outlets", {
    headers: authenticatedHeaders("manager"),
  });
  assert.equal(oldSessionResponse.status, 401);

  const activateResponse = await app.request(
    "/api/v1/admin/accounts/manager/status",
    {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders("admin"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: true }),
    },
  );
  assert.equal(activateResponse.status, 200);
  assert.equal(database.state.users.find((user) => user.id === "manager").isActive, true);
  assert.ok(oldManagerSession.revokedAt);

  const restoredSessionResponse = await app.request("/api/v1/admin/outlets", {
    headers: authenticatedHeaders("manager"),
  });
  assert.equal(restoredSessionResponse.status, 401);

  const selfDeactivationResponse = await app.request(
    "/api/v1/admin/accounts/admin/status",
    {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders("admin"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: false }),
    },
  );
  assert.equal(selfDeactivationResponse.status, 409);

  const otherAdminResponse = await app.request(
    "/api/v1/admin/accounts/admin-two/status",
    {
      method: "PATCH",
      headers: {
        ...authenticatedHeaders("admin"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: false }),
    },
  );
  assert.equal(otherAdminResponse.status, 403);
  assert.equal(database.state.users.find((user) => user.id === "admin-two").isActive, true);
});
