import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { AuditError } from "./errors.js";
import { sanitizeAuditMetadata } from "./service.js";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().min(1).max(80).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  outletId: z.string().trim().min(1).max(64).optional(),
}).strict();

async function requireAdminPusat(prisma, userId) {
  const membership = await prisma.outletMembership.findFirst({
    where: { userId, role: "ADMIN_PUSAT" },
    select: { id: true },
  });
  if (!membership) {
    throw new AuditError("FORBIDDEN", 403, "Hanya Admin Pusat yang dapat melihat audit.");
  }
}

function parseQuery(c) {
  const result = querySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
    action: c.req.query("action"),
    resourceType: c.req.query("resourceType"),
    outletId: c.req.query("outletId"),
  });
  if (!result.success) {
    throw new AuditError("VALIDATION_ERROR", 400, "Filter audit tidak valid.");
  }
  return result.data;
}

function auditDto(entry) {
  return {
    id: entry.id,
    actor: entry.actor
      ? { id: entry.actor.id, name: entry.actor.name, email: entry.actor.email }
      : null,
    sessionId: entry.sessionId,
    outletId: entry.outletId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    outcome: entry.outcome,
    metadata: entry.metadata,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function createAuditRoutes({ prisma, accessTokenSecret, now = () => new Date(), authenticationMiddleware }) {
  const routes = new Hono();
  const authenticate = authenticationMiddleware ?? createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/audit-logs", authenticate, async (c) => {
    const auth = c.get("auth");
    await requireAdminPusat(prisma, auth.userId);
    const query = parseQuery(c);
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.outletId ? { outletId: query.outletId } : {}),
    };
    const entries = await prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return c.json({
      success: true,
      data: {
        auditLogs: entries.map(auditDto),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          hasNextPage: entries.length === query.pageSize,
        },
      },
    });
  });

  return routes;
}

const MANAGER_SENSITIVE_KEY = /(email|phone|telepon|whatsapp)/i;
const MANAGER_EXCLUDED_ACTIONS = [
  "ACCOUNT_ACTIVATED",
  "ACCOUNT_DEACTIVATED",
  "PASSWORD_RESET",
];

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const managerQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    action: z.string().trim().min(1).max(80).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    actorUserId: z.string().trim().min(1).max(64).optional(),
    outcome: z.enum(["SUCCESS", "FAILURE"]).optional(),
    from: z.string().regex(DATE_KEY_REGEX).optional(),
    to: z.string().regex(DATE_KEY_REGEX).optional(),
  })
  .strict();

function assertOutletId(outletId) {
  if (!outletId || outletId.length > 64) {
    throw new AuditError("VALIDATION_ERROR", 400, "Outlet tidak valid.");
  }
}

async function requireManagerMembership(prisma, userId, outletId) {
  const membership = await prisma.outletMembership.findUnique({
    where: { userId_outletId: { userId, outletId } },
    include: { outlet: { select: { isActive: true } } },
  });
  if (
    !membership ||
    !membership.outlet?.isActive ||
    membership.role !== "MANAGER"
  ) {
    throw new AuditError(
      "FORBIDDEN",
      403,
      "Hanya Manager outlet ini yang dapat melihat audit.",
    );
  }
}

function parseManagerQuery(c) {
  const result = managerQuerySchema.safeParse(c.req.query());
  if (!result.success) {
    throw new AuditError("VALIDATION_ERROR", 400, "Filter audit tidak valid.");
  }
  return result.data;
}

const JAKARTA_DATE_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function jakartaDayStart(dateKey) {
  const value = new Date(`${dateKey}T00:00:00.000+07:00`);
  if (Number.isNaN(value.getTime())) return null;
  if (JAKARTA_DATE_KEY_FORMAT.format(value) !== dateKey) return null;
  return value;
}

function buildManagerWhere(outletId, query) {
  const where = { outletId, action: { notIn: MANAGER_EXCLUDED_ACTIONS } };
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.actorUserId) where.actorUserId = query.actorUserId;
  if (query.outcome) where.outcome = query.outcome;

  const from = query.from ? jakartaDayStart(query.from) : null;
  const to = query.to ? jakartaDayStart(query.to) : null;
  if ((query.from && !from) || (query.to && !to)) {
    throw new AuditError(
      "VALIDATION_ERROR",
      400,
      "Rentang tanggal audit tidak valid.",
    );
  }
  if (from && to && from.getTime() >= to.getTime()) {
    throw new AuditError(
      "VALIDATION_ERROR",
      400,
      "Rentang tanggal audit tidak valid.",
    );
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {}),
    };
  }

  return where;
}

function managerAuditDto(entry) {
  return {
    id: entry.id,
    actor: entry.actor ? { id: entry.actor.id, name: entry.actor.name } : null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    outcome: entry.outcome,
    metadata: sanitizeAuditMetadata(entry.metadata, {
      extraKeyPattern: MANAGER_SENSITIVE_KEY,
    }),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function createManagerAuditRoutes({
  prisma,
  accessTokenSecret,
  now = () => new Date(),
  authenticationMiddleware,
}) {
  const routes = new Hono();
  const authenticate =
    authenticationMiddleware ??
    createAuthenticationMiddleware({ prisma, accessTokenSecret, now });

  routes.get("/:outletId/audit-logs", authenticate, async (c) => {
    const outletId = c.req.param("outletId");
    assertOutletId(outletId);
    const auth = c.get("auth");
    await requireManagerMembership(prisma, auth.userId, outletId);

    const query = parseManagerQuery(c);
    if (query.action && MANAGER_EXCLUDED_ACTIONS.includes(query.action)) {
      return c.json({
        success: true,
        data: {
          outletId,
          auditLogs: [],
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            hasNextPage: false,
          },
        },
      });
    }
    const where = buildManagerWhere(outletId, query);
    const entries = await prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize + 1,
    });

    const hasNextPage = entries.length > query.pageSize;
    const pageEntries = hasNextPage
      ? entries.slice(0, query.pageSize)
      : entries;

    return c.json({
      success: true,
      data: {
        outletId,
        auditLogs: pageEntries.map(managerAuditDto),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          hasNextPage,
        },
      },
    });
  });

  return routes;
}
