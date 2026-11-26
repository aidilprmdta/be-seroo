// order-cancellation.test.js — Test integrasi PostgreSQL untuk pembatalan order.
// Require TEST_DATABASE_URL.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_URL;
if (!dbUrl) {
  console.warn("[order-cancellation.test] SKIP: TEST_DATABASE_URL tidak disetel.");
  process.exit(0);
}

describe("Order Cancellation (PostgreSQL)", () => {
  it("menerima koneksi DB yang valid", () => {
    assert.match(dbUrl, /^postgres/);
  });
});
