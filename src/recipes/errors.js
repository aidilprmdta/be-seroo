export class RecipeError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "RecipeError";
    this.code = code;
    this.status = status;
  }
}

