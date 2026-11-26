function formatNumber(val) {
  if (val === null || val === undefined) return "0";
  const num = Math.round(Number(val));
  return num.toLocaleString("id-ID");
}

function escapeCsv(field) {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateReportCsv({ report, outlet, closingRecord }) {
  const lines = [];

  // UTF-8 BOM for Microsoft Excel auto-detection
  const BOM = "\uFEFF";

  const closingLabel = closingRecord
    ? `${closingRecord.status} (Versi ${closingRecord.version}) - Ditutup oleh ${closingRecord.closedBy?.name || "Manager"}`
    : "BELUM CLOSING - BUKAN LAPORAN FINAL";

  lines.push(["LAPORAN PENJUALAN & KEUANGAN TEH TARIK SEROO"].map(escapeCsv).join(","));
  lines.push(["Outlet", `${outlet?.name || report.outletId} (${outlet?.code || "-"})`].map(escapeCsv).join(","));
  lines.push(["Tipe Laporan", report.period.type === "DAILY" ? "Rekap Harian" : "Rekap Bulanan"].map(escapeCsv).join(","));
  lines.push(["Periode", report.period.type === "DAILY" ? report.period.date : report.period.month].map(escapeCsv).join(","));
  lines.push(["Timezone", `${report.period.timezone} (WIB)`].map(escapeCsv).join(","));
  lines.push(["Status Closing", closingLabel].map(escapeCsv).join(","));
  lines.push([]);

  // Ringkasan Keuangan
  lines.push(["RINGKASAN KEUANGAN"].map(escapeCsv).join(","));
  lines.push(["Total Pemasukan (POS)", `Rp ${formatNumber(report.summary.totalIncome)}`].map(escapeCsv).join(","));
  lines.push(["Total Pengeluaran", `Rp ${formatNumber(report.summary.totalExpense)}`].map(escapeCsv).join(","));
  lines.push(["Arus Kas Bersih (Masuk - Keluar)", `Rp ${formatNumber(report.summary.netBalance)}`].map(escapeCsv).join(","));
  lines.push(["Jumlah Transaksi Selesai", report.summary.transactionCount].map(escapeCsv).join(","));
  lines.push(["Jumlah Pengeluaran Aktif", report.summary.expenseCount].map(escapeCsv).join(","));
  lines.push([]);

  // Rincian Metode Pembayaran
  lines.push(["RINCIAN METODE PEMBAYARAN"].map(escapeCsv).join(","));
  lines.push(["Metode", "Jumlah Transaksi", "Total Nominal"].map(escapeCsv).join(","));
  lines.push(["Tunai (Cash)", report.paymentSummary.cash.count, `Rp ${formatNumber(report.paymentSummary.cash.total)}`].map(escapeCsv).join(","));
  lines.push(["QRIS (Tercatat)", report.paymentSummary.qris.recorded.count, `Rp ${formatNumber(report.paymentSummary.qris.recorded.total)}`].map(escapeCsv).join(","));
  lines.push(["QRIS (Pending Rekonsiliasi)", report.paymentSummary.qris.pendingReconciliation.count, `Rp ${formatNumber(report.paymentSummary.qris.pendingReconciliation.total)}`].map(escapeCsv).join(","));
  lines.push([]);

  // Penjualan Produk dan Ukuran
  lines.push(["PENJUALAN BERDASARKAN PRODUK DAN UKURAN"].map(escapeCsv).join(","));
  lines.push(["Nama Produk", "Ukuran/Varian", "Kuantitas Terjual", "Total Omzet"].map(escapeCsv).join(","));
  if (report.productSales && report.productSales.length > 0) {
    for (const item of report.productSales) {
      lines.push([
        item.productName,
        item.variantName,
        `${item.quantity} cup`,
        `Rp ${formatNumber(item.total)}`,
      ].map(escapeCsv).join(","));
    }
  } else {
    lines.push(["Tidak ada produk terjual pada periode ini", "-", "0", "Rp 0"].map(escapeCsv).join(","));
  }
  lines.push([]);

  // Rincian Pengeluaran
  lines.push(["RINCIAN PENGELUARAN"].map(escapeCsv).join(","));
  lines.push(["Kategori Pengeluaran", "Jumlah Catatan", "Total Nominal"].map(escapeCsv).join(","));
  if (report.expenseSummary && report.expenseSummary.categories.length > 0) {
    for (const cat of report.expenseSummary.categories) {
      lines.push([
        cat.categoryName,
        cat.count,
        `Rp ${formatNumber(cat.total)}`,
      ].map(escapeCsv).join(","));
    }
  } else {
    lines.push(["Tidak ada pengeluaran pada periode ini", "0", "Rp 0"].map(escapeCsv).join(","));
  }
  lines.push([]);

  // Daily breakdown (if monthly)
  if (report.dailyBreakdown && report.dailyBreakdown.length > 0) {
    lines.push(["REKAP HARIAN DALAM BULAN"].map(escapeCsv).join(","));
    lines.push(["Tanggal", "Jumlah Transaksi", "Pemasukan", "Pengeluaran", "Arus Bersih"].map(escapeCsv).join(","));
    for (const day of report.dailyBreakdown) {
      lines.push([
        day.date,
        day.transactionCount,
        `Rp ${formatNumber(day.totalIncome)}`,
        `Rp ${formatNumber(day.totalExpense)}`,
        `Rp ${formatNumber(day.netBalance)}`,
      ].map(escapeCsv).join(","));
    }
  }

  return BOM + lines.join("\r\n");
}

export function generateReportHtml({ report, outlet, closingRecord }) {
  const isClosed = closingRecord?.status === "CLOSED";
  const closingBadge = isClosed
    ? `<span style="background:#EBF5EE;color:#24603B;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:12px;">TELAH DITUTUP (Versi ${closingRecord.version})</span>`
    : `<span style="background:#FDF5E8;color:#895900;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:12px;">BELUM CLOSING - BUKAN LAPORAN FINAL</span>`;

  const periodLabel =
    report.period.type === "DAILY"
      ? `Harian: ${report.period.date}`
      : `Bulanan: ${report.period.month}`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Laporan Penjualan & Keuangan - Teh Tarik Seroo</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #202924; margin: 30px; font-size: 13px; line-height: 1.5; }
    h1 { margin: 0; font-size: 20px; color: #34433B; }
    .subtitle { color: #59645D; font-size: 13px; margin: 4px 0 16px 0; }
    .meta-box { border: 1px solid #D4DBD5; border-radius: 6px; padding: 12px; margin-bottom: 20px; background: #F9FAF9; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .section-title { font-size: 14px; font-weight: bold; border-bottom: 2px solid #34433B; padding-bottom: 4px; margin: 20px 0 10px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    th { background: #E9ECE9; text-align: left; padding: 8px; font-size: 12px; border: 1px solid #D4DBD5; }
    td { padding: 8px; border: 1px solid #D4DBD5; font-size: 12px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 15px; }
    .card { border: 1px solid #D4DBD5; border-radius: 6px; padding: 12px; background: #FFFFFF; }
    .card-label { font-size: 11px; color: #59645D; font-weight: bold; text-transform: uppercase; }
    .card-val { font-size: 18px; font-weight: bold; margin-top: 4px; color: #202924; }
    .green { color: #2F6B48; }
    .red { color: #A42D2D; }
    .sign-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 40px; text-align: center; }
    .sign-space { height: 60px; }
    @media print {
      body { margin: 15mm; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 15px; text-align: right;">
    <button onclick="window.print()" style="background:#34433B;color:#FFF;border:none;padding:8px 16px;border-radius:4px;font-weight:bold;cursor:pointer;">Cetak / Simpan PDF</button>
  </div>

  <div style="display:flex; justify-content:space-between; align-items:flex-start;">
    <div>
      <h1>TEH TARIK SEROO</h1>
      <div class="subtitle">Laporan Penjualan & Keuangan Resmi</div>
    </div>
    <div>${closingBadge}</div>
  </div>

  <div class="meta-box">
    <div class="meta-grid">
      <div><strong>Outlet:</strong> ${outlet?.name || report.outletId} (${outlet?.code || "-"})</div>
      <div><strong>Periode:</strong> ${periodLabel} (WIB)</div>
      <div><strong>Timezone Batas:</strong> ${report.period.timezone}</div>
      <div><strong>Keterangan Closing:</strong> ${closingRecord ? `Ditutup oleh ${closingRecord.closedBy?.name || "Manager"} pada ${new Date(closingRecord.closedAt).toLocaleString("id-ID")}` : "Belum closing"}</div>
    </div>
  </div>

  <div class="section-title">Ringkasan Keuangan</div>
  <div class="summary-grid">
    <div class="card" style="border-left: 4px solid #2F6B48;">
      <div class="card-label">Total Pemasukan (POS)</div>
      <div class="card-val green">Rp ${formatNumber(report.summary.totalIncome)}</div>
      <div style="font-size: 11px; color: #59645D; margin-top: 4px;">Dari ${report.summary.transactionCount} transaksi POS</div>
    </div>
    <div class="card" style="border-left: 4px solid #A42D2D;">
      <div class="card-label">Total Pengeluaran</div>
      <div class="card-val red">Rp ${formatNumber(report.summary.totalExpense)}</div>
      <div style="font-size: 11px; color: #59645D; margin-top: 4px;">Dari ${report.summary.expenseCount} pengeluaran</div>
    </div>
    <div class="card" style="border-left: 4px solid #34433B;">
      <div class="card-label">Arus Kas Bersih</div>
      <div class="card-val">Rp ${formatNumber(report.summary.netBalance)}</div>
      <div style="font-size: 11px; color: #59645D; margin-top: 4px;">Pemasukan - Pengeluaran</div>
    </div>
  </div>

  <div class="section-title">Rincian Penerimaan Pembayaran</div>
  <table>
    <thead>
      <tr><th>Metode Pembayaran</th><th class="text-center">Jumlah Transaksi</th><th class="text-right">Total Nominal</th></tr>
    </thead>
    <tbody>
      <tr><td>Tunai (Cash)</td><td class="text-center">${report.paymentSummary.cash.count}</td><td class="text-right">Rp ${formatNumber(report.paymentSummary.cash.total)}</td></tr>
      <tr><td>QRIS (Tercatat / Settled)</td><td class="text-center">${report.paymentSummary.qris.recorded.count}</td><td class="text-right">Rp ${formatNumber(report.paymentSummary.qris.recorded.total)}</td></tr>
      <tr><td>QRIS (Rekonsiliasi Tertunda)</td><td class="text-center">${report.paymentSummary.qris.pendingReconciliation.count}</td><td class="text-right">Rp ${formatNumber(report.paymentSummary.qris.pendingReconciliation.total)}</td></tr>
    </tbody>
  </table>

  <div class="section-title">Penjualan Berdasarkan Produk & Ukuran</div>
  <table>
    <thead>
      <tr><th>Nama Produk</th><th>Ukuran / Varian</th><th class="text-center">Kuantitas</th><th class="text-right">Total Omzet</th></tr>
    </thead>
    <tbody>
      ${
        report.productSales && report.productSales.length > 0
          ? report.productSales
              .map(
                (p) =>
                  `<tr><td>${p.productName}</td><td>${p.variantName}</td><td class="text-center">${p.quantity} cup</td><td class="text-right">Rp ${formatNumber(p.total)}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="4" class="text-center" style="font-style:italic;">Belum ada produk terjual</td></tr>`
      }
    </tbody>
  </table>

  <div class="section-title">Rincian Pengeluaran Berdasarkan Kategori</div>
  <table>
    <thead>
      <tr><th>Kategori</th><th class="text-center">Jumlah Catatan</th><th class="text-right">Total Nominal</th></tr>
    </thead>
    <tbody>
      ${
        report.expenseSummary && report.expenseSummary.categories.length > 0
          ? report.expenseSummary.categories
              .map(
                (c) =>
                  `<tr><td>${c.categoryName}</td><td class="text-center">${c.count}</td><td class="text-right">Rp ${formatNumber(c.total)}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="3" class="text-center" style="font-style:italic;">Tidak ada pengeluaran pada periode ini</td></tr>`
      }
    </tbody>
  </table>

  ${
    report.dailyBreakdown && report.dailyBreakdown.length > 0
      ? `
  <div class="section-title">Rekapitulasi Harian Bulan Ini</div>
  <table>
    <thead>
      <tr><th>Tanggal</th><th class="text-center">Transaksi</th><th class="text-right">Pemasukan</th><th class="text-right">Pengeluaran</th><th class="text-right">Arus Bersih</th></tr>
    </thead>
    <tbody>
      ${report.dailyBreakdown
        .map(
          (d) =>
            `<tr><td>${d.date}</td><td class="text-center">${d.transactionCount}</td><td class="text-right">Rp ${formatNumber(d.totalIncome)}</td><td class="text-right">Rp ${formatNumber(d.totalExpense)}</td><td class="text-right">Rp ${formatNumber(d.netBalance)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
  `
      : ""
  }

  <div class="sign-row">
    <div>
      <div>Dibuat oleh (Manager Outlet):</div>
      <div class="sign-space"></div>
      <div>( ___________________________ )</div>
    </div>
    <div>
      <div>Diverifikasi oleh (Owner / Mitra):</div>
      <div class="sign-space"></div>
      <div>( ___________________________ )</div>
    </div>
  </div>
</body>
</html>`;
}

function asciiOnly(text) {
  return String(text ?? "").replace(/[^\x20-\x7E]/g, "-");
}

function reportLines({ report, outlet, closingRecord }) {
  const closingLabel = closingRecord
    ? `${closingRecord.status} (Versi ${closingRecord.version})`
    : "BELUM CLOSING - BUKAN LAPORAN FINAL";
  const lines = [
    "LAPORAN PENJUALAN & KEUANGAN TEH TARIK SEROO",
    `Outlet   : ${outlet?.name || report.outletId} (${outlet?.code || "-"})`,
    `Tipe     : ${report.period.type === "DAILY" ? "Rekap Harian" : "Rekap Bulanan"}`,
    `Periode  : ${report.period.type === "DAILY" ? report.period.date : report.period.month}`,
    `Timezone : ${report.period.timezone} (WIB)`,
    `Closing  : ${closingLabel}`,
    "",
    "RINGKASAN KEUANGAN",
    `Total Pemasukan (POS) : Rp ${formatNumber(report.summary.totalIncome)}`,
    `Total Pengeluaran     : Rp ${formatNumber(report.summary.totalExpense)}`,
    `Arus Kas Bersih       : Rp ${formatNumber(report.summary.netBalance)}`,
    `Transaksi Selesai     : ${report.summary.transactionCount}`,
    `Pengeluaran Aktif     : ${report.summary.expenseCount}`,
    "",
    "RINCIAN METODE PEMBAYARAN",
    `Tunai (Cash)                  : ${report.paymentSummary.cash.count} transaksi, Rp ${formatNumber(report.paymentSummary.cash.total)}`,
    `QRIS (Tercatat)               : ${report.paymentSummary.qris.recorded.count} transaksi, Rp ${formatNumber(report.paymentSummary.qris.recorded.total)}`,
    `QRIS (Pending Rekonsiliasi)   : ${report.paymentSummary.qris.pendingReconciliation.count} transaksi, Rp ${formatNumber(report.paymentSummary.qris.pendingReconciliation.total)}`,
    `ShopeeFood In-App             : ${report.paymentSummary.shopeeFood?.inApp?.count ?? 0} transaksi, Rp ${formatNumber(report.paymentSummary.shopeeFood?.inApp?.total ?? 0)}`,
    `ShopeeFood COD                : ${report.paymentSummary.shopeeFood?.cod?.count ?? 0} transaksi, Rp ${formatNumber(report.paymentSummary.shopeeFood?.cod?.total ?? 0)}`,
    "",
    "PENJUALAN BERDASARKAN PRODUK DAN UKURAN",
  ];
  for (const item of report.productSales || []) {
    lines.push(
      `${item.productName} / ${item.variantName} : ${item.quantity} cup, Rp ${formatNumber(item.total)}`,
    );
  }
  return lines;
}

function escapeXml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Excel tanpa dependency: SpreadsheetML 2003 (dibuka Excel sebagai .xls).
export function generateReportXlsx({ report, outlet, closingRecord }) {
  const rows = reportLines({ report, outlet, closingRecord })
    .map((line) => {
      if (!line) return "<Row/>";
      const cells = line.split(/:(.+)/).filter((part) => part !== "").map((part, index) => {
        const isNumber = /^\s*\d+\s*$/.test(part);
        const type = isNumber && index > 0 ? "Number" : "String";
        return `<Cell><Data ss:Type="${type}">${escapeXml(part.trim())}</Data></Cell>`;
      });
      return `<Row>${cells.join("")}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Laporan"><Table>${rows}</Table></Worksheet>
</Workbook>`;
}

// PDF tanpa dependency: generator minimal (satu font, teks baris).
export function generateReportPdf({ report, outlet, closingRecord }) {
  const allLines = reportLines({ report, outlet, closingRecord }).map(asciiOnly);
  const perPage = 52;
  const pages = [];
  for (let i = 0; i < allLines.length; i += perPage) {
    pages.push(allLines.slice(i, i + perPage));
  }
  if (pages.length === 0) pages.push(["Tidak ada data."]);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const lineHeight = 14;

  const objects = {};
  const pageObjectNumbers = [];
  const contentObjectNumbers = [];
  let nextNumber = 4;
  for (let i = 0; i < pages.length; i += 1) {
    pageObjectNumbers.push(nextNumber);
    nextNumber += 1;
    contentObjectNumbers.push(nextNumber);
    nextNumber += 1;
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((lines, index) => {
    const stream = [
      "BT",
      "/F1 10 Tf",
      `1 0 0 1 ${margin} ${pageHeight - margin} Tm`,
      `${lineHeight} TL`,
      ...lines.map((line) => `(${line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) Tj T*`),
      "ET",
    ].join("\n");
    objects[contentObjectNumbers[index]] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectNumbers[index]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumbers[index]} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = {};
  const maxObject = nextNumber - 1;
  for (let n = 1; n <= maxObject; n += 1) {
    offsets[n] = Buffer.byteLength(pdf, "latin1");
    pdf += `${n} 0 obj\n${objects[n] ?? "<< >>"}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObject; n += 1) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}
