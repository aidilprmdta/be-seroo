export class InventoryError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.status = status;
  }
}
