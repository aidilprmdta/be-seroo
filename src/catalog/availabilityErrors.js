export class OutletAvailabilityError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "OutletAvailabilityError";
    this.code = code;
    this.status = status;
  }
}
