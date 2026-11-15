import { AuthError } from "./errors.js";
import { verifyAccessToken } from "./tokens.js";

export function createAuthenticationMiddleware({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
}) {
  return async function authenticate(c, next) {
    const authorization = c.req.header("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      throw new AuthError("UNAUTHORIZED", 401, "Autentikasi diperlukan.");
    }

    const timestamp = now();
    const claims = verifyAccessToken(match[1], {
      secret: accessTokenSecret,
      now: timestamp,
    });

    const session = await prisma.authSession.findUnique({
      where: { id: claims.sessionId },
      include: {
        user: {
          select: { id: true, isActive: true, mustChangePassword: true },
        },
      },
    });

    if (
      !session ||
      session.userId !== claims.userId ||
      !session.user ||
      session.revokedAt ||
      session.expiresAt <= timestamp
    ) {
      throw new AuthError("SESSION_REVOKED", 401, "Sesi sudah tidak berlaku.");
    }

    if (!session.user.isActive) {
      throw new AuthError(
        "ACCOUNT_DISABLED",
        403,
        "Akun tidak aktif. Hubungi administrator.",
      );
    }

    const idleTimeoutMs = 30 * 60 * 1000;
    // `lastSeenAt` is present on migrated production sessions. Keep a safe
    // compatibility fallback for legacy rows and lightweight test adapters.
    const lastSeenAtValue = session.lastSeenAt ?? session.createdAt ?? timestamp;
    const lastSeenAt =
      lastSeenAtValue instanceof Date
        ? lastSeenAtValue
        : new Date(lastSeenAtValue);
    if (lastSeenAt.getTime() + idleTimeoutMs <= timestamp.getTime()) {
      if (prisma.authSession.updateMany) {
        await prisma.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: timestamp },
        });
      }
      if (prisma.refreshToken?.updateMany) {
        await prisma.refreshToken.updateMany({
          where: { sessionId: session.id, revokedAt: null },
          data: { revokedAt: timestamp },
        });
      }
      throw new AuthError("SESSION_REVOKED", 401, "Sesi sudah tidak berlaku.");
    }

    const passwordChangeAllowed =
      (c.req.method === "GET" && c.req.path === "/api/v1/auth/me") ||
      (c.req.method === "POST" &&
        c.req.path === "/api/v1/auth/change-password");
    if (session.user.mustChangePassword && !passwordChangeAllowed) {
      throw new AuthError(
        "PASSWORD_CHANGE_REQUIRED",
        403,
        "Ubah password sementara sebelum melanjutkan.",
      );
    }

    if (prisma.authSession.updateMany) {
      await prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { lastSeenAt: timestamp },
      });
    }

    c.set("auth", {
      userId: session.userId,
      sessionId: session.id,
    });
    await next();
  };
}
