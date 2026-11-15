import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { DashboardError } from "./errors.js";
import { getDashboardData } from "./service.js";

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new DashboardError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireMembership(prisma, userId, outletId, allowedRoles) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });

  if (
    !membership ||
    !membership.outlet?.isActive ||
    !allowedRoles.includes(membership.role)
  ) {
    throw new DashboardError(
      "FORBIDDEN",
      403,
      "Akses ke dashboard outlet ini tidak diizinkan.",
    );
  }

  return membership.role;
}

export function createDashboardRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/:outletId/dashboard", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const data = await getDashboardData({
      prisma,
      outletId,
      now: now(),
    });

    return c.json({
      success: true,
      data,
    });
  });

  return routes;
}

