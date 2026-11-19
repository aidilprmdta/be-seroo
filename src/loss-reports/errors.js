export class LossReportError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "LossReportError";
    this.code = code;
    this.status = status;
  }
}
