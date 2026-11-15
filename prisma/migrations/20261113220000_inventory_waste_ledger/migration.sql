ALTER TABLE "StockMovement"
ADD COLUMN "clientTransactionId" TEXT,
ADD COLUMN "payloadHash" TEXT;

CREATE UNIQUE INDEX "StockMovement_outletId_createdById_clientTransactionId_key"
ON "StockMovement"("outletId", "createdById", "clientTransactionId");

ALTER TABLE "WasteRecord"
ADD COLUMN "clientTransactionId" TEXT,
ADD COLUMN "payloadHash" TEXT;

CREATE UNIQUE INDEX "WasteRecord_outletId_createdById_clientTransactionId_key"
ON "WasteRecord"("outletId", "createdById", "clientTransactionId");
