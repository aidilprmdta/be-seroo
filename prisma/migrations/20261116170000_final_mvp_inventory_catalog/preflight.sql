-- Run before migration on an existing database. All result counts must be zero.
SELECT 'negative_stock_balance' AS check_name, COUNT(*) AS offending_rows
FROM "OutletStock" WHERE "quantity" < 0
UNION ALL
SELECT 'non_positive_waste_quantity', COUNT(*)
FROM "WasteRecord" WHERE "quantity" <= 0
UNION ALL
SELECT 'zero_stock_movements', COUNT(*)
FROM "StockMovement" WHERE "quantity" = 0
UNION ALL
SELECT 'non_positive_order_item_quantity', COUNT(*)
FROM "OrderItem" WHERE "quantity" <= 0
UNION ALL
SELECT 'non_positive_expense_amount', COUNT(*)
FROM "Expense" WHERE "amount" <= 0
UNION ALL
SELECT 'non_positive_payment_amount', COUNT(*)
FROM "OrderPayment" WHERE "amount" <= 0
UNION ALL
SELECT 'negative_variant_price', COUNT(*)
FROM "ProductVariant" WHERE "price" < 0
UNION ALL
SELECT 'negative_add_on_price', COUNT(*)
FROM "AddOn" WHERE "price" < 0
UNION ALL
SELECT 'negative_cash_opening', COUNT(*)
FROM "CashOpening" WHERE "openingCash" < 0;

-- This must also be zero, otherwise migration intentionally stops before RecipeItem is dropped.
SELECT COUNT(*) AS recipe_rows_to_review FROM "RecipeItem";
