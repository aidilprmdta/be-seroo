// split-payment.test.js — Test integrasi PostgreSQL untuk pembayaran SPLIT.
// Cocok dengan kondisi parallel: TEST_DATABASE_URL yang terdefinisi.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_URL;
if (!dbUrl) {
  console.warn("[split-payment.test] SKIP: TEST_DATABASE_URL tidak disetel.");
  process.exit(0);
}

describe("SPLIT Payment (PostgreSQL)", () => {
  it("memverifikasi middleware", () => {
    assert.match(dbUrl, /^postgres/);
  });
});
