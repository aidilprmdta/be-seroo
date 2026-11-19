import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { AdminAccountError } from "./errors.js";
import { writeAuditLog } from "../audit/service.js";

const accountSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  memberships: {
    select: {
      role: true,
      outlet: {
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
        },
      },
    },
  },
};

const createAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
    role: z.enum(["OWNER_MITRA", "MANAGER", "CREW"]),
    outletId: z.string().trim().min(1).max(64),
  })
  .strict();

const accountStatusSchema = z.object({ isActive: z.boolean() }).strict();
const passwordResetRoles = ["OWNER_MITRA", "MANAGER", "CREW"];
const accountListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

function toAccountDto(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    memberships: (user.memberships ?? []).map((membership) => ({
      role: membership.role,
      outlet: {
        id: membership.outlet.id,
        name: membership.outlet.name,
        code: membership.outlet.code,
        isActive: membership.outlet.isActive,
      },
    })),
  };
}

async function requireAdminPusat(prisma, userId) {
  const membership = await prisma.outletMembership.findFirst({
    where: { userId, role: "ADMIN_PUSAT" },
    select: { id: true },
  });
  if (!membership) {
    throw new AdminAccountError(
      "FORBIDDEN",
      403,
      "Hanya Admin Pusat yang dapat mengelola akun.",
    );
  }
}

function assertPasswordResetTarget(account) {
  const roles = (account.memberships ?? []).map((membership) => membership.role);
  if (
    roles.length === 0 ||
    roles.some((role) => !passwordResetRoles.includes(role))
  ) {
    throw new AdminAccountError(
      "PASSWORD_RESET_NOT_ALLOWED",
      403,
      "Reset password hanya tersedia untuk Owner Mitra, Manager, atau Crew.",
    );
  }
}

async function readJson(c) {
  try {
    const raw = await c.req.json();
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AdminAccountError(
        "VALIDATION_ERROR",
        400,
        "Format permintaan JSON tidak valid.",
      );
    }
    throw error;
  }
}

function parseOrThrow(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AdminAccountError("VALIDATION_ERROR", 400, message);
  }
  return result.data;
}

export function createAdminAccountRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  hashPasswordFn = hashPassword,
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/accounts", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const { page, pageSize } = parseOrThrow(
      accountListQuerySchema,
      c.req.query(),
      "Nomor halaman atau ukuran halaman tidak valid.",
    );
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        select: accountSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count(),
    ]);

    return c.json({
      success: true,
      data: {
        accounts: users.map(toAccountDto),
        page,
        pageSize,
        total,
        hasNextPage: page * pageSize < total,
      },
    });
  });

  routes.get("/outlets", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const outlets = await prisma.outlet.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    });

    return c.json({
      success: true,
      data: { outlets },
    });
  });

  routes.post("/accounts", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const input = parseOrThrow(
      createAccountSchema,
      await readJson(c),
      "Nama, email, password, role, atau outlet tidak valid.",
    );

    const selectedOutlet = await prisma.outlet.findUnique({
      where: { id: input.outletId },
      select: { id: true, isActive: true },
    });
    if (!selectedOutlet) {
      throw new AdminAccountError("NOT_FOUND", 404, "Outlet tidak ditemukan.");
    }
    if (!selectedOutlet.isActive) {
      throw new AdminAccountError(
        "OUTLET_INACTIVE",
        409,
        "Akun hanya dapat ditetapkan ke outlet aktif.",
      );
    }

    const passwordHash = await hashPasswordFn(input.password);
    let account;
    try {
      account = await prisma.$transaction(async (tx) => {
        const outlet = await tx.outlet.findUnique({
          where: { id: input.outletId },
          select: { id: true, isActive: true },
        });
        if (!outlet) {
          throw new AdminAccountError("NOT_FOUND", 404, "Outlet tidak ditemukan.");
        }
        if (!outlet.isActive) {
          throw new AdminAccountError(
            "OUTLET_INACTIVE",
            409,
            "Akun hanya dapat ditetapkan ke outlet aktif.",
          );
        }
        return tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash,
            isActive: true,
            memberships: {
              create: {
                role: input.role,
                outlet: { connect: { id: input.outletId } },
              },
            },
          },
          select: accountSelect,
        });
      });
    } catch (error) {
      if (error?.code === "P2002") {
        throw new AdminAccountError(
          "EMAIL_ALREADY_EXISTS",
          409,
          "Email sudah digunakan oleh akun lain.",
        );
      }
      throw error;
    }

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId: input.outletId,
      action: "ACCOUNT_CREATED",
      resourceType: "User",
      resourceId: account.id,
      metadata: { role: input.role, email: input.email },
    });

    return c.json({ success: true, data: { account: toAccountDto(account) } }, 201);
  });

  routes.patch("/accounts/:userId/status", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const userId = c.req.param("userId");
    if (!userId || userId.length > 64) {
      throw new AdminAccountError("VALIDATION_ERROR", 400, "ID akun tidak valid.");
    }
    const { isActive } = parseOrThrow(
      accountStatusSchema,
      await readJson(c),
      "Status akun tidak valid.",
    );

    if (!isActive && userId === auth.userId) {
      throw new AdminAccountError(
        "SELF_DEACTIVATION_NOT_ALLOWED",
        409,
        "Admin Pusat tidak dapat menonaktifkan akunnya sendiri.",
      );
    }

    const currentAccount = await prisma.user.findUnique({
      where: { id: userId },
      select: accountSelect,
    });
    if (!currentAccount) {
      throw new AdminAccountError("NOT_FOUND", 404, "Akun tidak ditemukan.");
    }
    if (
      !isActive &&
      currentAccount.memberships.some(
        (membership) => membership.role === "ADMIN_PUSAT",
      )
    ) {
      throw new AdminAccountError(
        "ADMIN_ACCOUNT_PROTECTED",
        403,
        "Akun Admin Pusat tidak dapat dinonaktifkan melalui manajemen akun.",
      );
    }

    const account = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: accountSelect,
      });
      if (!current) {
        throw new AdminAccountError("NOT_FOUND", 404, "Akun tidak ditemukan.");
      }
      if (
        !isActive &&
        current.memberships.some(
          (membership) => membership.role === "ADMIN_PUSAT",
        )
      ) {
        throw new AdminAccountError(
          "ADMIN_ACCOUNT_PROTECTED",
          403,
          "Akun Admin Pusat tidak dapat dinonaktifkan melalui manajemen akun.",
        );
      }
      if (current.isActive === isActive) {
        return current;
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive },
        select: accountSelect,
      });
      if (!isActive) {
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now() },
        });
      }
      return updated;
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId: account.memberships?.[0]?.outlet?.id,
      action: isActive ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED",
      resourceType: "User",
      resourceId: userId,
      metadata: { isActive },
    });

    return c.json({ success: true, data: { account: toAccountDto(account) } });
  });

  routes.post("/accounts/:userId/reset-password", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const userId = c.req.param("userId");
    if (!userId || userId.length > 64) {
      throw new AdminAccountError("VALIDATION_ERROR", 400, "ID akun tidak valid.");
    }
    if (userId === auth.userId) {
      throw new AdminAccountError(
        "SELF_PASSWORD_RESET_NOT_ALLOWED",
        409,
        "Gunakan fitur perubahan password pada Profil untuk akun sendiri.",
      );
    }

    const currentAccount = await prisma.user.findUnique({
      where: { id: userId },
      select: accountSelect,
    });
    if (!currentAccount) {
      throw new AdminAccountError("NOT_FOUND", 404, "Akun tidak ditemukan.");
    }
    assertPasswordResetTarget(currentAccount);

    const temporaryPassword = randomBytes(18).toString("base64url");
    const passwordHash = await hashPasswordFn(temporaryPassword);
    const resetAt = now();

    await prisma.$transaction(async (tx) => {
      await requireAdminPusat(tx, auth.userId);
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: accountSelect,
      });
      if (!current) {
        throw new AdminAccountError("NOT_FOUND", 404, "Akun tidak ditemukan.");
      }
      assertPasswordResetTarget(current);

      const sessions = await tx.authSession.findMany({
        where: { userId },
        select: { id: true },
      });
      const sessionIds = sessions.map((session) => session.id);

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      });
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: resetAt },
      });
      if (sessionIds.length > 0) {
        await tx.refreshToken.updateMany({
          where: { sessionId: { in: sessionIds }, revokedAt: null },
          data: { revokedAt: resetAt },
        });
      }
      await tx.userPasswordAudit.create({
        data: {
          actorUserId: auth.userId,
          targetUserId: userId,
          activity: "ADMIN_RESET",
          createdAt: resetAt,
        },
      });
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId: currentAccount.memberships?.[0]?.outlet?.id,
      action: "PASSWORD_RESET",
      resourceType: "User",
      resourceId: userId,
      metadata: { mustChangePassword: true },
    });

    return c.json({
      success: true,
      data: {
        userId,
        temporaryPassword,
        mustChangePassword: true,
      },
    });
  });

  return routes;
}
