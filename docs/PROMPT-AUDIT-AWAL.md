# Prompt Audit Awal Backend (Read-only)

Jalankan prompt ini di Codex dari root repository `sero-system` setelah menyalin instruksi dan skill backend.

```text
Gunakan skill $seroo-backend-security-audit dan $seroo-backend-qa sebagai panduan audit.

Lakukan AUDIT READ-ONLY terhadap backend Seroo. Jangan mengedit, membuat, menghapus, atau memformat file. Jangan menjalankan migration, seed, reset, install, upgrade, atau command yang mengubah database/dependency.

Baca backend/AGENTS.md dan dokumen docs/backend terlebih dahulu. Periksa kondisi repository aktual:
- backend/package.json dan lockfile
- src/index.js, struktur src, semua route/service/middleware
- .env.example dan .gitignore (jangan tampilkan isi secret .env)
- prisma/schema.prisma dan semua migration yang ada
- test, konfigurasi runtime, dan dokumentasi API

Laporkan:
1. Kondisi aktual vs PRD; jangan mengasumsikan fitur sudah ada.
2. Dependency/versi aktual dan ketidakkonsistenan Prisma config.
3. Gap data model dari DATA-MODEL.md.
4. Authentication, authorization, multi-outlet isolation, validation, CORS, rate limiting, logging, error handling.
5. Risiko OWASP API Top 10 yang relevan.
6. Bug/AI slop: fake endpoints, dummy data, dead code, oversized modules, duplicate logic, unbounded queries, unhandled errors.
7. Status test yang benar-benar bisa diverifikasi.
8. Prioritas temuan: Critical / High / Medium / Low, bukti lokasi file/baris, dampak, rekomendasi.
9. Rencana perbaikan bertahap dengan estimasi kompleksitas relatif (S/M/L), tanpa mengubah file.

Jangan mengeluarkan secret/token/credential. Jika informasi tidak tersedia, tulis NOT VERIFIED. Akhiri dengan daftar keputusan yang perlu dikonfirmasi manusia.
```
