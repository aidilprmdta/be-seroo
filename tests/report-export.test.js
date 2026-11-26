import assert from "node:assert/strict";
import { test } from "node:test";
import { generateReportPdf, generateReportXlsx } from "../src/reports/export.js";

function createInput() {
  const report = {
    outletId: "outlet-a",
    period: { type: "DAILY", date: "2026-11-25", timezone: "Asia/Jakarta" },
    summary: {
      totalIncome: "150000",
      totalExpense: "50000",
      netBalance: "100000",
      transactionCount: 6,
      expenseCount: 2,
    },
    paymentSummary: {
      cash: { count: 4, total: "100000" },
      qris: {
        recorded: { count: 1, total: "30000" },
        pendingReconciliation: { count: 1, total: "20000" },
      },
    },
    productSales: [
      { productName: "Teh Tarik", variantName: "Medium", quantity: 6, total: "150000" },
    ],
  };
  return {
    report,
    outlet: { name: "Seroo Rumbai", code: "RMB" },
    closingRecord: { status: "CLOSED", version: 2, closedBy: { name: "Manager" } },
  };
}

test("PDF export produces a valid PDF structure with EOF marker", () => {
  const pdf = generateReportPdf(createInput());

  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.ok(pdf.includes("/Type /Catalog"));
  assert.ok(pdf.includes("Teh Tarik"));
  assert.ok(pdf.includes("CLOSED"));
  assert.ok(pdf.includes("Versi 2"));

  const startxref = pdf.lastIndexOf("startxref");
  const offset = Number(pdf.slice(startxref + 9).trim().split("\n")[0]);
  assert.ok(offset > 0 && offset < pdf.length);
});

test("XLSX export produces SpreadsheetML with escaped values", () => {
  const xlsx = generateReportXlsx(createInput());

  assert.ok(xlsx.includes("<?mso-application progid=\"Excel.Sheet\"?>"));
  assert.ok(xlsx.includes("<Worksheet"));
  assert.ok(xlsx.includes("Seroo Rumbai"));
  assert.ok(xlsx.includes("BELUM") === false);
});

test("XLSX export marks unclosed period as not final", () => {
  const input = createInput();
  input.closingRecord = null;
  const xlsx = generateReportXlsx(input);

  assert.ok(xlsx.includes("BELUM CLOSING - BUKAN LAPORAN FINAL"));
});
