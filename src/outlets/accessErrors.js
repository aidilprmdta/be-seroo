export class OutletAccessError extends Error {
  constructor(code, statusCode, message, details) {
    super(message);
    this.name = "OutletAccessError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

