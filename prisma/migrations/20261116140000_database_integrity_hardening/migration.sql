-- Seroo database hardening (PostgreSQL / Prisma 6.19.3).
-- Run prisma-final-preflight.sql first and resolve any reported rows.
-- CHECK constraints are added NOT VALID so existing rows are not scanned/blocked
-- during deployment. They are enforced for new/updated rows immediately.
-- After data cleanup, run validate-check-constraints.sql.

-- Add child-side indexes for common nested reads and foreign-key maintenance.
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItemAddOn_orderItemId_idx" ON "OrderItemAddOn"("orderItemId");

-- One history snapshot per closing version (preflight checks duplicate data).
CREATE UNIQUE INDEX IF NOT EXISTS "ClosingHistory_closingId_version_key" ON "ClosingHistory"("closingId", "version");

-- Remove redundant non-unique indexes already covered by matching unique indexes.
DROP INDEX IF EXISTS "CashOpening_outletId_periodKey_idx";
DROP INDEX IF EXISTS "ClosingRecord_outletId_closingType_periodKey_idx";
DROP INDEX IF EXISTS "ClosingHistory_closingId_version_idx";

-- CHECK constraints not expressible in Prisma Schema Language 6.x.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonnegative_check" CHECK ("price" >= 0) NOT VALID;
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_price_nonnegative_check" CHECK ("price" >= 0) NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_nonnegative_check" CHECK ("subtotal" >= 0 AND "total" >= 0) NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_idempotency_pair_check" CHECK (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL)) NOT VALID;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancellation_state_check" CHECK (("status" = 'COMPLETED' AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)) NOT VALID;
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_amount_positive_check" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_nonnegative_check" CHECK ("unitPrice" >= 0 AND "subtotal" >= 0) NOT VALID;
ALTER TABLE "OrderItemAddOn" ADD CONSTRAINT "OrderItemAddOn_quantity_positive_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "OrderItemAddOn" ADD CONSTRAINT "OrderItemAddOn_unitPrice_nonnegative_check" CHECK ("unitPrice" >= 0) NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive_check" CHECK ("amount" > 0) NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_idempotency_pair_check" CHECK (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL)) NOT VALID;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cancellation_state_check" CHECK (("status" = 'ACTIVE' AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)) NOT VALID;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_nonzero_check" CHECK ("quantity" <> 0) NOT VALID;
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_quantities_check" CHECK ("requestedQty" > 0 AND ("approvedQty" IS NULL OR "approvedQty" >= 0)) NOT VALID;
ALTER TABLE "OutletStockRequestItem" ADD CONSTRAINT "OutletStockRequestItem_quantity_positive_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_quantity_positive_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_quantity_positive_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_openingCash_nonnegative_check" CHECK ("openingCash" >= 0) NOT VALID;
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_version_positive_check" CHECK ("version" > 0) NOT VALID;
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_unfinishedCount_nonnegative_check" CHECK ("unfinishedCount" >= 0) NOT VALID;
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_cash_values_nonnegative_check" CHECK (("openingCash" IS NULL OR "openingCash" >= 0) AND ("cashSales" IS NULL OR "cashSales" >= 0) AND ("cashExpenses" IS NULL OR "cashExpenses" >= 0) AND ("actualCash" IS NULL OR "actualCash" >= 0)) NOT VALID;
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_reopen_state_check" CHECK ("status" <> 'REOPENED' OR ("reopenedById" IS NOT NULL AND "reopenedAt" IS NOT NULL)) NOT VALID;
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_idempotency_pair_check" CHECK (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL)) NOT VALID;
ALTER TABLE "ClosingHistory" ADD CONSTRAINT "ClosingHistory_version_positive_check" CHECK ("version" > 0) NOT VALID;
ALTER TABLE "ClosingHistory" ADD CONSTRAINT "ClosingHistory_unfinishedCount_nonnegative_check" CHECK ("unfinishedCount" >= 0) NOT VALID;
ALTER TABLE "ClosingAudit" ADD CONSTRAINT "ClosingAudit_version_positive_check" CHECK ("version" > 0) NOT VALID;
