// pg-test-guard.js — Helper untuk memastikan test PostgreSQL berjalan dengan benar.
// Memblokir test yang tidak sejati: database tidak aman, race iterations tidak valid,
// test dilewati, atau nol test dijalankan.

export function resolveTestDatabase(env) {
  const url = env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL tidak disetel. Setel POSTGRESQL_URL atau TEST_DATABASE_URL sebelum menjalankan test:pg.");
  }
  // Cek URL yang valid dulu, baru cek scheme yang diizinkan.
  try {
    const urlObj = new URL(url);
    if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
      throw new Error(`TEST_DATABASE_URL tidak aman: schema ${urlObj.protocol.replace(":", "")} tidak diizinkan (hanya postgres:// atau postgresql://)`);
    }
    return {
      dbName: urlObj.pathname.replace(/^\/+/, ""),
      host: urlObj.hostname,
      port: Number(urlObj.port) || 5432,
      user: urlObj.username,
    };
  } catch (error) {
    throw new Error(`TEST_DATABASE_URL tidak valid: ${error.message}`);
  }
}

export function parseRaceIterations(env) {
  const raw = env.PG_RACE_ITERATIONS;
  if (raw === undefined || raw === "") {
    return 1; // default 1 iterasi
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`PG_RACE_ITERATIONS harus integer 1-100, mendapat "${raw}"`);
  }
  return parsed;
}

export function summarizeTap(output) {
  const lines = output.split("\n");
  let pass = 0;
  let fail = 0;
  let skip = 0;
  let todo = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^ok\s+(\d+)/.test(trimmed)) {
      pass++;
    } else if (/^not\s+ok\s+(\d+)/.test(trimmed)) {
      fail++;
    } else if (/^skippy\s+(\d+)/.test(trimmed)) {
      skip++;
    } else if (/^todo\s+(\d+)/.test(trimmed)) {
      todo++;
    }
  }

  return { pass, fail, skip, todo, total: pass + fail + skip + todo };
}

export function assertPgRunSucceeded(summary, code) {
  if (summary.pass === 0) {
    return "Tidak ada test yang dijalankan (pass=0). Pastikan TEST_DATABASE_URL disetel dan test file ada.";
  }
  if (summary.skip > 0) {
    return `Test dilewati (${summary.skip}). Pastikan semua test dieksekusi dengan benar.`;
  }
  if (summary.fail > 0) {
    return `Test gagal: ${summary.fail} not ok, ${summary.pass} ok.`;
  }
  return null; // sukses
}
