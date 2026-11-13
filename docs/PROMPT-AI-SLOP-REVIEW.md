# Prompt: Backend AI Slop Review (Read-only)

```text
Gunakan skill $seroo-backend-ai-quality-review.
Review backend Seroo secara READ-ONLY. Jangan mengubah file.

Cari implementasi palsu atau setengah jadi: endpoint selalu success, fake persistence, dummy data pada runtime path, tombol/aksi yang tidak punya backend behavior, mock yang terlihat seperti data produksi, catch kosong, error yang disembunyikan, TODO yang melewati security, duplikasi aturan harga/otorisasi, route/service terlalu besar, abstraksi berlebihan, dependency tidak perlu, query tanpa pagination/batas, raw body diteruskan ke Prisma, angka laporan yang difabrikasi, dan dokumentasi yang tidak sesuai kode.

Cocokkan implementasi dengan keputusan Seroo: multi-outlet via membership, pengeluaran Manager saja, waste dapat dicatat Crew dan Manager, transaksi POS menjadi sumber penjualan, CASH/QRIS hanya metode tercatat, tidak ada integrasi Majo/payment gateway/ShopeeFood, serta jangan klaim net profit tanpa formula yang disetujui.

Tulis file:baris, bukti, risiko, severity, dan perbaikan terkecil. Bedakan bug nyata dari preferensi gaya. Jangan rewrite seluruh backend.
```
