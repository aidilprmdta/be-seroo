import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { OutletAccessError } from "./accessErrors.js";

const protectedMembershipRoles = ["OWNER_MITRA", "OWNER", "ADMIN_PUSAT"];

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new OutletAccessError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireOutletOwnerOrAdmin(prisma, userId, outletId) {
  // Check if user is ADMIN_PUSAT
  const adminMembership = await prisma.outletMembership.findFirst({
    where: { userId, role: "ADMIN_PUSAT" },
  });
  if (adminMembership) {
    return "ADMIN_PUSAT";
  }

  // Check if user is OWNER_MITRA / OWNER of this specific outlet
  const ownerMembership = await prisma.outletMembership.findUnique({
    where: {
      userId_outletId: { userId, outletId },
    },
    include: {
      outlet: { select: { isActive: true } },
    },
  });

  if (
    !ownerMembership ||
    !ownerMembership.outlet?.isActive ||
    !["OWNER_MITRA", "OWNER"].includes(ownerMembership.role)
  ) {
    throw new OutletAccessError(
      "FORBIDDEN",
      403,
      "Hanya Owner Mitra dari outlet ini atau Admin Pusat yang berwenang mengelola akses staf.",
    );
  }

  return ownerMembership.role;
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new OutletAccessError("VALIDATION_ERROR", 400, "Format JSON tidak valid.");
    }
    throw error;
  }
}

export function createOutletAccessRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  // List outlets available to the authenticated user.
  routes.get("/", authenticate, async (c) => {
    const auth = c.get("auth");
    const adminMembership = await prisma.outletMembership.findFirst({
      where: { userId: auth.userId, role: "ADMIN_PUSAT" },
      select: { id: true },
    });

    let outlets;
    if (adminMembership) {
      outlets = await prisma.outlet.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          address: true,
          isActive: true,
        },
      });
    } else {
      const memberships = await prisma.outletMembership.findMany({
        where: {
          userId: auth.userId,
          outlet: { isActive: true },
        },
        orderBy: { outlet: { name: "asc" } },
        select: {
          role: true,
          outlet: {
            select: {
              id: true,
              code: true,
              name: true,
              address: true,
              isActive: true,
            },
          },
        },
      });
      outlets = memberships.map((membership) => ({
        ...membership.outlet,
        role: membership.role,
      }));
    }

    return c.json({
      success: true,
      data: { outlets },
    });
  });

  // Get one outlet only when it is inside the authenticated user's scope.
  routes.get("/:outletId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");

    const adminMembership = await prisma.outletMembership.findFirst({
      where: { userId: auth.userId, role: "ADMIN_PUSAT" },
      select: { id: true },
    });

    let outlet;
    let role;
    if (adminMembership) {
      outlet = await prisma.outlet.findUnique({
        where: { id: outletId },
        select: {
          id: true,
          code: true,
          name: true,
          address: true,
          isActive: true,
        },
      });
    } else {
      const membership = await prisma.outletMembership.findUnique({
        where: { userId_outletId: { userId: auth.userId, outletId } },
        include: {
          outlet: {
            select: {
              id: true,
              code: true,
              name: true,
              address: true,
              isActive: true,
            },
          },
        },
      });
      if (membership?.outlet?.isActive) {
        outlet = membership.outlet;
        role = membership.role;
      }
    }

    if (!outlet || !outlet.isActive) {
      throw new OutletAccessError("NOT_FOUND", 404, "Outlet tidak ditemukan.");
    }

    return c.json({
      success: true,
      data: {
        outlet: {
          ...outlet,
          ...(role ? { role } : {}),
        },
      },
    });
  });

  // List members of outlet
  routes.get("/:outletId/members", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireOutletOwnerOrAdmin(prisma, auth.userId, outletId);

    const memberships = await prisma.outletMembership.findMany({
      where: { outletId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return c.json({
      success: true,
      data: {
        outletId,
        members: memberships.map((m) => ({
          membershipId: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          isActive: m.user.isActive,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    });
  });

  // Assign user to outlet
  routes.post("/:outletId/members", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    const callerRole = await requireOutletOwnerOrAdmin(prisma, auth.userId, outletId);

    const body = await readJson(c);
    const { email, userId, role } = body;

    const allowedRoles = ["CREW", "MANAGER"];
    if (callerRole === "ADMIN_PUSAT") {
      allowedRoles.push("OWNER_MITRA", "OWNER");
    }

    if (!role || !allowedRoles.includes(role)) {
      throw new OutletAccessError(
        "VALIDATION_ERROR",
        400,
        callerRole === "ADMIN_PUSAT"
          ? "Role harus berupa CREW, MANAGER, atau OWNER_MITRA."
          : "Owner Mitra hanya dapat menugaskan role CREW atau MANAGER di outlet miliknya.",
      );
    }

    let user;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    }

    if (!user) {
      throw new OutletAccessError("NOT_FOUND", 404, "Pengguna tidak ditemukan.");
    }

    const existingMembership = await prisma.outletMembership.findUnique({
      where: {
        userId_outletId: { userId: user.id, outletId },
      },
    });

    if (
      callerRole !== "ADMIN_PUSAT" &&
      existingMembership &&
      protectedMembershipRoles.includes(existingMembership.role)
    ) {
      throw new OutletAccessError(
        "FORBIDDEN",
        403,
        "Owner Mitra tidak dapat mengubah role atau mencabut akses akun Owner atau Admin Pusat.",
      );
    }

    const membership = await prisma.outletMembership.upsert({
      where: {
        userId_outletId: { userId: user.id, outletId },
      },
      update: { role },
      create: {
        userId: user.id,
        outletId,
        role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return c.json(
      {
        success: true,
        data: {
          membership: {
            membershipId: membership.id,
            userId: membership.user.id,
            name: membership.user.name,
            email: membership.user.email,
            role: membership.role,
          },
        },
      },
      201,
    );
  });

  // Revoke user membership from outlet
  routes.delete("/:outletId/members/:userId", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const targetUserId = c.req.param("userId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    const callerRole = await requireOutletOwnerOrAdmin(prisma, auth.userId, outletId);

    const existing = await prisma.outletMembership.findUnique({
      where: {
        userId_outletId: { userId: targetUserId, outletId },
      },
    });

    if (!existing) {
      throw new OutletAccessError("NOT_FOUND", 404, "Keanggotaan staf tidak ditemukan di outlet ini.");
    }

    if (protectedMembershipRoles.includes(existing.role) && callerRole !== "ADMIN_PUSAT") {
      throw new OutletAccessError(
        "FORBIDDEN",
        403,
        "Owner Mitra tidak dapat mengubah role atau mencabut akses akun Owner atau Admin Pusat.",
      );
    }

    await prisma.outletMembership.delete({
      where: {
        userId_outletId: { userId: targetUserId, outletId },
      },
    });

    return c.json({
      success: true,
      data: { message: "Akses staf berhasil dicabut dari outlet." },
    });
  });

  return routes;
}

