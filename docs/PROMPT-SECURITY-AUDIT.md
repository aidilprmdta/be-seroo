# Prompt: Security Audit Backend (Read-only)

```text
Gunakan skill $seroo-backend-security-audit.
Lakukan audit keamanan READ-ONLY pada backend Seroo.
Jangan mengubah file, memasang package, mengubah env, menjalankan migration, menghapus data, atau melakukan pengujian aktif pada server produksi.

Periksa autentikasi dan session, password hash, token lifecycle, middleware Hono, CORS, rate limiting, Zod validation, authorization per role, outlet membership, BOLA/IDOR, property-level authorization, Prisma queries, transaksi, idempotency, secrets, error handling, logs, dan dependency risks.
Prioritaskan skenario: Crew outlet A mengakses outlet B, Manager tanpa membership mengakses outlet lain, Owner memanggil endpoint mutation secara langsung, spoof role/creator/price/total, order retry ganda, stock receipt ganda.

Setiap temuan harus menyebut severity, file dan baris bukti, precondition, impact, recommendation, dan test yang dibutuhkan. Pisahkan confirmed finding, potential risk, dan NOT VERIFIED. Jangan tampilkan nilai secret.
Akhiri dengan remediation plan berurutan. Jangan memperbaiki file pada audit ini.
```
