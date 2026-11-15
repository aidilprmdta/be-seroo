import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("health endpoint reports liveness without querying the database", async () => {
  const app = createApp({
    prisma: {
      $queryRaw() {
        throw new Error("Liveness must not use the database");
      },
    },
  });

  const response = await app.request("/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { status: "ok" },
  });
});

test("request ID is echoed and honors a valid client correlation ID", async () => {
  const app = createApp({ prisma: {} });
  const response = await app.request("/health", {
    headers: { "x-request-id": "client-request-123" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "client-request-123");
});

test("invalid request ID is replaced with a server-generated correlation ID", async () => {
  const app = createApp({ prisma: {} });
  const response = await app.request("/health", {
    headers: { "x-request-id": "invalid value with spaces" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/i);
});

test("database diagnostics endpoint is not exposed", async () => {
  const app = createApp({
    prisma: {
      async $queryRaw() {},
    },
  });

  const response = await app.request("/db-test");

  assert.equal(response.status, 404);
});

test("readiness endpoint checks database connectivity", async () => {
  let queryCount = 0;
  const app = createApp({
    prisma: {
      async $queryRaw() {
        queryCount += 1;
      },
    },
  });

  const response = await app.request("/health/ready");

  assert.equal(response.status, 200);
  assert.equal(queryCount, 1);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { status: "ready" },
  });
});

test("readiness failure returns a safe 503 and logs no database error message", async () => {
  const logEntries = [];
  const app = createApp({
    prisma: {
      async $queryRaw() {
        throw new Error("sensitive connection details");
      },
    },
    logger: {
      error: (...args) => logEntries.push(args),
    },
  });

  const response = await app.request("/health/ready");
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(body.includes("sensitive connection details"), false);
  assert.deepEqual(logEntries, [["Database readiness check failed", "Error"]]);
});
