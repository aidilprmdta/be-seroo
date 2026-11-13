# Seroo Backend AI Kit

Dokumentasi dan skill Codex untuk mengembangkan backend aplikasi Teh Tarik Seroo.

## Stack yang menjadi baseline

- Runtime: Node.js (gunakan LTS yang kompatibel dengan dependency project saat ini)
- Bahasa: JavaScript (ES Modules)
- HTTP API: Hono + `@hono/node-server`
- Validasi input: Zod
- ORM: Prisma ORM **6.19.3** (dipatok sementara agar konsisten dengan instalasi project saat ini)
- Database: PostgreSQL 17
- Pilot: satu outlet Rumbai/Jalan Sekolah; desain data mendukung banyak outlet

Jangan upgrade major version, mengganti ORM, atau menambah framework tanpa keputusan eksplisit.

## Cara memasang

1. Ekstrak paket ini di luar folder project atau ke lokasi sementara.
2. Salin `backend/AGENTS.md` ke `sero-system/backend/AGENTS.md`.
3. Salin `docs/backend/` ke `sero-system/docs/backend/`.
4. Salin `.agents/skills/` ke `sero-system/.agents/skills/`.
5. Jangan menimpa `AGENTS.md` root atau skill mobile yang sudah ada. Bila root `AGENTS.md` sudah ada, gabungkan isi `integration/ROOT-AGENTS-BACKEND-SECTION.md` secara manual.
6. Buka Codex dari root `sero-system` agar instruksi root, backend, dan skill dapat ditemukan.

## Urutan penggunaan yang disarankan

1. Baca `docs/backend/PRD-BACKEND.md` dan `docs/backend/OPEN-DECISIONS.md`.
2. Jalankan prompt audit read-only di `docs/backend/PROMPT-AUDIT-AWAL.md`.
3. Minta Codex membuat laporan gap antara kode/schema saat ini dengan PRD. Jangan izinkan perubahan file dulu.
4. Prioritaskan security model dan outlet-scoping sebelum membuat business endpoints.
5. Implementasikan per modul kecil dan jalankan test setelah setiap perubahan.

## Penting

Paket ini berisi spesifikasi dan instruksi, bukan bukti bahwa backend sudah aman atau semua fitur sudah berjalan. Codex harus memeriksa repository aktual sebelum menyimpulkan sesuatu. Jangan menjalankan `migrate reset`, `db push --force-reset`, menghapus data, atau melakukan migration destruktif tanpa backup dan persetujuan eksplisit.

Backend runtime memerlukan `DATABASE_URL` dan `JWT_ACCESS_SECRET`. Buat nilai `JWT_ACCESS_SECRET` acak minimal 32 karakter untuk setiap environment dan jangan menggunakan nilai contoh dari `.env.example`. Gunakan HTTPS langsung atau terminasi TLS pada reverse proxy tepercaya di production. Migration auth bersifat additive dan harus direview sebelum `prisma migrate deploy`.

`package.json` overrides `deepmerge-ts` to `8.0.2` to address the Prisma config advisory while retaining Prisma 6.19.3. Revalidate Prisma CLI behavior and remove/revise this override when upgrading Prisma.
