import { Hono } from "hono";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { writeAuditLog } from "../audit/service.js";
import { ReportError } from "./errors.js";
import {
  getDailyReport,
  getMonthlyReport,
  getTodayInJakarta,
  getCurrentMonthInJakarta,
} from "./service.js";
import { generateReportCsv, generateReportHtml, generateReportPdf, generateReportXlsx } from "./export.js";

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new ReportError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
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
    throw new ReportError(
      "FORBIDDEN",
      403,
      "Akses ke laporan outlet ini tidak diizinkan.",
    );
  }

  return membership.role;
}

export function createReportRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/:outletId/reports/daily", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const dateStr = c.req.query("date");
    const report = await getDailyReport({ prisma, outletId, dateStr, now: now() });

    return c.json({
      success: true,
      data: report,
    });
  });

  routes.get("/:outletId/reports/monthly", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const monthStr = c.req.query("month");
    const report = await getMonthlyReport({ prisma, outletId, monthStr, now: now() });

    return c.json({
      success: true,
      data: report,
    });
  });

  // Export CSV (Excel compatible)
  routes.get("/:outletId/reports/export/csv", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const type = c.req.query("type") || "DAILY";
    const periodKey =
      c.req.query("periodKey") ||
      (type === "DAILY" ? c.req.query("date") : c.req.query("month"));

    const [outlet, report, closing] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: outletId } }),
      type === "DAILY"
        ? getDailyReport({ prisma, outletId, dateStr: periodKey, now: now() })
        : getMonthlyReport({ prisma, outletId, monthStr: periodKey, now: now() }),
      prisma.closingRecord.findUnique({
        where: {
          outletId_closingType_periodKey: {
            outletId,
            closingType: type,
            periodKey:
              periodKey ||
              (type === "DAILY"
                ? getTodayInJakarta(now())
                : getCurrentMonthInJakarta(now())),
          },
        },
        include: { closedBy: { select: { id: true, name: true } } },
      }),
    ]);

    const csvContent = generateReportCsv({
      report,
      outlet,
      closingRecord: closing,
    });
    const filename = `laporan-${outlet?.code || outletId}-${report.period.type.toLowerCase()}-${report.period.date || report.period.month}.csv`;

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "REPORT_EXPORTED",
      resourceType: "Report",
      metadata: {
        format: "CSV",
        reportType: report.period.type,
        periodKey: report.period.date || report.period.month,
      },
    });

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  // Export HTML / Printable PDF
  routes.get("/:outletId/reports/export/html", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const type = c.req.query("type") || "DAILY";
    const periodKey =
      c.req.query("periodKey") ||
      (type === "DAILY" ? c.req.query("date") : c.req.query("month"));

    const [outlet, report, closing] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: outletId } }),
      type === "DAILY"
        ? getDailyReport({ prisma, outletId, dateStr: periodKey, now: now() })
        : getMonthlyReport({ prisma, outletId, monthStr: periodKey, now: now() }),
      prisma.closingRecord.findUnique({
        where: {
          outletId_closingType_periodKey: {
            outletId,
            closingType: type,
            periodKey:
              periodKey ||
              (type === "DAILY"
                ? getTodayInJakarta(now())
                : getCurrentMonthInJakarta(now())),
          },
        },
        include: { closedBy: { select: { id: true, name: true } } },
      }),
    ]);

    const htmlContent = generateReportHtml({
      report,
      outlet,
      closingRecord: closing,
    });

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "REPORT_EXPORTED",
      resourceType: "Report",
      metadata: {
        format: "HTML",
        reportType: report.period.type,
        periodKey: report.period.date || report.period.month,
      },
    });

    return new Response(htmlContent, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  });

  // Export PDF / XLSX (SRS KF-15). Tanpa dependency: PDF generator minimal,
  // XLSX memakai SpreadsheetML 2003 yang dibuka Excel sebagai .xls.
  routes.get("/:outletId/reports/export/:format", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    const format = (c.req.param("format") || "").toUpperCase();
    if (!["PDF", "XLSX", "XLS"].includes(format)) {
      throw new ReportError("VALIDATION_ERROR", 400, "Format ekspor tidak didukung (PDF atau XLSX).");
    }
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireMembership(prisma, auth.userId, outletId, [
      "MANAGER",
      "OWNER",
      "OWNER_MITRA",
      "ADMIN_PUSAT",
    ]);

    const type = c.req.query("type") || "DAILY";
    const periodKey =
      c.req.query("periodKey") ||
      (type === "DAILY" ? c.req.query("date") : c.req.query("month"));

    const [outlet, report, closing] = await Promise.all([
      prisma.outlet.findUnique({ where: { id: outletId } }),
      type === "DAILY"
        ? getDailyReport({ prisma, outletId, dateStr: periodKey, now: now() })
        : getMonthlyReport({ prisma, outletId, monthStr: periodKey, now: now() }),
      prisma.closingRecord.findUnique({
        where: {
          outletId_closingType_periodKey: {
            outletId,
            closingType: type,
            periodKey:
              periodKey ||
              (type === "DAILY"
                ? getTodayInJakarta(now())
                : getCurrentMonthInJakarta(now())),
          },
        },
        include: { closedBy: { select: { id: true, name: true } } },
      }),
    ]);

    const periodLabel = report.period.date || report.period.month;
    const baseName = `laporan-${outlet?.code || outletId}-${report.period.type.toLowerCase()}-${periodLabel}`;
    const input = { report, outlet, closingRecord: closing };

    await writeAuditLog(prisma, {
      actorUserId: auth.userId,
      sessionId: auth.sessionId,
      outletId,
      action: "REPORT_EXPORTED",
      resourceType: "Report",
      metadata: {
        format,
        reportType: report.period.type,
        periodKey: periodLabel,
      },
    });

    if (format === "PDF") {
      return new Response(generateReportPdf(input), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        },
      });
    }

    return new Response(generateReportXlsx(input), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.xls"`,
      },
    });
  });

  return routes;
}
