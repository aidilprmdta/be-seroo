import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

test("password hashes use Argon2id and verify without exposing plaintext", async () => {
  const password = "test-only-password";
  const passwordHash = await hashPassword(password);

  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("different-password", passwordHash), false);
  assert.equal(passwordHash.includes(password), false);
});
