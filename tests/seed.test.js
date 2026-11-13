import assert from "node:assert/strict";
import test from "node:test";
import {
  provisionalExpenseCategories,
  seedProvisionalExpenseCategories,
} from "../prisma/seed.js";

test("seeds provisional categories idempotently without changing existing categories", async () => {
  const storedCategories = new Map([
    ["Gas", { name: "Gas", isProvisional: false }],
  ]);
  const upsertCalls = [];
  const prisma = {
    expenseCategory: {
      async upsert(args) {
        upsertCalls.push(args);
        const existing = storedCategories.get(args.where.name);
        if (existing) return existing;

        const created = { ...args.create };
        storedCategories.set(args.where.name, created);
        return created;
      },
    },
  };

  await seedProvisionalExpenseCategories(prisma);
  await seedProvisionalExpenseCategories(prisma);

  assert.equal(storedCategories.size, provisionalExpenseCategories.length);
  assert.equal(storedCategories.get("Gas").isProvisional, false);
  assert.equal(upsertCalls.length, provisionalExpenseCategories.length * 2);
  assert.deepEqual(upsertCalls[0].update, {});
  assert.ok(
    provisionalExpenseCategories
      .filter((name) => name !== "Gas")
      .every((name) => storedCategories.get(name).isProvisional),
  );
});
