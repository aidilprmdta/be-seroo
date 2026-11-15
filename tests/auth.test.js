import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const ACCESS_TOKEN_SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-12T10:00:00.000Z");
const PASSWORD_HASH = "$argon2id$test-fixture-hash";

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) {
      return actual === null || actual === undefined;
    }
    if (expected && typeof expected === "object" && "in" in expected) {
      return expected.in.includes(actual);
    }
    return actual === expected;
  });
}

function createDatabase() {
  const state = {
    users: [
      {
        id: "user-1",
        name: "Crew Fixture",
        email: "crew@seroo.test",
        passwordHash: PASSWORD_HASH,
        isActive: true,
        memberships: [
          {
            outletId: "outlet-rumbai",
            role: "MANAGER",
            outlet: {
              code: "RMB",
              name: "Outlet Rumbai",
              isActive: true,
            },
          },
          {
            outletId: "outlet-bangau",
            role: "OWNER",
            outlet: {
              code: "BGA",
              name: "Outlet Bangau",
              isActive: true,
            },
          },
          {
            outletId: "outlet-inactive",
            role: "CREW",
            outlet: {
              code: "OLD",
              name: "Outlet Tidak Aktif",
              isActive: false,
            },
          },
        ],
      },
      {
        id: "user-disabled",
        name: "Disabled Fixture",
        email: "disabled@seroo.test",
        passwordHash: PASSWORD_HASH,
        isActive: false,
        memberships: [],
      },
    ],
    sessions: [],
    refreshTokens: [],
    nextId: 1,
  };

  const user = {
    async findUnique({ where, select }) {
      const found = state.users.find(
        (candidate) =>
          candidate.id === where.id || candidate.email === where.email,
      );
      if (!found) {
        return null;
      }

      const result = structuredClone(found);
      if (select?.memberships?.where?.outlet?.isActive) {
        result.memberships = result.memberships.filter(
          (membership) => membership.outlet.isActive,
        );
      }
      return result;
    },
  };

  const authSession = {
    async create({ data }) {
      const created = {
        id: `session-${state.nextId++}`,
        createdAt: NOW,
        lastSeenAt: NOW,
        revokedAt: null,
        ...structuredClone(data),
      };
      state.sessions.push(created);
      return structuredClone(created);
    },
    async findUnique({ where, include, select }) {
      const found = state.sessions.find((session) => session.id === where.id);
      if (!found) {
        return null;
      }
      const result = structuredClone(found);
      if (include?.user) {
        const foundUser = state.users.find(
          (candidate) => candidate.id === found.userId,
        );
        result.user = foundUser
          ? { id: foundUser.id, isActive: foundUser.isActive }
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
        .map((session) => ({ id: session.id }));
    },
    async updateMany({ where, data }) {
      const matched = state.sessions.filter((session) => matches(session, where));
      matched.forEach((session) => Object.assign(session, structuredClone(data)));
      return { count: matched.length };
    },
  };

  const refreshToken = {
    async create({ data }) {
      const created = {
        id: `refresh-${state.nextId++}`,
        issuedAt: NOW,
        usedAt: null,
        revokedAt: null,
        ...structuredClone(data),
      };
      state.refreshTokens.push(created);
      return structuredClone(created);
    },
    async findUnique({ where, include, select }) {
      const found = state.refreshTokens.find(
        (token) => token.tokenHash === where.tokenHash,
      );
      if (!found) {
        return null;
      }
      const result = structuredClone(found);
      if (include?.session) {
        const session = state.sessions.find(
          (item) => item.id === found.sessionId,
        );
        const sessionCopy = structuredClone(session);
        if (include.session.include?.user) {
          const foundUser = state.users.find(
            (candidate) => candidate.id === session.userId,
          );
          sessionCopy.user = foundUser
            ? { id: foundUser.id, isActive: foundUser.isActive }
            : null;
        }
        result.session = sessionCopy;
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
      const matched = state.refreshTokens.filter((token) =>
        matches(token, where),
      );
      matched.forEach((token) => Object.assign(token, structuredClone(data)));
      return { count: matched.length };
    },
  };

  const prisma = {
    user,
    authSession,
    refreshToken,
    async $queryRaw() {},
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return { prisma, state };
}

function createFixture(options = {}) {
  const database = createDatabase();
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    authOptions: {
      verifyPasswordFn: async (password, passwordHash) =>
        password === "correct-password" && passwordHash === PASSWORD_HASH,
      hashPasswordFn: async () => "$argon2id$dummy-hash",
      now: options.now ?? (() => new Date(NOW)),
      loginRateLimit: options.loginRateLimit,
    },
  });
  return { app, ...database };
}

async function login(app, email = "crew@seroo.test") {
  return app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "correct-password",
      deviceName: "Tablet Uji",
    }),
  });
}

test("login returns the approved DTO without password hashes", async () => {
  const { app, state } = createFixture();
  const response = await login(app);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.tokenType, "Bearer");
  assert.equal(body.data.expiresIn, 900);
  assert.equal(body.data.refreshExpiresAt, "2026-12-12T10:00:00.000Z");
  assert.deepEqual(body.data.user.memberships, [
    {
      outletId: "outlet-rumbai",
      outletCode: "RMB",
      outletName: "Outlet Rumbai",
      role: "MANAGER",
    },
    {
      outletId: "outlet-bangau",
      outletCode: "BGA",
      outletName: "Outlet Bangau",
      role: "OWNER",
    },
  ]);
  assert.equal("passwordHash" in body.data.user, false);
  assert.equal("refreshToken" in state.refreshTokens[0], false);
  assert.equal(state.refreshTokens[0].tokenHash.length, 64);
  assert.equal(state.sessions.length, 1);
});

test("unknown email and incorrect password return the same error", async () => {
  const { app } = createFixture();
  const wrongPassword = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "crew@seroo.test",
      password: "wrong-password",
    }),
  });
  const unknownEmail = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "missing@seroo.test",
      password: "wrong-password",
    }),
  });

  assert.equal(wrongPassword.status, 401);
  const wrongBody = await wrongPassword.json();
  const unknownBody = await unknownEmail.json();
  assert.equal(unknownBody.success, false);
  assert.equal(wrongBody.success, false);
  assert.equal(unknownBody.error.code, wrongBody.error.code);
  assert.equal(unknownBody.error.message, wrongBody.error.message);
  assert.equal(typeof unknownBody.error.requestId, "string");
  assert.equal(typeof wrongBody.error.requestId, "string");
});

test("login rejects inactive accounts after credential verification", async () => {
  const { app } = createFixture();
  const response = await login(app, "disabled@seroo.test");
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ACCOUNT_DISABLED");
});

test("login rejects stale password hashes before issuing a session", async () => {
  const database = createDatabase();
  const originalPasswordHash = database.state.users[0].passwordHash;
  const app = createApp({
    prisma: database.prisma,
    authConfig: { accessTokenSecret: ACCESS_TOKEN_SECRET },
    authOptions: {
      verifyPasswordFn: async (password, passwordHash) => {
        if (password === "correct-password" && passwordHash === originalPasswordHash) {
          database.state.users[0].passwordHash = "$argon2id$rotated-hash";
          return true;
        }
        return false;
      },
      hashPasswordFn: async () => "$argon2id$dummy-hash",
      now: () => new Date(NOW),
    },
  });

  const response = await login(app);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "PASSWORD_CHANGED");
  assert.equal(database.state.sessions.length, 0);
  assert.equal(database.state.refreshTokens.length, 0);
});

test("malformed JSON and unknown fields return validation errors", async () => {
  const { app } = createFixture();
  const malformed = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const extraField = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "crew@seroo.test",
      password: "correct-password",
      role: "OWNER",
    }),
  });

  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "VALIDATION_ERROR");
  assert.equal(extraField.status, 400);
  assert.equal((await extraField.json()).error.code, "VALIDATION_ERROR");
});

test("rate limits repeated login attempts without exposing account state", async () => {
  let timestamp = new Date(NOW);
  const { app } = createFixture({ now: () => new Date(timestamp) });
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "crew@seroo.test",
        password: "wrong-password",
      }),
    }));
  }

  assert.deepEqual(
    responses.map((response) => response.status),
    [401, 401, 401, 401, 401, 429],
  );
  const limitedBody = await responses[5].json();
  assert.equal(limitedBody.error.code, "RATE_LIMITED");
  assert.equal(responses[5].headers.get("retry-after"), "900");
  assert.match(limitedBody.error.message, /15 menit/);

  timestamp = new Date(timestamp.getTime() + 60 * 1000);
  const stillLimited = await login(app);
  assert.equal(stillLimited.status, 429);
  assert.equal(stillLimited.headers.get("retry-after"), "840");

  timestamp = new Date(timestamp.getTime() + 14 * 60 * 1000);
  const afterCooldown = await login(app);
  assert.equal(afterCooldown.status, 200);
});

test("successful login resets failed attempts and logout can be followed by immediate login", async () => {
  const { app } = createFixture();
  const invalidLogin = () =>
    app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "crew@seroo.test",
        password: "wrong-password",
      }),
    });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await invalidLogin()).status, 401);
  }

  const firstLogin = await login(app);
  assert.equal(firstLogin.status, 200);
  const firstBody = await firstLogin.json();
  const logoutResponse = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: firstBody.data.refreshToken }),
  });
  assert.equal(logoutResponse.status, 200);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal((await login(app)).status, 200);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await invalidLogin()).status, 401);
  }
  assert.equal((await invalidLogin()).status, 429);
});

test("me requires an active bearer session and returns outlet memberships", async () => {
  const { app } = createFixture();
  const anonymousResponse = await app.request("/api/v1/auth/me");
  const loginResponse = await login(app);
  const credentials = await loginResponse.json();
  const meResponse = await app.request("/api/v1/auth/me", {
    headers: {
      authorization: `Bearer ${credentials.data.accessToken}`,
    },
  });
  const body = await meResponse.json();

  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).error.code, "UNAUTHORIZED");
  assert.equal(meResponse.status, 200);
  assert.deepEqual(
    body.data.user.memberships.map((membership) => membership.role),
    ["MANAGER", "OWNER"],
  );
  assert.equal("role" in body.data.user, false);
  assert.equal("passwordHash" in body.data.user, false);
  assert.equal(body.data.session.id, credentials.data.session.id);
});

test("login enforces the active-session cap for Manager accounts", async () => {
  const { app, state } = createFixture();

  const firstLogin = await login(app);
  const firstBody = await firstLogin.json();
  const secondSession = {
    id: "session-2",
    userId: "user-1",
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    lastSeenAt: NOW,
    createdAt: NOW,
  };
  state.sessions.push(secondSession);
  state.refreshTokens.push({
    id: "refresh-2",
    sessionId: secondSession.id,
    tokenHash: "hash-2",
    issuedAt: NOW,
    usedAt: null,
    revokedAt: null,
  });

  const thirdLogin = await login(app);
  const thirdBody = await thirdLogin.json();
  const activeSessions = state.sessions.filter(
    (session) => session.userId === "user-1" && session.revokedAt === null,
  );
  const revokedSessions = state.sessions.filter(
    (session) => session.userId === "user-1" && session.revokedAt !== null,
  );

  assert.equal(thirdLogin.status, 200);
  assert.equal(activeSessions.length, 2);
  assert.equal(revokedSessions.length, 1);
  assert.equal(thirdBody.data.session.id, activeSessions[activeSessions.length - 1].id);
});

test("idle sessions are revoked after 30 minutes of inactivity", async () => {
  const { app, state } = createFixture();
  const loginResponse = await login(app);
  const loginBody = await loginResponse.json();
  const session = state.sessions.find((item) => item.id === loginBody.data.session.id);
  session.lastSeenAt = new Date(NOW.getTime() - 31 * 60 * 1000);

  const response = await app.request("/api/v1/auth/me", {
    headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "SESSION_REVOKED");
  assert.ok(state.sessions.find((item) => item.id === session.id).revokedAt);
});

test("refresh rotates token while preserving the original session expiry", async () => {
  const { app } = createFixture();
  const loginResponse = await login(app);
  const loginBody = await loginResponse.json();
  const firstToken = loginBody.data.refreshToken;
  const response = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: firstToken }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.notEqual(body.data.refreshToken, firstToken);
  assert.equal(body.data.session.id, loginBody.data.session.id);
  assert.equal(body.data.refreshExpiresAt, loginBody.data.refreshExpiresAt);
});

test("refresh token reuse revokes the whole device session", async () => {
  const { app, state } = createFixture();
  const loginResponse = await login(app);
  const loginBody = await loginResponse.json();
  const firstToken = loginBody.data.refreshToken;
  const rotatedResponse = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: firstToken }),
  });
  const rotatedBody = await rotatedResponse.json();

  const replayResponse = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: firstToken }),
  });
  const profileResponse = await app.request("/api/v1/auth/me", {
    headers: {
      authorization: `Bearer ${rotatedBody.data.accessToken}`,
    },
  });

  assert.equal(replayResponse.status, 401);
  assert.equal(
    (await replayResponse.json()).error.code,
    "REFRESH_TOKEN_REUSE_DETECTED",
  );
  assert.ok(state.sessions[0].revokedAt);
  assert.equal(profileResponse.status, 401);
  assert.equal((await profileResponse.json()).error.code, "SESSION_REVOKED");
});

test("logout is idempotent and logout-all revokes every active device", async () => {
  const { app, state } = createFixture();
  const firstLogin = await (await login(app)).json();
  const secondLogin = await (await login(app)).json();
  const logoutResponse = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refreshToken: firstLogin.data.refreshToken,
    }),
  });
  const repeatedLogout = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refreshToken: firstLogin.data.refreshToken,
    }),
  });
  const logoutAllResponse = await app.request("/api/v1/auth/logout-all", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secondLogin.data.accessToken}`,
    },
  });
  const logoutAllBody = await logoutAllResponse.json();

  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(await repeatedLogout.json(), {
    success: true,
    data: { loggedOut: true },
  });
  assert.equal(logoutAllResponse.status, 200);
  assert.equal(logoutAllBody.data.revokedSessions, 1);
  assert.equal(state.sessions.filter((session) => session.revokedAt).length, 2);
});

test("logout prevents reuse of the revoked access and refresh tokens", async () => {
  const { app } = createFixture();
  const credentials = await (await login(app)).json();

  const logoutResponse = await app.request("/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refreshToken: credentials.data.refreshToken,
    }),
  });
  const profileResponse = await app.request("/api/v1/auth/me", {
    headers: {
      authorization: `Bearer ${credentials.data.accessToken}`,
    },
  });
  const refreshResponse = await app.request("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refreshToken: credentials.data.refreshToken,
    }),
  });

  assert.equal(logoutResponse.status, 200);
  assert.equal(profileResponse.status, 401);
  assert.equal((await profileResponse.json()).error.code, "SESSION_REVOKED");
  assert.equal(refreshResponse.status, 401);
  assert.equal((await refreshResponse.json()).error.code, "SESSION_REVOKED");
});

test("unknown auth paths do not provide public registration", async () => {
  const { app } = createFixture();
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
  });

  assert.equal(response.status, 404);
});
