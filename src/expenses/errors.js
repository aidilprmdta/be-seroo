export class ExpenseError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ExpenseError";
    this.code = code;
    this.status = status;
  }
}
