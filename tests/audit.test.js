import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { sanitizeAuditMetadata } from "../src/audit/service.js";
import { createAccessToken } from "../src/auth/tokens.js";

const SECRET = "test-access-secret-at-least-32-characters";
const NOW = new Date("2026-11-15T12:00:00.000Z");

function tokenFor(userId) {
  return createAccessToken({
    userId,
    sessionId: `session-${userId}`,
    secret: SECRET,
    now: NOW,
  });
}

function createDatabase() {
  const entries = [
    {
      id: "audit-1",
      actorUserId: "admin",
      sessionId: "session-admin",
      outletId: "outlet-a",
      action: "PASSWORD_RESET",
      resourceType: "User",
      resourceId: "crew",
      outcome: "SUCCESS",
      metadata: { mustChangePassword: true },
      createdAt: NOW,
      actor: { id: "admin", name: "Admin", email: "admin@seroo.test" },
    },
  ];
  return {
    entries,
    prisma: {
      authSession: {
        async findUnique({ where }) {
          const userId = where.id.replace("session-", "");
          return {
            id: where.id,
            userId,
            revokedAt: null,
            expiresAt: new Date("2026-11-16T00:00:00.000Z"),
            lastSeenAt: NOW,
            user: { id: userId, isActive: true, mustChangePassword: false },
          };
        },
        async updateMany() {
          return { count: 1 };
        },
      },
      refreshToken: { async updateMany() { return { count: 0 }; } },
      outletMembership: {
        async findFirst({ where }) {
          if (where.userId === "admin" && where.role === "ADMIN_PUSAT") {
            return { id: "membership-admin" };
          }
          return null;
        },
      },
      auditLog: {
        async findMany() {
          return entries;
        },
      },
    },
  };
}

test("audit log hanya dapat dibaca Admin Pusat dan metadata tidak membocorkan secret", async () => {
  const { prisma } = createDatabase();
  const app = createApp({ prisma, authConfig: { accessTokenSecret: SECRET } });

  const adminResponse = await app.request("/api/v1/admin/audit-logs?page=1&pageSize=10", {
    headers: { Authorization: `Bearer ${tokenFor("admin")}` },
  });
  assert.equal(adminResponse.status, 200);
  const body = await adminResponse.json();
  assert.equal(body.data.auditLogs[0].action, "PASSWORD_RESET");
  assert.equal(body.data.pagination.hasNextPage, false);

  const crewResponse = await app.request("/api/v1/admin/audit-logs", {
    headers: { Authorization: `Bearer ${tokenFor("crew")}` },
  });
  assert.equal(crewResponse.status, 403);

  const safe = sanitizeAuditMetadata({
    password: "do-not-store",
    refreshToken: "do-not-store",
    nested: { apiKey: "do-not-store", value: "safe" },
  });
  assert.deepEqual(safe, {
    password: "[REDACTED]",
    refreshToken: "[REDACTED]",
    nested: { apiKey: "[REDACTED]", value: "safe" },
  });
});

test("audit log memvalidasi filter query", async () => {
  const { prisma } = createDatabase();
  const app = createApp({ prisma, authConfig: { accessTokenSecret: SECRET } });
  const response = await app.request("/api/v1/admin/audit-logs?page=0", {
    headers: { Authorization: `Bearer ${tokenFor("admin")}` },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});
