# PRD Backend — Teh Tarik Seroo

**Status:** Draft teknis untuk implementasi prototipe  
**Platform:** Backend API untuk aplikasi React Native + Expo  
**Baseline:** JavaScript ES Modules, Node.js, Hono, Zod, Prisma 6.19.3, PostgreSQL 17  
**Pilot:** Outlet Rumbai / Jalan Sekolah  
**Cakupan desain data:** Multi-outlet

## 1. Ringkasan produk

Backend Seroo menyediakan API terpusat bagi aplikasi mobile yang digunakan Crew, Manager, dan Owner. Sistem menangani transaksi POS minuman, pencatatan pengeluaran operasional, persediaan, waste, dan ringkasan laporan. Backend menjadi satu-satunya sumber otoritatif untuk validasi harga, total transaksi, identitas pengguna, hak akses, cakupan outlet, serta perubahan data keuangan dan stok.

Prototipe diuji di satu outlet Rumbai, tetapi rancangan tidak boleh mengasumsikan hanya ada satu outlet. Pengguna hanya boleh mengakses outlet yang diberikan melalui relasi keanggotaan/otorisasi yang sah.

## 2. Masalah yang ditangani

- Sebagian outlet masih mencatat penjualan secara manual sehingga transaksi berisiko terlewat ketika ramai.
- Pengeluaran operasional dipindahkan dari catatan manual ke spreadsheet, menambah beban rekapitulasi.
- Catatan persediaan dapat berbeda dari jumlah fisik akibat kesalahan input atau keterlambatan pasokan.
- Bahan atau minuman yang terbuang tidak selalu terdokumentasi.
- Manager dan Owner membutuhkan ringkasan penjualan, pengeluaran, serta persediaan tanpa menggabungkan data secara manual.

Sistem membantu pencatatan dan pengawasan; sistem tidak menjamin dapat mendeteksi transaksi yang sengaja tidak dimasukkan atau membuktikan kecurangan hanya dari selisih stok.

## 3. Tujuan dan indikator keberhasilan

1. Setiap transaksi POS yang diselesaikan tersimpan dengan detail item, ukuran, add-on, harga snapshot, total, metode pembayaran, outlet, Crew, dan timestamp.
2. Total transaksi dihitung dan diverifikasi backend; nilai total dari client tidak dipercaya sebagai sumber kebenaran.
3. Pengeluaran operasional dapat dicatat Manager dan ditelusuri berdasarkan outlet, kategori, tanggal, nominal, dan pembuat.
4. Perubahan persediaan memiliki ledger pergerakan yang dapat diaudit.
5. Waste dicatat dengan item, jumlah, satuan, kategori, keterangan, outlet, pembuat, dan waktu.
6. Manager/Owner memperoleh laporan yang hanya mencakup outlet yang diotorisasi.
7. Akses lintas-outlet dan perubahan data tanpa izin ditolak di backend.
8. Operasi multi-tabel penting bersifat atomik dan memiliki test.

Target kuantitatif performa/availability belum ditetapkan. Jangan mengarang SLA.

## 4. Aktor dan hak akses awal

| Kemampuan | Crew | Manager | Owner |
|---|---:|---:|---:|
| Login dan melihat profil sendiri | Ya | Ya | Ya |
| Membuat transaksi POS | Ya | Tidak, kecuali ada keputusan baru | Tidak |
| Melihat transaksi outlet sendiri | Terbatas pada kebutuhan operasional; detail harus dikonfirmasi | Ya | Ringkasan baca saja |
| Input pengeluaran | Tidak | Ya | Tidak |
| Melihat laporan keuangan | Tidak | Ya | Baca saja |
| Melihat stok outlet | Ya | Ya | Ringkasan bila diperlukan |
| Mengelola stok/master persediaan | Tidak; hanya request/aktivitas yang diizinkan | Ya | Tidak |
| Mengajukan permintaan stok | Ya | Ya, sesuai kewenangan | Tidak |
| Memproses/menyetujui permintaan stok | Tidak | Ya, sesuai alur dan kewenangan outlet | Tidak |
| Mencatat waste | Ya | Ya | Tidak |
| Melihat seluruh waste outlet yang diotorisasi | Riwayat milik/outlet sesuai keputusan UI | Ya | Ringkasan bila diperlukan |
| Mengelola master produk/harga | Tidak | Ya, jika dikonfirmasi | Tidak |

**Penting:** peran di atas merupakan baseline dari keputusan operasional terbaru dan harus diterapkan melalui policy server-side. Proposal lama memiliki ketidakkonsistenan, termasuk KF-05 yang menyebut Crew dan Manager dapat input pengeluaran. Untuk implementasi awal, keputusan terbaru adalah Manager saja. Dokumen akademik harus diselaraskan.

`OutletMembership` adalah konsep otorisasi, bukan jaminan bahwa model Prisma saat ini sudah sepenuhnya memenuhi aturan. Periksa schema sebelum implementasi.

### Identitas akun dan permission

- Setiap Crew, Manager, dan Owner menggunakan akun pribadi atas nama pengguna itu sendiri; akun tidak boleh dipakai bersama.
- Pada MVP hanya Administrator yang boleh membuat akun. Akun Crew/Manager/Owner dibuat melalui proses provisioning yang diaudit; tidak ada public self-registration.
- Siapkan arsitektur berbasis permission/capability dan scope outlet. Role dapat dipetakan ke permission baseline, tetapi endpoint memeriksa permission dan membership server-side, bukan hanya nama role dari client.
- Tahap berikutnya dapat memberi Manager permission untuk membuat dan mengelola akun Crew pada outlet yang menjadi kewenangannya. Desain tidak boleh mengharuskan perubahan besar pada model otorisasi, tetapi fitur Manager ini belum aktif pada MVP dan Manager tidak boleh mengelola akun lintas outlet, Manager, Owner, atau Administrator.
- Model identitas Administrator, permission katalog, provisioning/reset password, pencabutan akses, dan penanganan akun yang punya beberapa membership/role masih perlu dikunci. Jangan menganggap role `ADMIN` sudah ada pada schema saat ini.

## 5. Ruang lingkup fungsional

### 5.1 Authentication dan authorization
- Login dengan kredensial akun pribadi yang dibuat Administrator pada MVP.
- Refresh token opaque dirotasi setiap kali dipakai dan hanya hash token disimpan di database; session dan aktivitas actor harus dapat diaudit.
- Batasi active session: Crew maksimal satu; Manager dan Owner maksimal dua. Kebijakan saat batas tercapai dan akun dengan role campuran harus diputuskan sebelum implementasi.
- Auto-lock aplikasi setelah 10 menit tidak aktif untuk semua role. Server idle timeout adalah 30 menit sejak aktivitas terautentikasi terakhir.
- Session Crew memiliki absolute lifetime 12 jam dan refresh tidak boleh memperpanjang batas tersebut. Untuk Manager/Owner, pertahankan session paling lama 15 menit setelah aplikasi ditinggalkan; detail deteksi background/closed dan perilaku re-auth harus ditentukan.
- Identitas actor berasal dari kredensial/session terverifikasi, bukan body request.
- Setiap request yang menyentuh data outlet harus membuktikan membership dan role yang sesuai.
- User dapat memiliki akses ke lebih dari satu outlet; endpoint harus menerima outlet context yang lalu diverifikasi server.
- Owner bersifat read-only terhadap data transaksi, stok, waste, dan pengeluaran.

Access token v1 saat ini memiliki TTL 15 menit. Refresh token harus dirotasi, disimpan sebagai hash, dan direvoke saat session berakhir/dicabut. Batas sesi baru di atas menggantikan lifetime 30 hari dari keputusan auth terdahulu; detail kebijakan per role dicatat di `OPEN-DECISIONS.md`.

### 5.2 POS
- Mendapatkan katalog produk, varian ukuran (contoh Medium/Large), harga, dan add-on aktif.
- Membuat order dengan satu atau lebih item.
- Memilih metode pembayaran CASH atau QRIS sebagai pencatatan metode pembayaran.
- Backend mengambil harga aktif dari database, menghitung subtotal/total, memvalidasi kuantitas, lalu menyimpan snapshot nama dan harga item/add-on.
- MVP online-first dengan limited offline support: POS dapat disimpan lokal sementara menggunakan Expo SQLite saat koneksi tidak tersedia, lalu dikirim melalui sync queue. Ini bukan jaminan transaksi diterima atau diselesaikan.
- Setiap transaksi membawa `clientTransactionId` unik dan stabil yang dibuat sekali, dipersistenkan sebelum antre, dan dipakai ulang pada setiap retry. Backend menegakkan idempotensi dan tidak membuat transaksi baru untuk replay ID yang sama.
- Jika harga/katalog di server berbeda dari snapshot saat input offline, backend tidak boleh diam-diam mengubah transaksi yang sudah dicatat/dibayar. Konflik harga dan tindakan recovery perlu dikonfirmasi; sampai itu ditetapkan, transaksi harus dapat masuk status yang memerlukan review.
- QRIS yang dicatat ketika offline berstatus `PENDING_RECONCILIATION`; status ini bukan verifikasi pembayaran maupun settlement dan tidak boleh dilaporkan sebagai QRIS terverifikasi.
- Order completed tidak boleh diubah diam-diam. Koreksi/pembatalan memerlukan aturan dan audit trail yang belum final.
- Order cancellation/void tidak boleh menghapus jejak transaksi.

Tidak termasuk integrasi otomatis ke payment gateway/QRIS, Majo POS, ShopeeFood, atau layanan eksternal.

### 5.3 Pengeluaran
- Manager memilih outlet yang diotorisasi, kategori, tanggal, nominal, dan keterangan.
- Backend menyimpan actor dan timestamp.
- Tidak ada input pengeluaran oleh Crew pada baseline terbaru.
- Metode/sumber pembayaran pengeluaran dan dampaknya terhadap kas fisik perlu dipastikan sebelum laporan cashflow dirilis.

### 5.4 Persediaan
- Stok disimpan per pasangan outlet dan item persediaan.
- Setiap perubahan stok memiliki StockMovement/ledger yang dapat ditelusuri.
- Kuantitas menggunakan Decimal dengan satuan yang terdefinisi; jangan menggunakan floating point.
- Stock balance dan movement harus berubah dalam transaksi database yang sama.
- Transfer antar-outlet harus mencatat asal, tujuan, jumlah dikirim, jumlah diterima, status, dan actor; jangan menganggap request sama dengan transfer selesai.
- Pengurangan otomatis dari penjualan hanya boleh berjalan untuk produk-varian yang memiliki resep/takaran valid dan dikonfirmasi.
- Penyesuaian stok manual perlu alasan dan jejak audit.
- Transfer dan penyesuaian stok memerlukan koneksi online pada MVP; jangan masukkan keduanya ke antrean offline.

### 5.5 Waste
- Crew dan Manager dapat mencatat bahan/produk terbuang.
- Setiap catatan terkait outlet, actor, item/nama snapshot, kuantitas, unit, kategori, waktu, dan keterangan opsional.
- Jika waste mengurangi stok, pencatatan waste dan StockMovement harus atomik agar tidak double decrement.
- Jangan otomatis mengurangi stok bila sumber stok/item tidak dapat dipastikan.
- Waste boleh disimpan sementara lokal dengan Expo SQLite saat offline, menggunakan `clientTransactionId`, antrean sync, status sinkronisasi, dan idempotensi yang sama kuatnya dengan POS.

### 5.6 Reports
- Laporan harian/bulanan berdasarkan outlet dan periode.
- Penjualan berasal dari order valid/completed, tidak diinput ulang sebagai angka pemasukan.
- Expense berasal dari record pengeluaran yang sah.
- Total Cash dan QRIS dapat dipisahkan berdasarkan metode yang tercatat pada order.
- Cashflow/saldo kas memerlukan aturan saldo awal, sumber penerimaan, metode pembayaran expense, setoran/transfer, dan waktu cut-off. Jangan mengklaim saldo kas aktual bila data pendukung tidak tersedia.
- Jangan menampilkan net profit, HPP, atau profit sharing sebagai angka final sebelum definisi biaya pokok, komponen biaya, dan formula disepakati.
- Daily/monthly period harus menggunakan timezone bisnis `Asia/Jakarta` dengan batas rentang eksplisit.

## 6. Non-functional requirements

### Security
- Password disimpan sebagai hash Argon2id (atau pilihan setara yang disetujui), tidak pernah plaintext.
- Token/session secret disimpan pada environment/secret manager, bukan source code.
- CORS allowlist eksplisit; jangan wildcard bersama credentials.
- Rate limit login dan endpoint sensitif.
- Validasi request menggunakan Zod.
- Otorisasi function-, object-, dan property-level.
- Query outlet-scoped wajib menyertakan scope outlet yang sudah diverifikasi.
- Error response tidak membocorkan stack trace, SQL, secret, atau konfigurasi internal.
- Log harus meminimalkan PII dan tidak pernah merekam password/token.

### Reliability and integrity
- Gunakan Prisma `$transaction` untuk operasi multi-write yang harus atomik.
- Gunakan idempotensi server-side untuk POS dan waste yang disinkronkan; uniqueness minimal di-scope oleh actor, outlet, jenis operasi, dan `clientTransactionId`. ID sama dengan payload berbeda menghasilkan conflict, bukan mutasi diam-diam.
- Sinkronisasi lokal harus menyimpan status, jumlah percobaan/waktu retry, error aman untuk ditindaklanjuti, dan waktu server konfirmasi. Retry hanya untuk kegagalan transient dengan backoff; jangan retry validation/authorization/conflict tanpa perubahan input.
- Gunakan Decimal untuk nilai uang/kuantitas pecahan.
- Soft deactivate master data yang dipakai transaksi historis.
- Buat index sesuai pola query dan outlet scope.

### Auditability
- Setiap user memiliki catatan session dan aktivitas yang dapat ditelusuri ke user, session, outlet (bila berlaku), jenis aksi/resource, hasil, dan timestamp server.
- Aktivitas offline membawa client transaction ID dan waktu input perangkat sebagai metadata yang tidak dipercaya; server merekam waktu penerimaan/konfirmasi sendiri sebagai sumber waktu otoritatif.
- Jangan mencatat password, access/refresh token, secret, atau payload sensitif secara berlebihan. Retention dan akses ke audit log harus ditentukan sebelum produksi.

### Maintainability
- Route layer tipis; business rules berada di service/use-case layer.
- Validasi schema terpisah dari persistence mapping.
- Error code stabil dan response konsisten.
- Test untuk positive, negative, authorization, outlet isolation, dan concurrency-sensitive operations.

## 7. Harga produk dan status keputusan

Harga produk global lintas-outlet hanya asumsi sementara untuk penyederhanaan awal dan **belum merupakan keputusan final Seroo**. Konfirmasi tertulis diperlukan sebelum menetapkan model harga/endpoint/migration. Desain data dan API tidak boleh mengunci satu harga global sehingga penambahan harga per outlet kelak memerlukan perubahan besar. Jangan menampilkan harga global sebagai fakta bisnis yang telah disetujui.

## 8. Batasan implementasi

- Satu backend dan satu database bersama untuk seluruh outlet.
- Pilot UAT pada satu outlet Rumbai.
- Mobile app mengonsumsi REST API melalui jaringan.
- Tidak ada integrasi Majo POS atau payment gateway dalam scope awal.
- Online-first dengan offline support terbatas hanya untuk POS dan waste lokal; tidak ada offline penuh. Transfer dan penyesuaian stok wajib online pada MVP. UI harus membedakan antrean lokal, sedang sync, perlu tindakan, dan sukses server; jangan mengklaim order/waste sudah tersimpan di server sebelum konfirmasi.
- Tidak ada multi-tenant database terpisah per outlet.

## 9. Acceptance criteria awal

1. User tanpa session valid tidak dapat mengakses endpoint privat.
2. Crew outlet A tidak dapat membaca atau mengubah transaksi outlet B dengan mengganti `outletId` atau resource ID.
3. Owner tidak dapat melakukan mutation meskipun mengirim request langsung tanpa melalui UI.
4. Manager hanya dapat mengelola outlet yang terdaftar pada membership-nya.
5. Backend menghitung total order dari harga server-side dan snapshot transaksi.
6. Retry POS/waste dengan `clientTransactionId` yang sama tidak menghasilkan record ganda; payload berbeda dengan ID yang sama menghasilkan conflict dan audit.
7. Expense hanya dapat dibuat Manager yang memiliki akses ke outlet.
8. Waste yang mengurangi stok membuat satu perubahan ledger yang konsisten, tidak dua kali.
9. Transfer stok tidak mengubah saldo akhir sampai proses perpindahan memenuhi aturan status yang disepakati.
10. Laporan lintas outlet hanya memuat outlet yang diotorisasi.
11. Daily/monthly report menghitung periode `Asia/Jakarta` secara konsisten.
12. Semua endpoint utama memiliki test autentikasi, authorization, validasi, dan error path.
13. Session caps/expiry, refresh rotation/hash-at-rest, idle timeout, and activity audit are enforced server-side and covered by tests.
14. Account creation is Administrator-only for MVP; no shared/publicly registered role accounts are accepted.
15. POS/waste retries are idempotent by stable `clientTransactionId`; offline QRIS remains pending reconciliation, while transfer/stock adjustment reject offline operation.

## 10. Dependencies

- Mobile PRD: `mobile/docs/mobile/PRD.md`.
- API Contract: `backend/docs/API-CONTRACT.md`.
- Data model: `backend/docs/DATA-MODEL.md`.
- Open decisions: `backend/docs/OPEN-DECISIONS.md`.
- Test strategy: `backend/docs/TEST-STRATEGY.md`.

## 11. Referensi

- Proposal integrasi RPLBO + DIA + SI yang menjadi dasar kebutuhan proyek.
- Hasil wawancara Manager Operasional/Keuangan Seroo.
- OWASP API Security Top 10 2023: https://api-security.owasp.org/editions/2023/en/0x11-t10/
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Hono middleware docs: https://hono.dev/docs/guides/middleware
