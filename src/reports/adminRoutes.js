import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { ReportError } from "./errors.js";
import { getMonthlyRange } from "./service.js";

async function requireAdminPusat(prisma, userId) {
  const membership = await prisma.outletMembership.findFirst({
    where: { userId, role: "ADMIN_PUSAT" },
    select: { id: true },
  });
  if (!membership) {
    throw new ReportError(
      "FORBIDDEN",
      403,
      "Hanya Admin Pusat yang dapat melihat agregasi penjualan pusat.",
    );
  }
}

export function createAdminReportRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/outlets", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);

    const { start, end, monthStr } = getMonthlyRange(c.req.query("month"));

    const outlets = await prisma.outlet.findMany({
      where: { ownershipType: "PUSAT", isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });

    let grouped = [];
    if (outlets.length > 0) {
      grouped = await prisma.order.groupBy({
        by: ["outletId"],
        where: {
          outletId: { in: outlets.map((outlet) => outlet.id) },
          status: "COMPLETED",
          createdAt: { gte: start, lt: end },
        },
        _sum: { total: true },
        _count: { _all: true },
      });
    }

    const byOutletId = new Map(grouped.map((row) => [row.outletId, row]));
    let totalIncome = new Prisma.Decimal("0.00");
    let transactionCount = 0;

    const dataOutlets = outlets.map((outlet) => {
      const row = byOutletId.get(outlet.id);
      const income = new Prisma.Decimal(
        row?._sum?.total?.toString() ?? "0.00",
      );
      const count = row?._count?._all ?? 0;
      totalIncome = totalIncome.add(income);
      transactionCount += count;
      return {
        outletId: outlet.id,
        code: outlet.code,
        name: outlet.name,
        totalIncome: income.toFixed(2),
        transactionCount: count,
      };
    });

    return c.json({
      success: true,
      data: {
        period: {
          type: "MONTHLY",
          month: monthStr,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          timezone: "Asia/Jakarta",
        },
        outlets: dataOutlets,
        totalIncome: totalIncome.toFixed(2),
        transactionCount,
      },
    });
  });

  return routes;
}
