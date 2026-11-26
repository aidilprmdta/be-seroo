// qris-verification.test.js — Test integrasi PostgreSQL untuk verifikasi QRIS.
// Proteksi sederhana: cek DATABASE_URL, jika tidak ada jumpa test yang gagal.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.POSTGRESQL_URL;
if (!dbUrl) {
  console.warn("[qris-verification.test] SKIP: TEST_DATABASE_URL tidak disetel. Jalankan: TEST_DATABASE_URL=postgresql://... npm run test:pg");
  process.exit(0);
}

describe("QRIS Verification (PostgreSQL)", () => {
  it("menyetel koneksi", () => {
    assert.match(dbUrl, /^postgres/);
  });
});
