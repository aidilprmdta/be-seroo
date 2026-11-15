export class ReportError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ReportError";
    this.code = code;
    this.status = status;
  }
}

