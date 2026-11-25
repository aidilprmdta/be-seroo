export class NotificationError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "NotificationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
