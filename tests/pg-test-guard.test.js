// pg-test-guard.test.js — Unit test untuk pg-test-guard.js helper.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRaceIterations,
  resolveTestDatabase,
  summarizeTap,
} from "./helpers/pg-test-guard.js";

describe("pg-test-guard", () => {
  describe("resolveTestDatabase", () => {
    it("mengembalikan informasi DB dari TEST_DATABASE_URL yang valid", () => {
      const env = {
        TEST_DATABASE_URL: "postgresql://user:pass@localhost:5432/sero_test",
      };
      const db = resolveTestDatabase(env);
      assert.equal(db.dbName, "sero_test");
      assert.equal(db.host, "localhost");
      assert.equal(db.port, 5432);
      assert.equal(db.user, "user");
    });

    it("menerima postgres:// (tanpa ssl)", () => {
      const env = { TEST_DATABASE_URL: "postgres://u:p@h:5433/db1" };
      const db = resolveTestDatabase(env);
      assert.equal(db.dbName, "db1");
      assert.equal(db.port, 5433);
    });

    it("melempar error jika TEST_DATABASE_URL tidak disetel", () => {
      const env = {};
      assert.throws(() => resolveTestDatabase(env), /TEST_DATABASE_URL tidak disetel/);
    });

    it("melempar error jika URL tidak menggunakan scheme postgres", () => {
      const env = { TEST_DATABASE_URL: "file://tmp/test.db" };
      assert.throws(() => resolveTestDatabase(env), /tidak aman/);
    });

    it("melempar error jika URL tidak valid", () => {
      const env = { TEST_DATABASE_URL: "not-a-url" };
      assert.throws(() => resolveTestDatabase(env), /tidak valid/);
    });
  });

  describe("parseRaceIterations", () => {
    it("mengembalikan 1 jika PG_RACE_ITERATIONS tidak disetel", () => {
      const env = {};
      assert.equal(parseRaceIterations(env), 1);
    });

    it("mengembalikan nilai yang valid", () => {
      const env = { PG_RACE_ITERATIONS: "5" };
      assert.equal(parseRaceIterations(env), 5);
    });

    it("melempar error jika nilai kurang dari 1", () => {
      const env = { PG_RACE_ITERATIONS: "0" };
      assert.throws(() => parseRaceIterations(env), /PG_RACE_ITERATIONS/);
    });

    it("melempar error jika nilai lebih dari 100", () => {
      const env = { PG_RACE_ITERATIONS: "101" };
      assert.throws(() => parseRaceIterations(env), /PG_RACE_ITERATIONS/);
    });

    it("melempar error jika bukan angka", () => {
      const env = { PG_RACE_ITERATIONS: "abc" };
      assert.throws(() => parseRaceIterations(env), /PG_RACE_ITERATIONS/);
    });
  });

  describe("summarizeTap", () => {
    it("menghitung test yang berhasil (ok)", () => {
      const output = "ok 1\nok 2\nok 3\n";
      const summary = summarizeTap(output);
      assert.equal(summary.pass, 3);
      assert.equal(summary.fail, 0);
      assert.equal(summary.skip, 0);
    });

    it("menghitung test yang gagal (not ok)", () => {
      const output = "ok 1\nnot ok 2\nnot ok 3\n";
      const summary = summarizeTap(output);
      assert.equal(summary.pass, 1);
      assert.equal(summary.fail, 2);
    });

    it("menghitung test yang dilewati (skippy)", () => {
      const output = "ok 1\nskippy 2\nskippy 3\nok 4\n";
      const summary = summarizeTap(output);
      assert.equal(summary.pass, 2);
      assert.equal(summary.skip, 2);
    });

    it("menghitung test TODO", () => {
      const output = "todo 1\ntodo 2\n";
      const summary = summarizeTap(output);
      assert.equal(summary.todo, 2);
    });
  });
});
