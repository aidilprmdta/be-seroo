# Open Decisions — Backend

Item berikut belum boleh dianggap sudah disepakati. Codex harus mengangkatnya sebagai pertanyaan/risiko, bukan mengarang jawaban.

| ID | Keputusan | Mengapa penting | Default sementara yang aman |
|---|---|---|---|
| OD-01 | Detail endpoint/auth lifecycle untuk session policy baru | Menentukan model auth dan schema session | Access HS256 15 menit; refresh opaque rotating dan hash at rest; Crew cap 1/absolute 12 jam; Manager/Owner cap 2/retention maks. 15 menit setelah app ditinggalkan; auto-lock 10 menit semua role; server idle 30 menit. Runtime belum menerapkan kebijakan baru |
| OD-02 | Alur provisioning selain keputusan siapa yang membuat akun MVP; reset/invite/activation dan identitas Administrator bagaimana? | Menghindari self-signup/eskalasi akses | MVP hanya Administrator membuat akun; detail proses/admin identity perlu diputuskan |
| OD-03 | Bagaimana permission Manager untuk mengelola akun Crew dibatasi dan diaudit? | Membatasi akses multi-outlet | Arsitektur permission + outlet scope; fitur nanti hanya Crew pada outlet berwenang; tidak ada hak lintas outlet |
| OD-04 | Owner melihat semua outlet atau outlet tertentu? | Scope laporan keuangan | Outlet membership eksplisit; jangan beri global access secara default |
| OD-05 | Crew boleh melihat riwayat transaksi sampai sejauh mana? | Privasi dan kebutuhan shift | Hanya data operasional outlet sesuai keputusan UI |
| OD-06 | Pengeluaran dibayar dengan sumber/metode apa? | Menghitung arus kas yang benar | Tambahkan metode pembayaran hanya setelah dikonfirmasi |
| OD-07 | Ada kas awal, setoran, penarikan, kas tutup shift? | Menghitung saldo kas fisik | Jangan tampilkan saldo kas fisik tanpa komponen tersebut |
| OD-08 | Apakah satu order dapat memakai lebih dari satu metode pembayaran? | Struktur pembayaran | Satu metode per order seperti schema awal, sampai dikonfirmasi |
| OD-09 | Bagaimana void/refund transaksi? Siapa berwenang? | Audit penjualan dan reversal stok/keuangan | Jangan hard-delete completed order; tahan fitur void hingga aturan ada |
| OD-10 | Apakah stok boleh minus? | Menentukan aturan checkout dan concurrency | Rekomendasi: tolak kekurangan stok, tetapi minta persetujuan bisnis |
| OD-11 | Satuan stok dan konversi (kaleng, ml, gram, cup, pack) | Mencegah salah hitung persediaan | Satu base unit per inventory item; konversi eksplisit |
| OD-12 | Resep/takaran setiap menu/ukuran dan masa berlakunya | Otomatisasi pengurangan bahan | Jangan otomatis kurangi stok jika resep belum disahkan |
| OD-13 | Transfer antar-outlet: perlu dispatch + receipt? Boleh parsial? | Menjaga saldo dua outlet | Request ≠ transfer selesai; butuh catatan pengiriman dan penerimaan |
| OD-14 | Apakah Crew dapat meminta stok, dan kepada outlet/gudang mana? | Alur replenishment | Crew boleh mengajukan; Manager memproses sesuai kewenangan |
| OD-15 | Kategori expense/waste yang final? | Laporan konsisten | Kandidat kategori SRS boleh di-seed hanya sebagai provisional; nama final tetap menunggu konfirmasi. Master data diatur Manager setelah kategori dikonfirmasi |
| OD-16 | Definisi HPP, net profit, bagi hasil, dan laporan yang diminta Owner | Mencegah angka menyesatkan | Tampilkan sales/expense summary terpisah; jangan klaim profit dulu |
| OD-17 | Jam cut-off laporan dan tanggal operasional | Shift bisa melewati tengah malam | Calendar day `Asia/Jakarta` untuk awal; aturan shift harus dikonfirmasi |
| OD-18 | Detail idempotent sync POS/waste (retention key, status API, retry/backoff, recovery konflik) | Risiko duplicate/lost order saat jaringan putus | Limited offline disetujui khusus POS/waste dengan Expo SQLite, stable `clientTransactionId`, sync queue, idempotency dan status; transfer/penyesuaian stok online-only |
| OD-19 | Data retention, backup, audit log, dan restore target | Keamanan data bisnis | Tetapkan sebelum deployment produksi |
| OD-20 | Apakah expense dapat diedit/dibatalkan? Siapa dan bagaimana audit? | Integritas laporan | Hindari hard delete; gunakan reversal/void dengan audit setelah aturan ada |
| OD-21 | Apakah harga lintas outlet global, atau per outlet? | Katalog, transaksi offline, schema, histori harga | Global price hanya asumsi sementara; minta konfirmasi Seroo sebelum finalisasi |
| OD-22 | Perilaku saat batas active session tercapai dan cara menghitung cap untuk user dengan beberapa role? | Mencegah lockout/privilege downgrade | Crew 1, Manager/Owner 2; aksi pada login baru dan mixed-role belum diputuskan |
| OD-23 | Definisi “app ditinggalkan” untuk retention 15 menit Manager/Owner dan sinyal server untuk mendeteksinya? | App background/force-close dan session revocation | Retention maksimum 15 menit; lifecycle/heartbeat contract masih harus ditentukan |
| OD-24 | Metode unlock setelah auto-lock 10 menit? | UX dan keamanan perangkat | Jangan menganggap PIN/biometrik tersedia; konfirmasi re-auth policy |
| OD-25 | Proteksi/retensi/back-up/wipe antrean lokal Expo SQLite? | Data operasional pada perangkat hilang/shared | Minimize data; tanpa password/token; review platform storage dan cleanup sebelum produksi |
| OD-26 | Siapa yang merekonsiliasi QRIS offline, bukti apa, dan status/transisi apa? | Mencegah catatan offline dianggap settlement | `PENDING_RECONCILIATION` bukan terverifikasi; workflow/authority belum disetujui |
| OD-27 | Konflik harga offline dan nilai tunai jika harga berubah setelah transaksi dicatat? | Integritas jumlah transaksi dan pengalaman Crew | Backend tidak boleh repricing diam-diam; needs review sampai recovery disepakati |
| OD-28 | User dengan beberapa membership/role memperoleh session class mana? | Batas session dan role policy | Jangan menerapkan cap lebih longgar tanpa keputusan eksplisit |
| OD-29 | Retention dan pembaca yang berwenang untuk session/activity audit serta idempotency records? | Privasi, forensik, biaya storage | Catat actor/session/server time; jangan menyimpan token/secret; retention perlu persetujuan |

## Contradictions to resolve in documents

- Proposal lama KF-05 menyebut Crew dan Manager sebagai aktor input expense; keputusan operasional terbaru menetapkan Manager saja.
- Proposal lama menyebut Crew input pengeluaran dan UI petty cash. Jangan mengikuti bagian lama itu tanpa revisi.
- Proposal awal menyebut metode ShopeeFood pada bagian UI, sementara scope terbaru menyatakan integrasi layanan eksternal tidak masuk. Baseline API sekarang hanya CASH/QRIS sebagai catatan, kecuali ada perubahan scope resmi.
- Beberapa draft menyebut Owner melihat Net Profit/profit sharing. Formula dan COGS belum cukup jelas; label tersebut tidak boleh diimplementasikan sebagai angka akuntansi final tanpa konfirmasi.

## Decision log

Setiap keputusan baru harus ditulis di sini dengan tanggal, keputusan, alasan, dampak schema/API/UI, dan pihak yang mengonfirmasi. Jangan menimpa sejarah keputusan secara diam-diam.

| Tanggal | Keputusan | Alasan | Dampak | Konfirmasi |
|---|---|---|---|---|
| 2026-11-12 | Menetapkan Authentication v1 awal: access JWT 15 menit, refresh opaque 256-bit dengan rotasi dan hash at rest, per-device session, tidak ada public registration. Expiry awal 30 hari. | Kontrak Authentication sebelumnya. | Endpoint `/api/v1/auth/*`; refresh token SecureStore; expiry 30 hari kemudian digantikan oleh kebijakan role-based. | Pemilik produk melalui instruksi implementasi |
| 2026-11-13 | Akun Crew/Manager/Owner bersifat pribadi; provisioning MVP hanya oleh Administrator; siapkan permission/capability plus outlet scope untuk Manager mengelola akun Crew kelak hanya di outlet berwenang. | Keputusan bisnis terbaru. | Perlu API/model provisioning, permission, dan audit; Manager user management belum diaktifkan. | Pemilik produk melalui instruksi |
| 2026-11-13 | Online-first limited offline: POS/waste dapat antre lokal di Expo SQLite dengan stable `clientTransactionId`, sync queue, idempotency dan status; transfer/penyesuaian stok online-only. Offline QRIS `PENDING_RECONCILIATION`. | Koneksi terbatas tanpa menduplikasi/menganggap pembayaran QRIS terverifikasi. | Perlu API sync/idempotency/reconciliation dan local data protection; tidak mengubah schema sekarang. | Pemilik produk melalui instruksi |
| 2026-11-13 | Session policy menggantikan expiry absolut 30 hari sebelumnya: Crew maksimal 1 active session, auto-lock 10 menit, absolute 12 jam; Manager/Owner maksimal 2, auto-lock 10 menit, dipertahankan maksimal 15 menit setelah app ditinggalkan; server idle timeout 30 menit; refresh rotasi dan hash at rest. | Keputusan teknis terbaru. | Membutuhkan perubahan auth, schema/API, session audit, UX, tests; saat ini belum diimplementasikan. | Pemilik produk melalui instruksi |
| 2026-11-13 | Harga global lintas-outlet belum dikonfirmasi Seroo dan hanya asumsi sementara. | Hindari mengunci aturan bisnis sebelum konfirmasi. | Jaga data/API extensible untuk harga per outlet; jangan finalisasi schema/migration terkait harga. | Menunggu konfirmasi Seroo |

## Status kebijakan terbaru

- Session absolute 30 hari dari keputusan 2026-11-12 sudah **digantikan** oleh kebijakan per-role pada 2026-11-13. Kode runtime belum diperbarui.
- Online-first limited offline berarti hanya POS/waste yang boleh memakai antrean lokal; transfer/penyesuaian stok online-only. Catatan QRIS offline tidak pernah berarti settlement terverifikasi.
- Global pricing masih menunggu konfirmasi Seroo dan bukan keputusan final.
- Keputusan di dokumen ini tidak membuktikan schema/API/migration tersedia; jangan mengubah database sebelum scope implementasi disetujui.
