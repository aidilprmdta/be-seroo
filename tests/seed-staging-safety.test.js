import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeDatabaseForSeed,
  verifyDatabaseIdentity,
  parseApprovedStagingPairs,
} from "../prisma/seed-e2e.js";

test("1. Exact hostname dan database pair staging diizinkan", () => {
  const result = assertSafeDatabaseForSeed(
    "postgresql://user:pass@staging-db.seroo.id:5432/seroo_staging",
    {
      DEPLOYMENT_ENV: "staging",
      ALLOW_STAGING_SEED: "true",
    },
  );
  assert.equal(result.isStaging, true);
  assert.equal(result.host, "staging-db.seroo.id");
  assert.equal(result.db, "seroo_staging");

  const resultInternal = assertSafeDatabaseForSeed(
    "postgresql://user:pass@seroo-staging.internal:5432/seroo_staging",
    {
      DEPLOYMENT_ENV: "staging",
      ALLOW_STAGING_SEED: "true",
    },
  );
  assert.equal(resultInternal.isStaging, true);
});

test("2. Hostname benar dengan database yang salah ditolak", () => {
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@staging-db.seroo.id:5432/wrong_staging_db",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*Database name \(wrong_staging_db\) bukan target yang sah/,
  );
});

test("3. Database benar dengan hostname yang salah ditolak", () => {
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@unauthorized-cloud-host.com:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*Host database \(unauthorized-cloud-host\.com\) tidak terdaftar/,
  );
});

test("4. Hostname wildcard yang tidak terdaftar ditolak", () => {
  // Tidak ada wildcard bypass: *.internal atau *.staging.seroo.id yang acak harus ditolak
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@random-node.staging.seroo.id:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*tidak terdaftar dalam allowlist staging/,
  );

  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@arbitrary-cluster.internal:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*tidak terdaftar dalam allowlist staging/,
  );
});

test("5. Database yang hanya mengandung substring test ditolak jika bukan exact pair", () => {
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@staging-db.seroo.id:5432/my_arbitrary_test_db",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*bukan target yang sah untuk host staging/,
  );
});

test("6. Localhost pada staging ditolak kecuali ada pasangan explicit yang memang diizinkan", () => {
  // Tanpa explicit pair: localhost pada DEPLOYMENT_ENV=staging ditolak
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@localhost:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*tidak terdaftar dalam allowlist staging/,
  );

  // Dengan explicit pair yang diset di STAGING_TARGET_PAIRS
  const explicitResult = assertSafeDatabaseForSeed(
    "postgresql://user:pass@localhost:5432/seroo_staging_local",
    {
      DEPLOYMENT_ENV: "staging",
      ALLOW_STAGING_SEED: "true",
      STAGING_TARGET_PAIRS: "localhost:seroo_staging_local",
    },
  );
  assert.equal(explicitResult.isStaging, true);
  assert.equal(explicitResult.host, "localhost");
  assert.equal(explicitResult.db, "seroo_staging_local");
});

test("7. Localhost pada development tetap berfungsi normal", () => {
  const result = assertSafeDatabaseForSeed(
    "postgresql://postgres:postgres@localhost:5432/seroo_dev",
    {
      DEPLOYMENT_ENV: "development",
    },
  );
  assert.equal(result.isStaging, false);
  assert.equal(result.isLocal, true);
  assert.equal(result.db, "seroo_dev");

  const resultDefault = assertSafeDatabaseForSeed(
    "postgresql://postgres:postgres@127.0.0.1:5432/seroo_dev",
    {},
  );
  assert.equal(resultDefault.isLocal, true);
});

test("8. PostgreSQL connection failure menghentikan seed (Fail-Closed)", async () => {
  const mockPrismaOffline = {
    $queryRaw: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    },
  };

  await assert.rejects(
    async () => {
      await verifyDatabaseIdentity(mockPrismaOffline, {
        host: "localhost",
        db: "seroo_dev",
      });
    },
    /PENGAMAN DATABASE \(FAIL-CLOSED\): Gagal memverifikasi identitas PostgreSQL/,
  );
});

test("9. Database identity mismatch menghentikan seed", async () => {
  const mockPrismaMismatch = {
    $queryRaw: async () => [
      { db_name: "seroo_actual_production", user_name: "postgres", server_ip: "10.0.0.1" },
    ],
  };

  await assert.rejects(
    async () => {
      await verifyDatabaseIdentity(mockPrismaMismatch, {
        host: "staging-db.seroo.id",
        db: "seroo_staging",
      });
    },
    /PENGAMAN DATABASE \(FAIL-CLOSED\):.*terdeteksi sebagai database production/,
  );

  const mockPrismaDifferentDb = {
    $queryRaw: async () => [
      { db_name: "other_database", user_name: "postgres", server_ip: "10.0.0.1" },
    ],
  };

  await assert.rejects(
    async () => {
      await verifyDatabaseIdentity(mockPrismaDifferentDb, {
        host: "staging-db.seroo.id",
        db: "seroo_staging",
      });
    },
    /PENGAMAN DATABASE \(FAIL-CLOSED\): Identitas database aktual \(other_database\) tidak cocok/,
  );
});

test("10. Tidak ada operasi penulisan sebelum identity validation selesai", async () => {
  let writeCalled = false;
  const mockPrismaFaulty = {
    $queryRaw: async () => {
      throw new Error("Network timeout during auth");
    },
    outlet: {
      upsert: async () => {
        writeCalled = true;
      },
    },
  };

  try {
    await verifyDatabaseIdentity(mockPrismaFaulty, { host: "localhost", db: "seroo_dev" });
    assert.fail("Harusnya melempar error");
  } catch (err) {
    assert.match(err.message, /FAIL-CLOSED/);
  }

  assert.equal(writeCalled, false, "Tidak boleh ada operasi penulisan jika identitas gagal diverifikasi");
});

test("11. NODE_ENV=production dengan DEPLOYMENT_ENV=staging dan target valid tetap dapat menjalankan seed", () => {
  const result = assertSafeDatabaseForSeed(
    "postgresql://user:pass@staging-db.seroo.id:5432/seroo_staging",
    {
      DEPLOYMENT_ENV: "staging",
      NODE_ENV: "production",
      ALLOW_STAGING_SEED: "true",
    },
  );
  assert.equal(result.isStaging, true);
  assert.equal(result.host, "staging-db.seroo.id");
  assert.equal(result.db, "seroo_staging");
});

test("12. DEPLOYMENT_ENV=production selalu ditolak", () => {
  assert.throws(
    () =>
      assertSafeDatabaseForSeed("postgresql://user:pass@localhost:5432/seroo_dev", {
        DEPLOYMENT_ENV: "production",
      }),
    /AKSES DITOLAK.*production/,
  );

  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@staging-db.seroo.id:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "production",
          ALLOW_STAGING_SEED: "true",
        },
      ),
    /AKSES DITOLAK.*production/,
  );
});

test("13. Production hostname tetap ditolak", () => {
  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@db.prod.seroo.id:5432/seroo_staging",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
          STAGING_TARGET_PAIRS: "db.prod.seroo.id:seroo_staging",
        },
      ),
    /AKSES DITOLAK.*production/,
  );

  assert.throws(
    () =>
      assertSafeDatabaseForSeed(
        "postgresql://user:pass@staging-db.seroo.id:5432/seroo_production",
        {
          DEPLOYMENT_ENV: "staging",
          ALLOW_STAGING_SEED: "true",
          STAGING_TARGET_PAIRS: "staging-db.seroo.id:seroo_production",
        },
      ),
    /AKSES DITOLAK.*production/,
  );
});

test("14. Credential tidak muncul dalam error log", () => {
  const secretPassword = "SuperSecretDbPassword999!";
  const dbUrl = `postgresql://seroo_user:${secretPassword}@staging-db.seroo.id:5432/unauthorized_db`;

  try {
    assertSafeDatabaseForSeed(dbUrl, {
      DEPLOYMENT_ENV: "staging",
      ALLOW_STAGING_SEED: "true",
    });
    assert.fail("Harusnya melempar error");
  } catch (err) {
    assert.equal(err.message.includes(secretPassword), false);
    assert.equal(err.message.includes("seroo_user"), false);
  }
});
