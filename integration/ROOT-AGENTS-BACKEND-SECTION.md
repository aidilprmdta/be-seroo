# Backend project guidance (merge into root AGENTS.md)

- Untuk pekerjaan backend, baca `backend/AGENTS.md` terlebih dahulu.
- Spesifikasi backend ada di `docs/backend/PRD-BACKEND.md`, `ARCHITECTURE.md`, `API-CONTRACT.md`, `DATA-MODEL.md`, dan `OPEN-DECISIONS.md`.
- Dokumen bukan bukti implementasi aktual: periksa file dan lockfile terlebih dahulu.
- Gunakan JavaScript ES Modules, Hono, Zod, PostgreSQL 17, dan Prisma 6.19.3 sesuai baseline saat ini.
- Jangan upgrade Prisma major version atau membuat konfigurasi Prisma 7 tanpa persetujuan.
- Jangan menimpa instruksi mobile yang sudah ada; gabungkan panduan backend.
- Jangan menambahkan dummy data, mock success, endpoint palsu, atau integrasi gateway yang tidak tersedia.
- Jangan menjalankan command destruktif atau mengubah migration lingkungan bersama tanpa persetujuan eksplisit.
