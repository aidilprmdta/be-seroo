-- Outlet ownership classification (P0).
-- Additive: adds nullable columns, enum, FKs, indexes, and a CHECK constraint.
-- Backfill only the verified central outlet (SR-RUMBAI). Other outlets stay NULL.

-- CreateEnum
CREATE TYPE "OutletOwnershipType" AS ENUM ('PUSAT', 'MITRA');

-- AlterTable
ALTER TABLE "Outlet"
  ADD COLUMN "ownershipType" "OutletOwnershipType",
  ADD COLUMN "ownerUserId" TEXT,
  ADD COLUMN "ownershipAssignedAt" TIMESTAMP(3),
  ADD COLUMN "ownershipAssignedById" TEXT;

-- AddForeignKey
ALTER TABLE "Outlet"
  ADD CONSTRAINT "Outlet_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Outlet"
  ADD CONSTRAINT "Outlet_ownershipAssignedById_fkey"
  FOREIGN KEY ("ownershipAssignedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Outlet_ownershipType_isActive_idx"
  ON "Outlet"("ownershipType", "isActive");

CREATE INDEX "Outlet_ownerUserId_idx"
  ON "Outlet"("ownerUserId");

-- Aggregate query support for the central report.
CREATE INDEX "Order_outletId_status_createdAt_idx"
  ON "Order"("outletId", "status", "createdAt");

-- Ownership invariant. NOT VALID so deployment is not blocked by legacy rows;
-- it is enforced for new/updated rows immediately and validated after backfill.
ALTER TABLE "Outlet"
  ADD CONSTRAINT "Outlet_ownership_check" CHECK (
    ("ownershipType" IS NULL AND "ownerUserId" IS NULL)
    OR (
      "ownershipType" IS NOT NULL
      AND (
        ("ownershipType" = 'PUSAT' AND "ownerUserId" IS NULL)
        OR ("ownershipType" = 'MITRA' AND "ownerUserId" IS NOT NULL)
      )
    )
  ) NOT VALID;

-- Backfill the verified central pilot outlet. The code is unique in the schema/seed.
-- ownershipAssignedById intentionally NULL because the acting user is not known.
UPDATE "Outlet"
SET
  "ownershipType" = 'PUSAT',
  "ownerUserId" = NULL,
  "ownershipAssignedAt" = CURRENT_TIMESTAMP,
  "ownershipAssignedById" = NULL
WHERE "code" = 'SR-RUMBAI';

ALTER TABLE "Outlet" VALIDATE CONSTRAINT "Outlet_ownership_check";
