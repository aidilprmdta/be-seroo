export class AuditError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "AuditError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function auditNotFound() {
  return new AuditError("NOT_FOUND", 404, "Catatan audit tidak ditemukan.");
}
