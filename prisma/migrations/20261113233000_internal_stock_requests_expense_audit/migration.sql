CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "ExpenseAuditAction" AS ENUM ('CORRECTED', 'CANCELLED');

ALTER TABLE "Expense"
ADD COLUMN "clientTransactionId" TEXT,
ADD COLUMN "payloadHash" TEXT,
ADD COLUMN "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Expense"
ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX "Expense_outletId_createdById_clientTransactionId_key"
ON "Expense"("outletId", "createdById", "clientTransactionId");

CREATE TABLE "ExpenseAudit" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "clientTransactionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "action" "ExpenseAuditAction" NOT NULL,
    "reason" TEXT,
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseAudit_outletId_actorId_clientTransactionId_key"
ON "ExpenseAudit"("outletId", "actorId", "clientTransactionId");
CREATE INDEX "ExpenseAudit_outletId_expenseId_createdAt_idx"
ON "ExpenseAudit"("outletId", "expenseId", "createdAt");

ALTER TABLE "ExpenseAudit"
ADD CONSTRAINT "ExpenseAudit_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "Expense"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseAudit"
ADD CONSTRAINT "ExpenseAudit_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseAudit"
ADD CONSTRAINT "ExpenseAudit_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OutletStockRequest" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "processedById" TEXT,
    "clientTransactionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "StockRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decisionNote" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletStockRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutletStockRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "OutletStockRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutletStockRequest_outletId_requestedById_clientTransactionId_key"
ON "OutletStockRequest"("outletId", "requestedById", "clientTransactionId");
CREATE INDEX "OutletStockRequest_outletId_status_createdAt_idx"
ON "OutletStockRequest"("outletId", "status", "createdAt");
CREATE UNIQUE INDEX "OutletStockRequestItem_requestId_inventoryItemId_key"
ON "OutletStockRequestItem"("requestId", "inventoryItemId");

ALTER TABLE "OutletStockRequest"
ADD CONSTRAINT "OutletStockRequest_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OutletStockRequest"
ADD CONSTRAINT "OutletStockRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OutletStockRequest"
ADD CONSTRAINT "OutletStockRequest_processedById_fkey"
FOREIGN KEY ("processedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OutletStockRequestItem"
ADD CONSTRAINT "OutletStockRequestItem_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "OutletStockRequest"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutletStockRequestItem"
ADD CONSTRAINT "OutletStockRequestItem_inventoryItemId_fkey"
FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
