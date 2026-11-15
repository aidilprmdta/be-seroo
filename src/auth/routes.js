import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { AuthError } from "./errors.js";
import { createAuthenticationMiddleware } from "./middleware.js";
import { createAuthService } from "./service.js";
import { writeAuditLog } from "../audit/service.js";

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(1024),
    deviceName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const refreshSchema = z
  .object({
    refreshToken: z.string().min(20).max(256),
  })
  .strict();

const logoutSchema = refreshSchema;
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(12).max(128),
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword);

function parseBody(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AuthError(
      "VALIDATION_ERROR",
      400,
      "Periksa kembali data yang dikirim.",
    );
  }
  return result.data;
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AuthError(
        "VALIDATION_ERROR",
        400,
        "Periksa kembali data yang dikirim.",
      );
    }
    throw error;
  }
}

function createRateLimiter({ limit, windowMs, maxEntries = 5000, now }) {
  const attempts = new Map();

  return {
    allow(key) {
      const timestamp = now();
      for (const [storedKey, entry] of attempts) {
        if (entry.resetAt <= timestamp) {
          attempts.delete(storedKey);
        }
      }

      const entry = attempts.get(key);
      return entry ? entry.count < limit : attempts.size < maxEntries;
    },
    recordFailure(key) {
      const timestamp = now();
      for (const [storedKey, entry] of attempts) {
        if (entry.resetAt <= timestamp) {
          attempts.delete(storedKey);
        }
      }

      let entry = attempts.get(key);
      if (!entry) {
        if (attempts.size >= maxEntries) {
          return;
        }
        entry = { count: 0, resetAt: timestamp + windowMs };
        attempts.set(key, entry);
      }
      entry.count += 1;
    },
    reset(key) {
      attempts.delete(key);
    },
    retryAfterSeconds(key) {
      const entry = attempts.get(key);
      if (entry) {
        return Math.max(1, Math.ceil((entry.resetAt - now()) / 1000));
      }

      const nextResetAt = Math.min(
        ...[...attempts.values()].map(({ resetAt }) => resetAt),
      );
      return Number.isFinite(nextResetAt)
        ? Math.max(1, Math.ceil((nextResetAt - now()) / 1000))
        : 1;
    },
  };
}

function retryMessage(retryAfterSeconds) {
  const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
  return `Terlalu banyak percobaan. Coba lagi dalam ${retryAfterMinutes} menit.`;
}

function rateLimitKey(prefix, value) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

export function createAuthRoutes({
  prisma,
  authConfig,
  verifyPasswordFn,
  hashPasswordFn,
  now = () => new Date(),
  loginRateLimit = { limit: 5, windowMs: 15 * 60 * 1000 },
}) {
  const routes = new Hono();
  const service = createAuthService({
    prisma,
    accessTokenSecret: authConfig.accessTokenSecret,
    verifyPasswordFn,
    hashPasswordFn,
    now,
  });
  const loginLimiter = createRateLimiter({
    ...loginRateLimit,
    now: () => now().getTime(),
  });
  const refreshLimiter = createRateLimiter({
    limit: 20,
    windowMs: 15 * 60 * 1000,
    now: () => now().getTime(),
  });
  const authenticate = createAuthenticationMiddleware({
    prisma,
    accessTokenSecret: authConfig.accessTokenSecret,
    now,
  });

  routes.post("/login", async (c) => {
    const body = parseBody(loginSchema, await readJson(c));
    const key = rateLimitKey("login", body.email);
    if (!loginLimiter.allow(key)) {
      const retryAfterSeconds = loginLimiter.retryAfterSeconds(key);
      c.header("Retry-After", String(retryAfterSeconds));
      throw new AuthError(
        "RATE_LIMITED",
        429,
        retryMessage(retryAfterSeconds),
      );
    }

    let data;
    try {
      data = await service.login(body);
    } catch (error) {
      if (error instanceof AuthError && error.code === "INVALID_CREDENTIALS") {
        loginLimiter.recordFailure(key);
      }
      throw error;
    }

    loginLimiter.reset(key);
    await writeAuditLog(prisma, {
      actorUserId: data.user.id,
      sessionId: data.session.id,
      action: "LOGIN_SUCCEEDED",
      resourceType: "AuthSession",
      resourceId: data.session.id,
      metadata: { deviceNameProvided: Boolean(body.deviceName) },
    });
    return c.json({ success: true, data }, 200);
  });

  routes.post("/refresh", async (c) => {
    const body = parseBody(refreshSchema, await readJson(c));
    const key = rateLimitKey("refresh", body.refreshToken);
    if (!refreshLimiter.allow(key)) {
      const retryAfterSeconds = refreshLimiter.retryAfterSeconds(key);
      c.header("Retry-After", String(retryAfterSeconds));
      throw new AuthError(
        "RATE_LIMITED",
        429,
        retryMessage(retryAfterSeconds),
      );
    }

    const data = await service.refresh(body);
    await writeAuditLog(prisma, {
      sessionId: data.session.id,
      action: "SESSION_REFRESHED",
      resourceType: "AuthSession",
      resourceId: data.session.id,
      metadata: { rotated: true },
    });
    return c.json({ success: true, data }, 200);
  });

  routes.get("/me", authenticate, async (c) => {
    const auth = c.get("auth");
    const user = await service.getCurrentUser(auth.userId);
    const session = await prisma.authSession.findUnique({
      where: { id: auth.sessionId },
      select: { id: true, expiresAt: true },
    });

    if (!session) {
      throw new AuthError("SESSION_REVOKED", 401, "Sesi sudah tidak berlaku.");
    }

    return c.json({
      success: true,
      data: {
        user,
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
        },
      },
    });
  });

  routes.post("/change-password", authenticate, async (c) => {
    const auth = c.get("auth");
    const body = parseBody(
      changePasswordSchema,
      await readJson(c),
    );
    const data = await service.changePassword({
      userId: auth.userId,
      sessionId: auth.sessionId,
      ...body,
    });
    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      action: "PASSWORD_CHANGED",
      resourceType: "User",
      resourceId: auth.userId,
      metadata: { otherSessionsRevoked: true },
    });
    return c.json({ success: true, data }, 200);
  });

  routes.post("/logout", async (c) => {
    const body = parseBody(logoutSchema, await readJson(c));
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash: createHash("sha256").update(body.refreshToken).digest("hex") },
      select: { sessionId: true },
    });
    const data = await service.logout(body);
    await writeAuditLog(prisma, {
      sessionId: token?.sessionId,
      action: "LOGOUT_SUCCEEDED",
      resourceType: "AuthSession",
      resourceId: token?.sessionId,
      metadata: { tokenRecognized: Boolean(token) },
    });
    return c.json({ success: true, data }, 200);
  });

  routes.post("/logout-all", authenticate, async (c) => {
    const auth = c.get("auth");
    const data = await service.logoutAll(auth.userId);
    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      action: "LOGOUT_ALL_SUCCEEDED",
      resourceType: "User",
      resourceId: auth.userId,
      metadata: { revokedSessions: data.revokedSessions },
    });
    return c.json({ success: true, data }, 200);
  });

  return routes;
}
