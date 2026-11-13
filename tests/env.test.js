import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "../src/config/env.js";

test("uses local defaults and accepts a PostgreSQL URL", () => {
  assert.deepEqual(
    parseEnv({
      DATABASE_URL: "postgresql://user:password@localhost:5432/sero_test",
      JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
    }),
    {
      NODE_ENV: "development",
      PORT: 3000,
      DATABASE_URL: "postgresql://user:password@localhost:5432/sero_test",
      JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
    },
  );
});

test("coerces and validates the configured port", () => {
  assert.equal(
    parseEnv({
      DATABASE_URL: "postgres://user:password@localhost:5432/sero_test",
      PORT: "4100",
      JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
    }).PORT,
    4100,
  );

  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "postgres://user:password@localhost:5432/sero_test",
        PORT: "70000",
        JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
      }),
    { message: "Invalid environment configuration: PORT" },
  );
});

test("rejects missing and non-PostgreSQL database URLs without echoing values", () => {
  assert.throws(() => parseEnv({}), {
    message: "Invalid environment configuration: DATABASE_URL, JWT_ACCESS_SECRET",
  });

  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "https://example.invalid/credentials",
        JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
      }),
    { message: "Invalid environment configuration: DATABASE_URL" },
  );
});
