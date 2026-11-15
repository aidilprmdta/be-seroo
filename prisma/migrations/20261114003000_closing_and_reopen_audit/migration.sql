CREATE TYPE "ClosingType" AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE "ClosingStatus" AS ENUM ('CLOSED', 'REOPENED');
CREATE TYPE "ClosingAuditAction" AS ENUM ('CLOSED', 'REOPENED', 'RECLOSED');

CREATE TABLE "ClosingRecord" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "closingType" "ClosingType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "ClosingStatus" NOT NULL DEFAULT 'CLOSED',
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "summarySnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "unfinishedCount" INTEGER NOT NULL DEFAULT 0,
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosingRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClosingRecord_outletId_closingType_periodKey_key"
ON "ClosingRecord"("outletId", "closingType", "periodKey");

CREATE UNIQUE INDEX "ClosingRecord_outletId_closedById_clientTransactionId_key"
ON "ClosingRecord"("outletId", "closedById", "clientTransactionId");

CREATE INDEX "ClosingRecord_outletId_closingType_periodKey_idx"
ON "ClosingRecord"("outletId", "closingType", "periodKey");

CREATE TABLE "ClosingHistory" (
    "id" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "summarySnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "unfinishedCount" INTEGER NOT NULL DEFAULT 0,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosingHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClosingHistory_closingId_version_idx"
ON "ClosingHistory"("closingId", "version");

CREATE TABLE "ClosingAudit" (
    "id" TEXT NOT NULL,
    "closingId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "clientTransactionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "action" "ClosingAuditAction" NOT NULL,
    "reason" TEXT,
    "version" INTEGER NOT NULL,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosingAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClosingAudit_outletId_actorId_clientTransactionId_key"
ON "ClosingAudit"("outletId", "actorId", "clientTransactionId");

CREATE INDEX "ClosingAudit_outletId_closingId_createdAt_idx"
ON "ClosingAudit"("outletId", "closingId", "createdAt");

ALTER TABLE "ClosingRecord"
ADD CONSTRAINT "ClosingRecord_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingRecord"
ADD CONSTRAINT "ClosingRecord_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingRecord"
ADD CONSTRAINT "ClosingRecord_reopenedById_fkey"
FOREIGN KEY ("reopenedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingHistory"
ADD CONSTRAINT "ClosingHistory_closingId_fkey"
FOREIGN KEY ("closingId") REFERENCES "ClosingRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosingHistory"
ADD CONSTRAINT "ClosingHistory_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingAudit"
ADD CONSTRAINT "ClosingAudit_closingId_fkey"
FOREIGN KEY ("closingId") REFERENCES "ClosingRecord"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingAudit"
ADD CONSTRAINT "ClosingAudit_outletId_fkey"
FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClosingAudit"
ADD CONSTRAINT "ClosingAudit_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

