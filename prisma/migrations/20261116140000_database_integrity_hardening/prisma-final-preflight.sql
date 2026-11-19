-- Run before applying migration.sql. Every invalid_rows value must be zero.

SELECT 'ProductVariant_price_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ProductVariant" WHERE NOT ("price" >= 0)
UNION ALL
SELECT 'AddOn_price_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "AddOn" WHERE NOT ("price" >= 0)
UNION ALL
SELECT 'Order_amounts_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Order" WHERE NOT ("subtotal" >= 0 AND "total" >= 0)
UNION ALL
SELECT 'Order_idempotency_pair_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Order" WHERE NOT (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL))
UNION ALL
SELECT 'Order_cancellation_state_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Order" WHERE NOT (("status" = 'COMPLETED' AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL))
UNION ALL
SELECT 'OrderPayment_amount_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OrderPayment" WHERE NOT ("amount" > 0)
UNION ALL
SELECT 'OrderItem_quantity_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OrderItem" WHERE NOT ("quantity" > 0)
UNION ALL
SELECT 'OrderItem_amounts_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OrderItem" WHERE NOT ("unitPrice" >= 0 AND "subtotal" >= 0)
UNION ALL
SELECT 'OrderItemAddOn_quantity_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OrderItemAddOn" WHERE NOT ("quantity" > 0)
UNION ALL
SELECT 'OrderItemAddOn_unitPrice_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OrderItemAddOn" WHERE NOT ("unitPrice" >= 0)
UNION ALL
SELECT 'Expense_amount_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Expense" WHERE NOT ("amount" > 0)
UNION ALL
SELECT 'Expense_idempotency_pair_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Expense" WHERE NOT (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL))
UNION ALL
SELECT 'Expense_cancellation_state_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "Expense" WHERE NOT (("status" = 'ACTIVE' AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL))
UNION ALL
SELECT 'StockMovement_quantity_nonzero_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "StockMovement" WHERE NOT ("quantity" <> 0)
UNION ALL
UNION ALL
SELECT 'StockRequestItem_quantities_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "StockRequestItem" WHERE NOT ("requestedQty" > 0 AND ("approvedQty" IS NULL OR "approvedQty" >= 0))
UNION ALL
SELECT 'OutletStockRequestItem_quantity_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "OutletStockRequestItem" WHERE NOT ("quantity" > 0)
UNION ALL
SELECT 'RecipeItem_quantity_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "RecipeItem" WHERE NOT ("quantity" > 0)
UNION ALL
SELECT 'WasteRecord_quantity_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "WasteRecord" WHERE NOT ("quantity" > 0)
UNION ALL
UNION ALL
SELECT 'CashOpening_openingCash_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "CashOpening" WHERE NOT ("openingCash" >= 0)
UNION ALL
SELECT 'ClosingRecord_version_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingRecord" WHERE NOT ("version" > 0)
UNION ALL
SELECT 'ClosingRecord_unfinishedCount_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingRecord" WHERE NOT ("unfinishedCount" >= 0)
UNION ALL
SELECT 'ClosingRecord_cash_values_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingRecord" WHERE NOT (("openingCash" IS NULL OR "openingCash" >= 0) AND ("cashSales" IS NULL OR "cashSales" >= 0) AND ("cashExpenses" IS NULL OR "cashExpenses" >= 0) AND ("actualCash" IS NULL OR "actualCash" >= 0))
UNION ALL
SELECT 'ClosingRecord_reopen_state_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingRecord" WHERE NOT ("status" <> 'REOPENED' OR ("reopenedById" IS NOT NULL AND "reopenedAt" IS NOT NULL))
UNION ALL
SELECT 'ClosingRecord_idempotency_pair_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingRecord" WHERE NOT (("clientTransactionId" IS NULL) = ("payloadHash" IS NULL))
UNION ALL
SELECT 'ClosingHistory_version_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingHistory" WHERE NOT ("version" > 0)
UNION ALL
SELECT 'ClosingHistory_unfinishedCount_nonnegative_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingHistory" WHERE NOT ("unfinishedCount" >= 0)
UNION ALL
SELECT 'ClosingAudit_version_positive_check' AS rule, COUNT(*)::bigint AS invalid_rows FROM "ClosingAudit" WHERE NOT ("version" > 0)
UNION ALL
SELECT 'ClosingHistory_closingId_version_key_duplicates' AS rule,
       COUNT(*)::bigint AS invalid_rows
FROM (
  SELECT "closingId", "version"
  FROM "ClosingHistory"
  GROUP BY "closingId", "version"
  HAVING COUNT(*) > 1
) AS duplicates;
