// fake-where.js — Helper untuk buat test: nilai yang biasanya diambil dari database
// (id, email, createdAt, dsb.) bisa disubstitusi dengan key yang konsisten tanpa
// memerlukan koneksi ke DB nyata. Gunakan bersama test yang butuh placeholder
// tanpa tabel yang siap.

/**
 * Generate nama field placeholder yang unik dan mudah dibaca.
 * @param {string} base - Nama field dasar (misal: "id", "email", "outletId")
 * @returns {string} - Field placeholder yang aman
 */
export function fakeWhere(base) {
  if (!base || typeof base !== "string" || base.trim().length === 0) {
    throw new Error("fakeWhere: base harus string non-empty");
  }
  return `__FAKE__${base.toUpperCase()}`;
}

/**
 * Buat object `where` untuk query yang hanya butuh filter konsisten di dalam test.
 * @param {object} overrides - Override untuk field spesifik
 * @returns {object} - Placeholder object
 *
 * @example
 * // Contoh penggunaan:
 * const where = {
 *   id: fakeWhere("id"),
 *   outletId: fakeWhere("outletId"),
 * };
 */
export function buildFakeWhere(overrides = {}) {
  const allowed = new Set([
    "id",
    "outlet_id",
    "outletId",
    "email",
    "name",
    "password",
    "role",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "status",
    "payment_id",
    "order_id",
  ]);
  const result = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!allowed.has(key)) {
      console.warn(`[fake-where] Field "${key}" tidak dicentang, tetap disimpan sebagai placeholder.`);
    }
    result[key] = `__FAKE__${key}`;
  }
  return { ...result, ...overrides };
}

/**
 * Generate list placeholder test data yang reusable.
 */
export function fakeList(count = 10, prefix = "fake") {
  if (!Number.isInteger(count) || count < 0 || count > 1000) {
    throw new Error("fakeList: count harus integer 0-1000");
  }
  return Array.from({ length: count }, (_, i) => `${prefix}_${i}_${Date.now()}`);
}
