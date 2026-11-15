const SENSITIVE_KEY = /(password|token|secret|authorization|cookie|credential|hash|api.?key)/i;
const MAX_STRING_LENGTH = 500;
const MAX_KEYS = 50;

function redact(value, depth = 0) {
  if (depth > 4) return "[REDACTED_DEPTH]";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_KEYS)
        .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1)]),
    );
  }
  return String(value);
}

export function sanitizeAuditMetadata(metadata) {
  if (metadata === undefined) return undefined;
  return redact(metadata);
}

export async function writeAuditLog(prisma, data) {
  if (!prisma.auditLog?.create) return null;
  return prisma.auditLog.create({
    data: {
      actorUserId: data.actorUserId ?? null,
      sessionId: data.sessionId ?? null,
      outletId: data.outletId ?? null,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId ?? null,
      outcome: data.outcome ?? "SUCCESS",
      metadata: sanitizeAuditMetadata(data.metadata),
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
}
