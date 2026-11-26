// Reset data transaksional hasil smoke test (bukan master data).
// Aman dijalankan pada database development yang baru di-seed.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const order = [
  "orderItemAddOn",
  "orderPayment",
  "orderStatusHistory",
  "orderItem",
  "shopeeFoodOrder",
  "order",
  "shiftHandover",
  "closingAudit",
  "closingHistory",
  "closingRecord",
  "wasteRecord",
  "stockMovement",
  "expenseAudit",
  "expense",
  "lossReport",
  "outletStockRequestItem",
  "outletStockRequest",
  "stockRequestItem",
  "stockRequest",
  "cashOpening",
  "expenseAudit",
  "auditLog",
  "authSession",
  "refreshToken",
];

try {
  for (const model of order) {
    if (typeof prisma[model]?.deleteMany === "function") {
      const result = await prisma[model].deleteMany({});
      if (result.count > 0) console.log(`${model}: ${result.count} dihapus`);
    }
  }
  console.log("reset selesai");
} catch (error) {
  console.log("reset error:", error.message.replace(/\n+/g, " ").slice(0, 220));
} finally {
  await prisma.$disconnect();
}
