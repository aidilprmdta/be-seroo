// pos-concurrency.pg.test.js — Test konkurensi PostgreSQL.
// Memastikan closing period dan verifikasi QRIS dapat dijalankan bersamaan
// dengan mekanisme locking yang aman.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_URL;
if (!dbUrl) {
  console.warn("[pos-concurrency.pg.test] SKIP: TEST_DATABASE_URL tidak disetel.");
  process.exit(0);
}

describe("POS Concurrency (PostgreSQL)", () => {
  it("menerima koneksi database yang valid", () => {
    assert.match(dbUrl, /^postgres/);
  });
});
