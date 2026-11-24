#!/usr/bin/env node
// Menjalankan test PostgreSQL nyata (tests/pos-concurrency.pg.test.js) dan GAGAL bila test tidak
// benar-benar berjalan: tanpa TEST_DATABASE_URL, URL tidak aman, PG_RACE_ITERATIONS tidak valid,
// ada test yang dilewati, atau tidak ada test yang dijalankan.
// (Nama berkas sengaja tidak cocok dengan pola penemuan otomatis `node --test`, jadi `npm test`
// tidak pernah menjalankannya.)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertPgRunSucceeded,
  parseRaceIterations,
  resolveTestDatabase,
  summarizeTap,
} from "../tests/helpers/pg-test-guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = { ...process.env, REQUIRE_PG_TESTS: "1" };

let database;
let iterations;
try {
  database = resolveTestDatabase(env);
  iterations = parseRaceIterations(env);
} catch (error) {
  console.error(`[test:pg] GAGAL: ${error.message}`);
  process.exit(1);
}

console.log(
  `[test:pg] database=${database.dbName} host=${database.host}:${database.port} putaran=${iterations}`,
);

const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", "--test-reporter=tap", "tests/pos-concurrency.pg.test.js"],
  { cwd: root, env: { ...env, PG_RACE_ITERATIONS: String(iterations) }, stdio: ["ignore", "pipe", "inherit"] },
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

child.on("error", (error) => {
  console.error(`[test:pg] GAGAL: tidak dapat menjalankan test (${error.message}).`);
  process.exit(1);
});

child.on("close", (code) => {
  const summary = summarizeTap(output);
  const problem = assertPgRunSucceeded(summary, code ?? 1);
  if (problem) {
    console.error(`[test:pg] GAGAL: ${problem}`);
    process.exit(code || 1);
  }
  console.log(`[test:pg] LULUS: ${summary.pass} test, 0 dilewati, 0 gagal (putaran race=${iterations}).`);
});
