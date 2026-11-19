-- Seroo MVP database finalization.
-- This migration is additive except for the explicitly retired RecipeItem table.
-- The RecipeItem table is dropped only when it is empty; see preflight guard below.

DO $$
DECLARE
  recipe_rows BIGINT := 0;
BEGIN
  IF to_regclass('public."RecipeItem"') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM public."RecipeItem"'
      INTO recipe_rows;

    IF recipe_rows > 0 THEN
      RAISE EXCEPTION
        'RecipeItem still contains % rows. Export/review old recipe data before migration.',
        recipe_rows;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM "OutletStock" WHERE "quantity" < 0) THEN
    RAISE EXCEPTION 'OutletStock contains negative balances.';
  END IF;

  IF EXISTS (SELECT 1 FROM "WasteRecord" WHERE "quantity" <= 0) THEN
    RAISE EXCEPTION 'WasteRecord contains zero or negative quantities.';
  END IF;

  IF EXISTS (SELECT 1 FROM "StockMovement" WHERE "quantity" = 0) THEN
    RAISE EXCEPTION 'StockMovement contains zero movements.';
  END IF;

  IF EXISTS (SELECT 1 FROM "OrderItem" WHERE "quantity" <= 0) THEN
    RAISE EXCEPTION 'OrderItem contains non-positive quantities.';
  END IF;

  IF EXISTS (SELECT 1 FROM "Expense" WHERE "amount" <= 0) THEN
    RAISE EXCEPTION 'Expense contains non-positive amounts.';
  END IF;

  IF EXISTS (SELECT 1 FROM "OrderPayment" WHERE "amount" <= 0) THEN
    RAISE EXCEPTION 'OrderPayment contains non-positive amounts.';
  END IF;

  IF EXISTS (SELECT 1 FROM "ProductVariant" WHERE "price" < 0) THEN
    RAISE EXCEPTION 'ProductVariant contains negative prices.';
  END IF;

  IF EXISTS (SELECT 1 FROM "AddOn" WHERE "price" < 0) THEN
    RAISE EXCEPTION 'AddOn contains negative prices.';
  END IF;

  IF EXISTS (SELECT 1 FROM "CashOpening" WHERE "openingCash" < 0) THEN
    RAISE EXCEPTION 'CashOpening contains negative openings.';
  END IF;
END $$;

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'LOSS';
CREATE TYPE "LossReportStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

ALTER TABLE "OutletStock"
  ADD COLUMN "minimumQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0;

ALTER TABLE "StockMovement"
  ADD COLUMN "lossReportId" TEXT,
  ADD COLUMN "expectedQuantity" DECIMAL(12,3),
  ADD COLUMN "quantityBefore" DECIMAL(12,3),
  ADD COLUMN "quantityAfter" DECIMAL(12,3);

CREATE TABLE "OutletProductAvailability" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutletProductAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LossReport" (
  "id" TEXT NOT NULL,
  "outletId" TEXT NOT NULL,
  "reportedById" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "description" TEXT,
  "status" "LossReportStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LossReport_pkey" PRIMARY KEY ("id")
);

-- Recipe/takaran management is outside the agreed MVP scope.
DROP TABLE IF EXISTS "RecipeItem";

CREATE UNIQUE INDEX "OutletProductAvailability_outletId_productId_key"
  ON "OutletProductAvailability"("outletId", "productId");
CREATE INDEX "OutletProductAvailability_outletId_isAvailable_idx"
  ON "OutletProductAvailability"("outletId", "isAvailable");
CREATE UNIQUE INDEX "StockMovement_lossReportId_key"
  ON "StockMovement"("lossReportId");
CREATE INDEX "LossReport_outletId_status_createdAt_idx"
  ON "LossReport"("outletId", "status", "createdAt");
CREATE INDEX "LossReport_outletId_inventoryItemId_createdAt_idx"
  ON "LossReport"("outletId", "inventoryItemId", "createdAt");

ALTER TABLE "OutletProductAvailability"
  ADD CONSTRAINT "OutletProductAvailability_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletProductAvailability"
  ADD CONSTRAINT "OutletProductAvailability_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutletProductAvailability"
  ADD CONSTRAINT "OutletProductAvailability_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LossReport"
  ADD CONSTRAINT "LossReport_outletId_fkey"
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossReport"
  ADD CONSTRAINT "LossReport_reportedById_fkey"
  FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossReport"
  ADD CONSTRAINT "LossReport_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossReport"
  ADD CONSTRAINT "LossReport_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_lossReportId_fkey"
  FOREIGN KEY ("lossReportId") REFERENCES "LossReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-enforced business invariants.
-- Several constraints below already exist from the previous
-- database_integrity_hardening migration. Do not recreate them.

ALTER TABLE "OutletStock"
  ADD CONSTRAINT "OutletStock_quantity_nonnegative_check"
    CHECK ("quantity" >= 0),
  ADD CONSTRAINT "OutletStock_minimumQuantity_nonnegative_check"
    CHECK ("minimumQuantity" >= 0);

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_expectedQuantity_positive_check"
    CHECK (
      "expectedQuantity" IS NULL
      OR ("type" = 'IN' AND "expectedQuantity" > 0)
    ),
  ADD CONSTRAINT "StockMovement_quantity_snapshot_check"
    CHECK (
      ("quantityBefore" IS NULL AND "quantityAfter" IS NULL)
      OR (
        "quantityBefore" IS NOT NULL
        AND "quantityAfter" IS NOT NULL
        AND "quantityBefore" >= 0
        AND "quantityAfter" >= 0
        AND "quantityAfter" - "quantityBefore" = "quantity"
      )
    );

ALTER TABLE "LossReport"
  ADD CONSTRAINT "LossReport_quantity_positive_check"
    CHECK ("quantity" > 0);