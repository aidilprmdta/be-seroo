export class ClosingError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ClosingError";
    this.code = code;
    this.status = status;
  }
}

