import assert from "node:assert/strict";
import test from "node:test";
import { getDailyReport } from "../src/reports/service.js";

test("item yang dibatalkan tidak dihitung sebagai penjualan", async () => {
  const prisma = {
    order: {
      async findMany() {
        return [
          {
            id: "order-1",
            outletId: "outlet-a",
            status: "COMPLETED",
            paymentMethod: "CASH",
            paymentStatus: "RECORDED",
            total: "20000.00",
            createdAt: new Date("2026-11-25T03:00:00Z"),
            payments: [],
            items: [
              {
                productVariantId: "variant-medium",
                productName: "Teh Tarik",
                variantName: "Medium",
                quantity: 2,
                subtotal: "20000.00",
                addOns: [{ addOnName: "Boba", quantity: 1, unitPrice: "2000.00" }],
              },
              {
                productVariantId: "variant-large",
                productName: "Teh Tarik",
                variantName: "Large",
                quantity: 3,
                subtotal: "30000.00",
                cancelledAt: new Date("2026-11-25T04:00:00Z"),
                addOns: [{ addOnName: "Boba", quantity: 2, unitPrice: "2000.00" }],
              },
            ],
          },
        ];
      },
    },
    expense: {
      async findMany() {
        return [];
      },
    },
  };

  const report = await getDailyReport({
    prisma,
    outletId: "outlet-a",
    dateStr: "2026-11-25",
  });

  assert.equal(report.productSales.length, 1);
  assert.equal(report.productSales[0].variantName, "Medium");
  assert.equal(report.productSales[0].quantity, 2);
  assert.equal(report.productSales[0].addOnQuantity, 2);
  assert.equal(report.summary.totalIncome, "20000.00");
});
