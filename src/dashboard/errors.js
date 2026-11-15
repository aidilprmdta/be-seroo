export class DashboardError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "DashboardError";
    this.code = code;
    this.status = status;
  }
}

