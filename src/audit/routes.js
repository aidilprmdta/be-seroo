import { Hono } from "hono";
import { z } from "zod";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import { AuditError } from "./errors.js";

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
