// ShiftHandover-specific errors used by backend/src/shift-handover/routes.js
export class PosError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "PosError";
    this.code = code;
    this.status = status;
  }
}
