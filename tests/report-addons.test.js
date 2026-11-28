import assert from "node:assert/strict";
import { test } from "node:test";
import { getDailyReport } from "../src/reports/service.js";

function createPrisma({ orders, expenses = [] }) {
  return {
    order: {
      async findMany() {
        return orders;
      },
    },
    expense: {
      async findMany() {
        return expenses;
      },
    },
  };
}

function order({ id, total, items, createdAt = new Date("2026-11-25T03:00:00Z") }) {
  return {
    id,
    outletId: "outlet-a",
    status: "COMPLETED",
    paymentMethod: "CASH",
    paymentStatus: "RECORDED",
    total,
    createdAt,
    payments: [],
    items,
  };
}

function item({ productName, variantName, quantity, subtotal, addOns = [] }) {
  return {
    productVariantId: `${productName}__${variantName}`,
    productName,
    variantName,
    quantity,
    subtotal,
    addOns,
  };
}

function addOn(addOnName, quantity, unitPrice = "2000.00") {
  return { addOnName, quantity, unitPrice };
}

function createExpense({ amount = "5000.00" } = {}) {
  return {
    amount,
    status: "ACTIVE",
    categoryId: "category-1",
    category: { name: "Bahan baku" },
    expenseDate: new Date("2026-11-25T02:00:00Z"),
  };
}

async function runReport(orders, expenses) {
  return getDailyReport({
    prisma: createPrisma({ orders, expenses }),
    outletId: "outlet-a",
    dateStr: "2026-11-25",
  });
}

test("topping dikalikan jumlah unit produk: qty 2 dengan topping 2 + 1 per unit", async () => {
  const result = await runReport(
    [
      order({
        id: "order-1",
        total: "20000.00",
        items: [
          item({
            productName: "Teh Tarik",
            variantName: "Medium",
            quantity: 2,
            subtotal: "20000.00",
            addOns: [addOn("Boba", 2), addOn("Jelly", 1)],
          }),
        ],
      }),
    ],
    [createExpense()],
  );

  const row = result.productSales[0];
  assert.equal(row.quantity, 2);
  assert.equal(row.addOnQuantity, 6);
  assert.equal(row.total, "20000.00");
  assert.equal(result.summary.totalIncome, "20000.00");
  assert.equal(result.summary.totalExpense, "5000.00");
  assert.equal(result.summary.netBalance, "15000.00");
  assert.equal(result.summary.transactionCount, 1);
});

test("qty 1 dengan topping 2 + 1 per unit menghasilkan 3 unit topping", async () => {
  const result = await runReport([
    order({
      id: "order-2",
      total: "10000.00",
      items: [
        item({
          productName: "Teh Tarik",
          variantName: "Medium",
          quantity: 1,
          subtotal: "10000.00",
          addOns: [addOn("Boba", 2), addOn("Jelly", 1)],
        }),
      ],
    }),
  ]);

  assert.equal(result.productSales[0].quantity, 1);
  assert.equal(result.productSales[0].addOnQuantity, 3);
  assert.equal(result.summary.totalIncome, "10000.00");
});

test("produk tanpa topping tetap 0 walaupun qty 2", async () => {
  const result = await runReport([
    order({
      id: "order-3",
      total: "20000.00",
      items: [
        item({
          productName: "Kopi Tarik",
          variantName: "Large",
          quantity: 2,
          subtotal: "20000.00",
        }),
      ],
    }),
  ]);

  assert.equal(result.productSales[0].quantity, 2);
  assert.equal(result.productSales[0].addOnQuantity, 0);
});
test("dua baris produk-varian sama dijumlahkan setelah masing-masing dikali qty", async () => {
  const result = await runReport([
    order({
      id: "order-4a",
      total: "20000.00",
      items: [
        item({
          productName: "Teh Tarik",
          variantName: "Medium",
          quantity: 2,
          subtotal: "20000.00",
          addOns: [addOn("Boba", 1)],
        }),
      ],
    }),
    order({
      id: "order-4b",
      total: "30000.00",
      createdAt: new Date("2026-11-25T04:00:00Z"),
      items: [
        item({
          productName: "Teh Tarik",
          variantName: "Medium",
          quantity: 3,
          subtotal: "30000.00",
          addOns: [addOn("Jelly", 2)],
        }),
      ],
    }),
  ]);

  assert.equal(result.productSales.length, 1);
  const row = result.productSales[0];
  assert.equal(row.quantity, 5);
  assert.equal(row.addOnQuantity, 8);
  assert.equal(result.summary.totalIncome, "50000.00");
  assert.equal(result.summary.transactionCount, 2);
});

test("produk dan varian berbeda tidak saling tercampur", async () => {
  const result = await runReport([
    order({
      id: "order-5",
      total: "45000.00",
      items: [
        item({
          productName: "Teh Tarik",
          variantName: "Medium",
          quantity: 1,
          subtotal: "15000.00",
          addOns: [addOn("Boba", 2)],
        }),
        item({
          productName: "Teh Tarik",
          variantName: "Large",
          quantity: 2,
          subtotal: "20000.00",
          addOns: [addOn("Boba", 1)],
        }),
        item({
          productName: "Kopi Tarik",
          variantName: "Medium",
          quantity: 1,
          subtotal: "10000.00",
        }),
      ],
    }),
  ]);

  assert.equal(result.productSales.length, 3);

  const tehMedium = result.productSales.find(
    (row) => row.productName === "Teh Tarik" && row.variantName === "Medium",
  );
  const tehLarge = result.productSales.find(
    (row) => row.productName === "Teh Tarik" && row.variantName === "Large",
  );
  const kopiMedium = result.productSales.find(
    (row) => row.productName === "Kopi Tarik" && row.variantName === "Medium",
  );

  assert.equal(tehMedium.quantity, 1);
  assert.equal(tehMedium.addOnQuantity, 2);
  assert.equal(tehLarge.quantity, 2);
  assert.equal(tehLarge.addOnQuantity, 2);
  assert.equal(kopiMedium.quantity, 1);
  assert.equal(kopiMedium.addOnQuantity, 0);
  assert.equal(result.summary.totalIncome, "45000.00");
});

