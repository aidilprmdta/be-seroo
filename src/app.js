import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuthRoutes } from "./auth/routes.js";
import { AuthError } from "./auth/errors.js";
import { PosError } from "./pos/errors.js";
import { createPosRoutes } from "./pos/routes.js";
import { InventoryError } from "./inventory/errors.js";
import { createInventoryRoutes } from "./inventory/routes.js";
import { ExpenseError } from "./expenses/errors.js";
import { createExpenseRoutes } from "./expenses/routes.js";
import { ReportError } from "./reports/errors.js";
import { createReportRoutes } from "./reports/routes.js";
import { ClosingError } from "./closings/errors.js";
import { createClosingRoutes } from "./closings/routes.js";
import { DashboardError } from "./dashboard/errors.js";
import { createDashboardRoutes } from "./dashboard/routes.js";
import { CatalogAdminError } from "./catalog/errors.js";
import { createCatalogAdminRoutes } from "./catalog/routes.js";
import { OutletAccessError } from "./outlets/accessErrors.js";
import { createOutletAccessRoutes } from "./outlets/accessRoutes.js";
import { createOutletAdminRoutes, OutletAdminError } from "./outlets/adminRoutes.js";
import { AdminAccountError } from "./accounts/errors.js";
import { createAdminAccountRoutes } from "./accounts/adminRoutes.js";
import { AuditError } from "./audit/errors.js";
import { createAuditRoutes } from "./audit/routes.js";
import { OutletAvailabilityError } from "./catalog/availabilityErrors.js";
import { createCatalogAvailabilityRoutes } from "./catalog/availabilityRoutes.js";
import { LossReportError } from "./loss-reports/errors.js";
import { createLossReportRoutes } from "./loss-reports/routes.js";

export function createApp({
  prisma,
  logger = console,
  authConfig,
  authOptions = {},
  posOptions = {},
  inventoryOptions = {},
  expenseOptions = {},
  reportOptions = {},
  closingOptions = {},
  dashboardOptions = {},
  catalogOptions = {},
  outletAccessOptions = {},
  adminAccountOptions = {},
  auditOptions = {},
  catalogAvailabilityOptions = {},
  lossReportOptions = {},
  corsOrigins = [],
}) {
  const app = new Hono();
  const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && requestIdPattern.test(incoming)
      ? incoming
      : randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    const startedAt = Date.now();
    await next();
    logger.info?.("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  });

  if (corsOrigins.length > 0) {
    app.use("*", cors({
      origin: (origin) => corsOrigins.includes(origin) ? origin : undefined,
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: ["X-Request-ID"],
    }));
  }

  const healthHandler = (c) =>
    c.json({
      success: true,
      data: {
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });

  app.get("/health", healthHandler);
  app.get("/healthz", healthHandler);

  const readyHandler = async (c) => {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const dbLatencyMs = Date.now() - start;

      return c.json({
        success: true,
        data: {
          status: "ready",
          db: "connected",
          dbLatencyMs,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error(
        "Database readiness check failed",
        error instanceof Error ? error.name : "UnknownError",
      );

      return c.json(
        {
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Service is not ready",
          },
        },
        503,
      );
    }
  };

  app.get("/health/ready", readyHandler);
  app.get("/readyz", readyHandler);

  if (authConfig) {
    app.route(
      "/api/v1/auth",
      createAuthRoutes({ prisma, authConfig, ...authOptions }),
    );
    app.route(
      "/api/v1/outlets",
      createPosRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...posOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createInventoryRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...inventoryOptions,
      }),
    );
    app.route(
      "/api/v1",
      createExpenseRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...expenseOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createReportRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...reportOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createClosingRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...closingOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createDashboardRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...dashboardOptions,
      }),
    );
    app.route(
      "/api/v1/admin/catalog",
      createCatalogAdminRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...catalogOptions,
      }),
    );
    app.route(
      "/api/v1/admin",
      createAdminAccountRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...adminAccountOptions,
      }),
    );
    app.route(
      "/api/v1/admin",
      createOutletAdminRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createOutletAccessRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...outletAccessOptions,
      }),
    );
    app.route(
      "/api/v1/admin",
      createAuditRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...auditOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createCatalogAvailabilityRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...catalogAvailabilityOptions,
      }),
    );
    app.route(
      "/api/v1/outlets",
      createLossReportRoutes({
        prisma,
        accessTokenSecret: authConfig.accessTokenSecret,
        ...lossReportOptions,
      }),
    );
  } // Tutup if (authConfig)

  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Endpoint tidak ditemukan.",
        },
      },
      404,
    ),
  );

  app.onError((error, c) => {
    if (
      error instanceof AuthError ||
      error instanceof PosError ||
      error instanceof InventoryError ||
      error instanceof ExpenseError ||
      error instanceof ReportError ||
      error instanceof ClosingError ||
      error instanceof DashboardError ||
      error instanceof CatalogAdminError ||
      error instanceof OutletAccessError ||
      error instanceof OutletAdminError ||
      error instanceof AdminAccountError ||
      error instanceof AuditError ||
      error instanceof OutletAvailabilityError ||
      error instanceof LossReportError
    ) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            requestId: c.get("requestId"),
          },
        },
        error.statusCode || error.status || 400,
      );
    }

    logger.error(
      "Request failed",
      error instanceof Error ? error.name : "UnknownError",
    );

    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Terjadi kesalahan pada server.",
          requestId: c.get("requestId"),
        },
      },
      500,
    );
  });

  return app;
}