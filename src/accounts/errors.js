export class AdminAccountError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "AdminAccountError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
