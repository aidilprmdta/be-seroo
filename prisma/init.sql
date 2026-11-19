-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN_PUSAT', 'OWNER_MITRA', 'OWNER', 'MANAGER', 'CREW');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QRIS', 'SPLIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'PENDING_RECONCILIATION', 'BELUM_LUNAS', 'LUNAS', 'REFUNDED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'WASTE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOSS');

-- CreateEnum
CREATE TYPE "LossReportStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseAuditAction" AS ENUM ('CORRECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClosingType" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ClosingAuditAction" AS ENUM ('CLOSED', 'REOPENED', 'RECLOSED');

-- CreateEnum
CREATE TYPE "UserPasswordActivity" AS ENUM ('ADMIN_RESET', 'SELF_CHANGE');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPasswordAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "activity" "UserPasswordActivity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPasswordAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "sessionId" TEXT,
    "outletId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'COMPLETED',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "isWasteRecorded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus" NOT NULL,
    "toStatus" "OrderStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'LUNAS',
    "notes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemAddOn" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "addOnId" TEXT,
    "addOnName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItemAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletStock" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimumQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "lossReportId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "expectedQuantity" DECIMAL(12,3),
    "quantityBefore" DECIMAL(12,3),
    "quantityAfter" DECIMAL(12,3),
    "note" TEXT,
    "referenceCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "sourceOutletId" TEXT NOT NULL,
    "destinationOutletId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "processedById" TEXT,
    "status" "StockRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestItem" (
    "id" TEXT NOT NULL,
    "stockRequestId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "requestedQty" DECIMAL(12,3) NOT NULL,
    "approvedQty" DECIMAL(12,3),

    CONSTRAINT "StockRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "OutletStockRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "OutletStockRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteRecord" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "inventoryItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "description" TEXT,
    "wasteDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WasteRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "CashOpening" (
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

-- CreateTable
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
    "openingCash" DECIMAL(12,2),
    "cashSales" DECIMAL(12,2),
    "cashExpenses" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2),
    "actualCash" DECIMAL(12,2),
    "cashDifference" DECIMAL(12,2),
    "differenceReason" TEXT,
    "clientTransactionId" TEXT,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserPasswordAudit_actorUserId_createdAt_idx" ON "UserPasswordAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "UserPasswordAudit_targetUserId_createdAt_idx" ON "UserPasswordAudit"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_outletId_createdAt_idx" ON "AuditLog"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_action_createdAt_idx" ON "AuditLog"("resourceType", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_lastSeenAt_idx" ON "AuthSession"("userId", "revokedAt", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_usedAt_idx" ON "RefreshToken"("sessionId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_code_key" ON "Outlet"("code");

-- CreateIndex
CREATE INDEX "OutletMembership_outletId_role_idx" ON "OutletMembership"("outletId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OutletMembership_userId_outletId_key" ON "OutletMembership"("userId", "outletId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_name_key" ON "ProductVariant"("productId", "name");

-- CreateIndex
CREATE INDEX "Order_outletId_createdAt_idx" ON "Order"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_crewId_idx" ON "Order"("crewId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_outletId_orderNumber_key" ON "Order"("outletId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_outletId_crewId_clientTransactionId_key" ON "Order"("outletId", "crewId", "clientTransactionId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE INDEX "Expense_outletId_expenseDate_idx" ON "Expense"("outletId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_outletId_createdById_clientTransactionId_key" ON "Expense"("outletId", "createdById", "clientTransactionId");

-- CreateIndex
CREATE INDEX "ExpenseAudit_outletId_expenseId_createdAt_idx" ON "ExpenseAudit"("outletId", "expenseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAudit_outletId_actorId_clientTransactionId_key" ON "ExpenseAudit"("outletId", "actorId", "clientTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletStock_outletId_inventoryItemId_key" ON "OutletStock"("outletId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "StockMovement_outletId_inventoryItemId_createdAt_idx" ON "StockMovement"("outletId", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_outletId_createdById_clientTransactionId_key" ON "StockMovement"("outletId", "createdById", "clientTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequestItem_stockRequestId_inventoryItemId_key" ON "StockRequestItem"("stockRequestId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "OutletStockRequest_outletId_status_createdAt_idx" ON "OutletStockRequest"("outletId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutletStockRequest_outletId_requestedById_clientTransaction_key" ON "OutletStockRequest"("outletId", "requestedById", "clientTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletStockRequestItem_requestId_inventoryItemId_key" ON "OutletStockRequestItem"("requestId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletProductAvailability_outletId_productId_key" ON "OutletProductAvailability"("outletId", "productId");

-- CreateIndex
CREATE INDEX "OutletProductAvailability_outletId_isAvailable_idx" ON "OutletProductAvailability"("outletId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_lossReportId_key" ON "StockMovement"("lossReportId");

-- CreateIndex
CREATE INDEX "LossReport_outletId_status_createdAt_idx" ON "LossReport"("outletId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LossReport_outletId_inventoryItemId_createdAt_idx" ON "LossReport"("outletId", "inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "WasteRecord_outletId_wasteDate_idx" ON "WasteRecord"("outletId", "wasteDate");

-- CreateIndex
CREATE UNIQUE INDEX "WasteRecord_outletId_createdById_clientTransactionId_key" ON "WasteRecord"("outletId", "createdById", "clientTransactionId");

-- CreateIndex
CREATE INDEX "CashOpening_outletId_periodKey_idx" ON "CashOpening"("outletId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashOpening_outletId_periodKey_key" ON "CashOpening"("outletId", "periodKey");

-- CreateIndex
CREATE INDEX "ClosingRecord_outletId_closingType_periodKey_idx" ON "ClosingRecord"("outletId", "closingType", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClosingRecord_outletId_closingType_periodKey_key" ON "ClosingRecord"("outletId", "closingType", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClosingRecord_outletId_closedById_clientTransactionId_key" ON "ClosingRecord"("outletId", "closedById", "clientTransactionId");

-- CreateIndex
CREATE INDEX "ClosingHistory_closingId_version_idx" ON "ClosingHistory"("closingId", "version");

-- CreateIndex
CREATE INDEX "ClosingAudit_outletId_closingId_createdAt_idx" ON "ClosingAudit"("outletId", "closingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClosingAudit_outletId_actorId_clientTransactionId_key" ON "ClosingAudit"("outletId", "actorId", "clientTransactionId");

-- AddForeignKey
ALTER TABLE "UserPasswordAudit" ADD CONSTRAINT "UserPasswordAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPasswordAudit" ADD CONSTRAINT "UserPasswordAudit_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletMembership" ADD CONSTRAINT "OutletMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletMembership" ADD CONSTRAINT "OutletMembership_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAddOn" ADD CONSTRAINT "OrderItemAddOn_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAddOn" ADD CONSTRAINT "OrderItemAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "AddOn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAudit" ADD CONSTRAINT "ExpenseAudit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAudit" ADD CONSTRAINT "ExpenseAudit_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAudit" ADD CONSTRAINT "ExpenseAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStock" ADD CONSTRAINT "OutletStock_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStock" ADD CONSTRAINT "OutletStock_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_sourceOutletId_fkey" FOREIGN KEY ("sourceOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_destinationOutletId_fkey" FOREIGN KEY ("destinationOutletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_stockRequestId_fkey" FOREIGN KEY ("stockRequestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStockRequest" ADD CONSTRAINT "OutletStockRequest_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStockRequest" ADD CONSTRAINT "OutletStockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStockRequest" ADD CONSTRAINT "OutletStockRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStockRequestItem" ADD CONSTRAINT "OutletStockRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "OutletStockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletStockRequestItem" ADD CONSTRAINT "OutletStockRequestItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProductAvailability" ADD CONSTRAINT "OutletProductAvailability_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProductAvailability" ADD CONSTRAINT "OutletProductAvailability_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletProductAvailability" ADD CONSTRAINT "OutletProductAvailability_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReport" ADD CONSTRAINT "LossReport_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReport" ADD CONSTRAINT "LossReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReport" ADD CONSTRAINT "LossReport_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossReport" ADD CONSTRAINT "LossReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lossReportId_fkey" FOREIGN KEY ("lossReportId") REFERENCES "LossReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingRecord" ADD CONSTRAINT "ClosingRecord_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingHistory" ADD CONSTRAINT "ClosingHistory_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "ClosingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingHistory" ADD CONSTRAINT "ClosingHistory_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingAudit" ADD CONSTRAINT "ClosingAudit_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "ClosingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingAudit" ADD CONSTRAINT "ClosingAudit_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosingAudit" ADD CONSTRAINT "ClosingAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Data integrity constraints (PostgreSQL)
ALTER TABLE "OutletStock" ADD CONSTRAINT "OutletStock_quantity_nonnegative_check" CHECK ("quantity" >= 0);
ALTER TABLE "OutletStock" ADD CONSTRAINT "OutletStock_minimumQuantity_nonnegative_check" CHECK ("minimumQuantity" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_nonzero_check" CHECK ("quantity" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_expectedQuantity_positive_check" CHECK ("expectedQuantity" IS NULL OR ("type" = 'IN' AND "expectedQuantity" > 0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_snapshot_check" CHECK (
  ("quantityBefore" IS NULL AND "quantityAfter" IS NULL)
  OR (
    "quantityBefore" IS NOT NULL AND "quantityAfter" IS NOT NULL
    AND "quantityBefore" >= 0 AND "quantityAfter" >= 0
    AND "quantityAfter" - "quantityBefore" = "quantity"
  )
);
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "LossReport" ADD CONSTRAINT "LossReport_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive_check" CHECK ("quantity" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_nonnegative_check" CHECK ("price" >= 0);
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_price_nonnegative_check" CHECK ("price" >= 0);
ALTER TABLE "CashOpening" ADD CONSTRAINT "CashOpening_openingCash_nonnegative_check" CHECK ("openingCash" >= 0);
