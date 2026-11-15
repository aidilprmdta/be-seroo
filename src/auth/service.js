import { randomBytes } from "node:crypto";
import { AuthError, invalidCredentials } from "./errors.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
} from "./tokens.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_LIMIT_MS = {
  CREW: 12 * 60 * 60 * 1000,
  DEFAULT: SESSION_TTL_MS,
};

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  mustChangePassword: true,
  memberships: {
    where: { outlet: { isActive: true } },
    select: {
      outletId: true,
      role: true,
      outlet: {
        select: {
          code: true,
          name: true,
        },
      },
    },
  },
};

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mustChangePassword: user.mustChangePassword === true,
    memberships: user.memberships.map((membership) => ({
      outletId: membership.outletId,
      outletCode: membership.outlet.code,
      outletName: membership.outlet.name,
      role: membership.role,
    })),
  };
}

function sessionDto(session) {
  const expiresAt = session.expiresAt.toISOString();
  return {
    id: session.id,
    expiresAt,
  };
}

function resolveSessionPolicy(user) {
  const roles = new Set((user.memberships ?? []).map((membership) => membership.role));

  if (roles.has("CREW")) {
    return {
      maxActiveSessions: 1,
      absoluteLifetimeMs: SESSION_ABSOLUTE_LIMIT_MS.CREW,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    };
  }

  return {
    maxActiveSessions: 2,
    absoluteLifetimeMs: SESSION_ABSOLUTE_LIMIT_MS.DEFAULT,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  };
}

async function revokeSession(tx, sessionId, now) {
  await tx.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.refreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export function createAuthService({
  prisma,
  accessTokenSecret,
  verifyPasswordFn = verifyPassword,
  hashPasswordFn = hashPassword,
  now = () => new Date(),
}) {
  let dummyPasswordHash;

  async function verifyCredentials(user, password) {
    if (!user) {
      dummyPasswordHash ??= hashPasswordFn(randomBytes(32).toString("hex"));
      await verifyPasswordFn(password, await dummyPasswordHash);
      throw invalidCredentials();
    }

    if (!(await verifyPasswordFn(password, user.passwordHash))) {
      throw invalidCredentials();
    }
  }

  function accessTokenFor(userId, sessionId, issuedAt) {
    return createAccessToken({
      userId,
      sessionId,
      secret: accessTokenSecret,
      now: issuedAt,
    });
  }

  async function createSession(user, deviceName) {
    const issuedAt = now();
    const policy = resolveSessionPolicy(user);
    const expiresAt = new Date(issuedAt.getTime() + policy.absoluteLifetimeMs);
    const refreshToken = createRefreshToken();

    const session = await prisma.$transaction(async (tx) => {
      const latestUser = await tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, passwordHash: true, isActive: true },
      });

      if (!latestUser) {
        throw new AuthError(
          "ACCOUNT_DISABLED",
          403,
          "Akun tidak aktif. Hubungi administrator.",
        );
      }

      if (!latestUser.isActive) {
        throw new AuthError(
          "ACCOUNT_DISABLED",
          403,
          "Akun tidak aktif. Hubungi administrator.",
        );
      }

      if (latestUser.passwordHash !== user.passwordHash) {
        throw new AuthError(
          "PASSWORD_CHANGED",
          409,
          "Password akun berubah. Silakan masuk kembali.",
        );
      }

      const activeSessions = tx.authSession.findMany
        ? await tx.authSession.findMany({
            where: { userId: user.id, revokedAt: null },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          })
        : [];

      const overflow = activeSessions.length - policy.maxActiveSessions;
      if (overflow >= 0) {
        const sessionsToRevoke = activeSessions.slice(0, overflow + 1);
        for (const sessionToRevoke of sessionsToRevoke) {
          await revokeSession(tx, sessionToRevoke.id, issuedAt);
        }
      }

      const created = await tx.authSession.create({
        data: {
          userId: user.id,
          deviceName: deviceName ?? null,
          expiresAt,
          lastSeenAt: issuedAt,
        },
      });

      await tx.refreshToken.create({
        data: {
          sessionId: created.id,
          tokenHash: hashRefreshToken(refreshToken),
        },
      });

      return created;
    });

    return {
      accessToken: accessTokenFor(user.id, session.id, issuedAt),
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      refreshExpiresAt: expiresAt.toISOString(),
      session: sessionDto(session),
    };
  }

  async function login({ email, password, deviceName }) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        ...userProfileSelect,
        passwordHash: true,
      },
    });

    await verifyCredentials(user, password);

    if (!user.isActive) {
      throw new AuthError(
        "ACCOUNT_DISABLED",
        403,
        "Akun tidak aktif. Hubungi administrator.",
      );
    }

    const tokens = await createSession(user, deviceName);
    return {
      ...tokens,
      user: publicUser(user),
    };
  }

  async function refresh({ refreshToken }) {
    const tokenHash = hashRefreshToken(refreshToken);
    const replacementToken = createRefreshToken();
    const refreshedAt = now();

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          session: {
            include: {
              user: {
                select: { id: true, isActive: true },
              },
            },
          },
        },
      });

      if (!current) {
        return { error: "INVALID_REFRESH_TOKEN" };
      }

      const session = current.session;
      if (current.usedAt) {
        await revokeSession(tx, session.id, refreshedAt);
        return { error: "REFRESH_TOKEN_REUSE_DETECTED" };
      }

      if (current.revokedAt || session.revokedAt) {
        return { error: "SESSION_REVOKED" };
      }

      if (session.expiresAt <= refreshedAt) {
        await revokeSession(tx, session.id, refreshedAt);
        return { error: "INVALID_REFRESH_TOKEN" };
      }

      if (!session.user.isActive) {
        await revokeSession(tx, session.id, refreshedAt);
        return { error: "ACCOUNT_DISABLED" };
      }

      const consumed = await tx.refreshToken.updateMany({
        where: {
          id: current.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { usedAt: refreshedAt },
      });

      if (consumed.count !== 1) {
        await revokeSession(tx, session.id, refreshedAt);
        return { error: "REFRESH_TOKEN_REUSE_DETECTED" };
      }

      await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: refreshedAt },
      });

      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: hashRefreshToken(replacementToken),
        },
      });

      return {
        accessToken: accessTokenFor(session.userId, session.id, refreshedAt),
        tokenType: "Bearer",
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        refreshToken: replacementToken,
        refreshExpiresAt: session.expiresAt.toISOString(),
        session: sessionDto(session),
      };
    });

    if (result.error) {
      const errorMessages = {
        INVALID_REFRESH_TOKEN: [401, "Refresh token tidak valid."],
        REFRESH_TOKEN_REUSE_DETECTED: [
          401,
          "Refresh token digunakan kembali. Silakan login ulang.",
        ],
        SESSION_REVOKED: [401, "Sesi sudah dicabut. Silakan login ulang."],
        ACCOUNT_DISABLED: [
          403,
          "Akun tidak aktif. Hubungi administrator.",
        ],
      };
      const [status, message] = errorMessages[result.error];
      throw new AuthError(result.error, status, message);
    }

    return result;
  }

  async function getCurrentUser(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect,
    });

    if (!user || !user.isActive) {
      throw new AuthError(
        "ACCOUNT_DISABLED",
        403,
        "Akun tidak aktif. Hubungi administrator.",
      );
    }

    return publicUser(user);
  }

  async function changePassword({
    userId,
    sessionId,
    currentPassword,
    newPassword,
  }) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new AuthError(
        "ACCOUNT_DISABLED",
        403,
        "Akun tidak aktif. Hubungi administrator.",
      );
    }

    if (!(await verifyPasswordFn(currentPassword, user.passwordHash))) {
      throw new AuthError(
        "INVALID_CURRENT_PASSWORD",
        400,
        "Password lama tidak sesuai.",
      );
    }

    const passwordHash = await hashPasswordFn(newPassword);
    const changedAt = now();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          passwordHash: user.passwordHash,
          isActive: true,
        },
        data: { passwordHash, mustChangePassword: false },
      });

      if (updated.count !== 1) {
        throw new AuthError(
          "PASSWORD_CHANGED",
          409,
          "Password akun berubah. Silakan coba kembali.",
        );
      }

      const otherSessions = await tx.authSession.findMany({
        where: { userId, id: { not: sessionId }, revokedAt: null },
        select: { id: true },
      });
      const otherSessionIds = otherSessions.map((session) => session.id);

      await tx.authSession.updateMany({
        where: { userId, id: { not: sessionId }, revokedAt: null },
        data: { revokedAt: changedAt },
      });
      if (otherSessionIds.length > 0) {
        await tx.refreshToken.updateMany({
          where: { sessionId: { in: otherSessionIds }, revokedAt: null },
          data: { revokedAt: changedAt },
        });
      }

      await tx.userPasswordAudit.create({
        data: {
          actorUserId: userId,
          targetUserId: userId,
          activity: "SELF_CHANGE",
          createdAt: changedAt,
        },
      });
    });

    return { passwordChanged: true };
  }

  async function logout({ refreshToken }) {
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      select: { sessionId: true },
    });

    if (token) {
      await prisma.$transaction(async (tx) => {
        await revokeSession(tx, token.sessionId, now());
      });
    }

    return { loggedOut: true };
  }

  async function logoutAll(userId) {
    const revokedAt = now();
    return prisma.$transaction(async (tx) => {
      const sessions = await tx.authSession.findMany({
        where: { userId },
        select: { id: true },
      });
      const sessionIds = sessions.map((session) => session.id);
      const revoked = await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      });

      if (sessionIds.length > 0) {
        await tx.refreshToken.updateMany({
          where: { sessionId: { in: sessionIds }, revokedAt: null },
          data: { revokedAt },
        });
      }

      return {
        loggedOut: true,
        revokedSessions: revoked.count,
      };
    });
  }

  return {
    login,
    refresh,
    getCurrentUser,
    changePassword,
    logout,
    logoutAll,
  };
}
