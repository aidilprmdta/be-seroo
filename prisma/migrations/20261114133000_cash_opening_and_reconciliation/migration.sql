-- CreateTable
CREATE TABLE IF NOT EXISTS "CashOpening" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashOpening_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "openingCash" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "cashSales" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "cashExpenses" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "expectedCash" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "actualCash" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "cashDifference" DECIMAL(12,2);
ALTER TABLE "ClosingRecord" ADD COLUMN IF NOT EXISTS "differenceReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CashOpening_outletId_periodKey_key" ON "CashOpening"("outletId", "periodKey");
CREATE INDEX IF NOT EXISTS "CashOpening_outletId_periodKey_idx" ON "CashOpening"("outletId", "periodKey");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CashOpening_outletId_fkey'
    ) THEN
        ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CashOpening_openedById_fkey'
    ) THEN
        ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

