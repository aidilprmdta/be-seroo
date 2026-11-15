export class CatalogAdminError extends Error {
  constructor(code, statusCode, message, details) {
    super(message);
    this.name = "CatalogAdminError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

