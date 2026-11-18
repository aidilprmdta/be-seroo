# Seroo Backend

Backend Sistem Informasi Manajemen Operasional Teh Tarik Seroo.

Aplikasi backend ini dikembangkan untuk mendukung pengelolaan operasional Teh Tarik Seroo, meliputi autentikasi pengguna, pengelolaan akun dan hak akses, data outlet, katalog produk, transaksi penjualan, persediaan bahan baku, pencatatan waste, pengeluaran operasional, serta laporan.

## Teknologi yang Digunakan

| Komponen | Teknologi |
|---|---|
| Runtime | Node.js |
| Bahasa Pemrograman | JavaScript (ES Modules) |
| HTTP API Framework | Hono |
| HTTP Server | @hono/node-server |
| Validasi Input | Zod |
| ORM | Prisma ORM 6.19.3 |
| Database | PostgreSQL 17 |

Sistem dirancang untuk mendukung pengelolaan banyak outlet. Pada tahap awal, implementasi dan pengujian difokuskan pada outlet pilot Rumbai/Jalan Sekolah.

## Persyaratan Sistem

Sebelum menjalankan backend, pastikan perangkat telah memiliki:

- Node.js versi LTS yang kompatibel dengan dependensi proyek.
- PostgreSQL 17.
- Package manager yang digunakan oleh proyek.
- Git (opsional, untuk pengelolaan kode sumber).

## Instalasi dan Konfigurasi

1. Unduh atau salin repository proyek ke perangkat.
2. Masuk ke direktori backend.
3. Instal seluruh dependensi yang dibutuhkan.
4. Siapkan database PostgreSQL.
5. Buat file konfigurasi `.env` berdasarkan `.env.example`.
6. Sesuaikan konfigurasi koneksi database melalui variabel `DATABASE_URL`.
7. Atur `JWT_ACCESS_SECRET` menggunakan nilai acak minimal 32 karakter. Jangan menggunakan nilai contoh untuk lingkungan production.
8. Jalankan perintah Prisma yang sesuai dengan skema dan status migration proyek untuk menyiapkan struktur database.

## Menjalankan Backend

Setelah instalasi dan konfigurasi selesai, backend dapat dijalankan menggunakan script yang tersedia pada `package.json`.

Periksa script yang tersedia sebelum menjalankan aplikasi, misalnya untuk mode development atau production.

## Konfigurasi Environment

Backend memerlukan beberapa variabel lingkungan utama, antara lain:

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | URL koneksi ke database PostgreSQL |
| `JWT_ACCESS_SECRET` | Secret untuk proses penandatanganan token akses |

Nilai konfigurasi rahasia harus disimpan dalam file environment dan tidak boleh dimasukkan ke repository publik.

## Struktur dan Pengembangan Sistem

Pengembangan backend dilakukan secara modular agar setiap fungsi sistem dapat dikelola dan dikembangkan secara terpisah. Struktur database didefinisikan menggunakan Prisma Schema, sedangkan komunikasi antara aplikasi backend dan database dikelola melalui Prisma ORM.

Pengembangan sistem juga memperhatikan autentikasi, pembatasan hak akses berdasarkan peran pengguna (Role-Based Access Control), serta pembatasan data berdasarkan outlet (Outlet Scoping).

## Catatan Keamanan

- Gunakan HTTPS pada lingkungan production.
- Lindungi kredensial database dan secret autentikasi.
- Lakukan pemeriksaan hak akses pada setiap endpoint yang memerlukan otorisasi.
- Tinjau setiap perubahan database sebelum diterapkan.
- Lakukan backup sebelum menjalankan perubahan database yang berpotensi mengubah atau menghapus data.