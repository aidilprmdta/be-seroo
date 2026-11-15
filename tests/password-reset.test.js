import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createAuthenticationMiddleware } from "../src/auth/middleware.js";
import { hashRefreshToken, createAccessToken } from "../src/auth/tokens.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-15T00:00:00.000Z");
const PASSWORDS = {
  admin: "admin-password-123",
  owner: "owner-password-123",
  manager: "manager-password-123",
  crew: "crew-password-123",
  disabled: "disabled-password-123",
};

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) {
      return actual === null || actual === undefined;
    }
    if (expected && typeof expected === "object") {
      if ("in" in expected) return expected.in.includes(actual);
      if ("not" in expected) return actual !== expected.not;
    }
    return actual === expected;
  });
}

function createDatabase() {
  const state = {
    users: [
      { id: "admin", name: "Admin Pusat", email: "admin@seroo.id", passwordHash: `argon2id:${PASSWORDS.admin}`, isActive: true, mustChangePassword: false },
      { id: "owner", name: "Owner Mitra", email: "owner@seroo.id", passwordHash: `argon2id:${PASSWORDS.owner}`, isActive: true, mustChangePassword: false },
      { id: "manager", name: "Manager", email: "manager@seroo.id", passwordHash: `argon2id:${PASSWORDS.manager}`, isActive: true, mustChangePassword: false },
      { id: "crew", name: "Crew", email: "crew@seroo.id", passwordHash: `argon2id:${PASSWORDS.crew}`, isActive: true, mustChangePassword: false },
      { id: "disabled", name: "Crew Nonaktif", email: "disabled@seroo.id", passwordHash: `argon2id:${PASSWORDS.disabled}`, isActive: false, mustChangePassword: false },
    ],
    outlets: [{ id: "outlet-a", name: "Rumbai", code: "RMB", isActive: true }],
    memberships: [
      { id: "membership-admin", userId: "admin", outletId: "outlet-a", role: "ADMIN_PUSAT" },
      { id: "membership-owner", userId: "owner", outletId: "outlet-a", role: "OWNER_MITRA" },
      { id: "membership-manager", userId: "manager", outletId: "outlet-a", role: "MANAGER" },
      { id: "membership-crew", userId: "crew", outletId: "outlet-a", role: "CREW" },
      { id: "membership-disabled", userId: "disabled", outletId: "outlet-a", role: "CREW" },
    ],
    sessions: [
      {
        id: "session-admin",
        userId: "admin",
        expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        revokedAt: null,
      },
    ],
    refreshTokens: [],
    passwordAudits: [],
    nextId: 1,
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
    user: {
      async findUnique({ where }) {
        const user = state.users.find(
          (item) => item.id === where.id || item.email === where.email,
        );
        return withMemberships(user);
      },
      async update({ where, data }) {
        const user = state.users.find((item) => item.id === where.id);
        Object.assign(user, data);
        return withMemberships(user);
      },
      async updateMany({ where, data }) {
        const found = state.users.filter((user) => matches(user, where));
        found.forEach((user) => Object.assign(user, structuredClone(data)));
        return { count: found.length };
      },
    },
    outletMembership: {
      async findFirst({ where }) {
        return state.memberships.find((membership) =>
          matches(membership, where),
        ) ?? null;
      },
    },
    authSession: {
      async create({ data }) {
        const session = {
          id: `session-${state.nextId++}`,
          createdAt: NOW,
          revokedAt: null,
          ...structuredClone(data),
        };
        state.sessions.push(session);
        return structuredClone(session);
      },
      async findUnique({ where, include, select }) {
        const session = state.sessions.find((item) => item.id === where.id);
        if (!session) return null;
        const result = structuredClone(session);
        if (include?.user) {
          const user = state.users.find((item) => item.id === session.userId);
          result.user = user
            ? {
                id: user.id,
                isActive: user.isActive,
                mustChangePassword: user.mustChangePassword,
              }
            : null;
        }
        if (select) {
          return Object.fromEntries(
            Object.keys(select)
              .filter((key) => select[key])
              .map((key) => [key, result[key]]),
          );
        }
        return result;
      },
      async findMany({ where }) {
        return state.sessions
          .filter((session) => matches(session, where))
          .map(({ id }) => ({ id }));
      },
      async updateMany({ where, data }) {
        const found = state.sessions.filter((session) =>
          matches(session, where),
        );
        found.forEach((session) => Object.assign(session, structuredClone(data)));
        return { count: found.length };
      },
    },
    refreshToken: {
      async create({ data }) {
        const token = {
          id: `refresh-${state.nextId++}`,
          issuedAt: NOW,
          usedAt: null,
          revokedAt: null,
          ...structuredClone(data),
        };
        state.refreshTokens.push(token);
        return structuredClone(token);
      },
      async findUnique({ where, include, select }) {
        const token = state.refreshTokens.find(
          (item) => item.tokenHash === where.tokenHash,
        );
        if (!token) return null;
        const result = structuredClone(token);
        if (include?.session) {
          const session = state.sessions.find(
            (item) => item.id === token.sessionId,
          );
          result.session = structuredClone(session);
          if (include.session.include?.user) {
            const user = state.users.find(
              (item) => item.id === session.userId,
            );
            result.session.user = user
              ? { id: user.id, isActive: user.isActive }
              : null;
          }
        }
        if (select) {
          return Object.fromEntries(
            Object.keys(select)
              .filter((key) => select[key])
              .map((key) => [key, result[key]]),
          );
        }
        return result;
      },
      async updateMany({ where, data }) {
        const found = state.refreshTokens.filter((token) =>
          matches(token, where),
        );
        found.forEach((token) => Object.assign(token, structuredClone(data)));
        return { count: found.length };
      },
    },
    userPasswordAudit: {
      async create({ data }) {
        const audit = { id: `audit-${state.nextId++}`, ...structuredClone(data) };
        state.passwordAudits.push(audit);
        return audit;
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return { prisma, state };
}

function createFixture() {
  const database = createDatabase();
  const hashPasswordFn = async (password) => `argon2id:${password}`;
  const verifyPasswordFn = async (password, passwordHash) =>
    passwordHash === `argon2id:${password}`;
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    authOptions: {
      hashPasswordFn,
      verifyPasswordFn,
      now: () => NOW,
      loginRateLimit: { limit: 10, windowMs: 15 * 60 * 1000 },
    },
    adminAccountOptions: { hashPasswordFn, now: () => NOW },
  });
  return { app, ...database };
}

function tokenFor(userId, sessionId = `session-${userId}`) {
  return createAccessToken({
    userId,
    sessionId,
    secret: ACCESS_TOKEN_SECRET,
    now: NOW,
  });
}

function adminHeaders() {
  return { Authorization: `Bearer ${tokenFor("admin")}` };
}

async function login(app, userId) {
  const emails = {
    admin: "admin@seroo.id",
    owner: "owner@seroo.id",
    manager: "manager@seroo.id",
    crew: "crew@seroo.id",
    disabled: "disabled@seroo.id",
  };
  return app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emails[userId], password: PASSWORDS[userId] }),
  });
}

test("Admin Pusat resets Crew, revokes old sessions, and requires a password change", async () => {
  const { app, prisma, state } = createFixture();
  app.get(
    "/api/v1/other/auth/me",
    createAuthenticationMiddleware({
      prisma,
      accessTokenSecret: ACCESS_TOKEN_SECRET,
      now: () => NOW,
    }),
    (c) => c.json({ success: true }),
  );
  const crewLogin = await login(app, "crew");
  const crewCredentials = (await crewLogin.json()).data;
  const secondCrewLogin = await login(app, "crew");
  const secondCrewCredentials = (await secondCrewLogin.json()).data;
  const originalMemberships = state.memberships.filter(
    (membership) => membership.userId === "crew",
  );
  const reset = await app.request(
    "/api/v1/admin/accounts/crew/reset-password",
    { method: "POST", headers: adminHeaders() },
  );
  const resetBody = await reset.json();
  const temporaryPassword = resetBody.data.temporaryPassword;

  assert.equal(reset.status, 200);
  assert.match(temporaryPassword, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(
    state.users.find((user) => user.id === "crew").passwordHash,
    `argon2id:${temporaryPassword}`,
  );
  assert.equal(state.users.find((user) => user.id === "crew").mustChangePassword, true);
  assert.equal(state.users.find((user) => user.id === "crew").isActive, true);
  assert.deepEqual(
    state.memberships.filter((membership) => membership.userId === "crew"),
    originalMemberships,
  );
  assert.ok(
    state.sessions.find((session) => session.id === crewCredentials.session.id)
      .revokedAt,
  );
  assert.ok(
    state.refreshTokens.find(
      (token) => token.tokenHash === hashRefreshToken(crewCredentials.refreshToken),
    ).revokedAt,
  );
  assert.ok(
    state.sessions.find(
      (session) => session.id === secondCrewCredentials.session.id,
    ).revokedAt,
  );
  assert.ok(
    state.refreshTokens.find(
      (token) =>
        token.tokenHash === hashRefreshToken(secondCrewCredentials.refreshToken),
    ).revokedAt,
  );
  assert.deepEqual(state.passwordAudits[0], {
    id: state.passwordAudits[0].id,
    actorUserId: "admin",
    targetUserId: "crew",
    activity: "ADMIN_RESET",
    createdAt: NOW,
  });
  assert.equal(JSON.stringify(state.passwordAudits).includes(temporaryPassword), false);

  const oldAccessResponse = await app.request("/api/v1/auth/me", {
    headers: {
      Authorization: `Bearer ${crewCredentials.accessToken}`,
    },
  });
  const oldRefreshResponse = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: crewCredentials.refreshToken }),
  });
  assert.equal(oldAccessResponse.status, 401);
  assert.equal(oldRefreshResponse.status, 401);

  const temporaryLogin = await loginWithPassword(
    app,
    "crew@seroo.id",
    temporaryPassword,
  );
  const temporaryCredentials = (await temporaryLogin.json()).data;
  assert.equal(temporaryLogin.status, 200);
  assert.equal(temporaryCredentials.user.mustChangePassword, true);

  const suffixPathRequest = await app.request("/api/v1/other/auth/me", {
    headers: {
      Authorization: `Bearer ${temporaryCredentials.accessToken}`,
    },
  });
  assert.equal(suffixPathRequest.status, 403);

  const blockedRequest = await app.request("/api/v1/auth/logout-all", {
    method: "POST",
    headers: { Authorization: `Bearer ${temporaryCredentials.accessToken}` },
  });
  assert.equal(blockedRequest.status, 403);
  assert.equal((await blockedRequest.json()).error.code, "PASSWORD_CHANGE_REQUIRED");

  const rejectedChange = await app.request("/api/v1/auth/change-password", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${temporaryCredentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "wrong-temporary-password",
      newPassword: "new-password-strong-123",
    }),
  });
  assert.equal(rejectedChange.status, 400);
  assert.equal(state.users.find((user) => user.id === "crew").mustChangePassword, true);

  const changed = await app.request("/api/v1/auth/change-password", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${temporaryCredentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: temporaryPassword,
      newPassword: "new-password-strong-123",
    }),
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), {
    success: true,
    data: { passwordChanged: true },
  });
  assert.equal(state.users.find((user) => user.id === "crew").mustChangePassword, false);
  assert.equal(
    state.sessions.find(
      (session) => session.id === temporaryCredentials.session.id,
    ).revokedAt,
    null,
  );

  const nowAllowed = await app.request("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${temporaryCredentials.accessToken}` },
  });
  assert.equal(nowAllowed.status, 200);
  assert.equal((await nowAllowed.json()).data.user.mustChangePassword, false);

  const oldPasswordLogin = await loginWithPassword(
    app,
    "crew@seroo.id",
    temporaryPassword,
  );
  assert.equal(oldPasswordLogin.status, 401);
  assert.equal(
    (await oldPasswordLogin.json()).error.code,
    "INVALID_CREDENTIALS",
  );
  const newPasswordLogin = await loginWithPassword(
    app,
    "crew@seroo.id",
    "new-password-strong-123",
  );
  assert.equal(newPasswordLogin.status, 200);
  assert.equal(
    (await newPasswordLogin.json()).data.user.mustChangePassword,
    false,
  );
  assert.equal(state.passwordAudits[1].activity, "SELF_CHANGE");
});

async function loginWithPassword(app, email, password) {
  return app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

test("Admin Pusat can reset Manager and Owner Mitra without changing their role or status", async () => {
  const { app, state } = createFixture();

  for (const userId of ["manager", "owner"]) {
    const before = structuredClone(
      state.memberships.find((membership) => membership.userId === userId),
    );
    const response = await app.request(
      `/api/v1/admin/accounts/${userId}/reset-password`,
      { method: "POST", headers: adminHeaders() },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(typeof body.data.temporaryPassword, "string");
    assert.equal(state.users.find((user) => user.id === userId).isActive, true);
    assert.equal(
      state.users.find((user) => user.id === userId).mustChangePassword,
      true,
    );
    assert.deepEqual(
      state.memberships.find((membership) => membership.userId === userId),
      before,
    );
    assert.equal(state.passwordAudits.at(-1).targetUserId, userId);
    assert.equal(state.passwordAudits.at(-1).activity, "ADMIN_RESET");
  }
});

test("Owner Mitra, Manager, and Crew cannot reset another user's password", async () => {
  const { app, state } = createFixture();

  for (const userId of ["owner", "manager", "crew"]) {
    const userLogin = await login(app, userId);
    const credentials = (await userLogin.json()).data;
    const response = await app.request(
      "/api/v1/admin/accounts/crew/reset-password",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      },
    );
    assert.equal(response.status, 403);
  }

  assert.equal(state.users.find((user) => user.id === "crew").mustChangePassword, false);
  assert.equal(state.passwordAudits.length, 0);
});

test("resetting an inactive account does not reactivate it or allow login", async () => {
  const { app, state } = createFixture();
  const response = await app.request(
    "/api/v1/admin/accounts/disabled/reset-password",
    { method: "POST", headers: adminHeaders() },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.users.find((user) => user.id === "disabled").isActive, false);
  assert.equal(state.users.find((user) => user.id === "disabled").mustChangePassword, true);

  const loginResponse = await loginWithPassword(
    app,
    "disabled@seroo.id",
    body.data.temporaryPassword,
  );
  assert.equal(loginResponse.status, 403);
  assert.equal((await loginResponse.json()).error.code, "ACCOUNT_DISABLED");
});
