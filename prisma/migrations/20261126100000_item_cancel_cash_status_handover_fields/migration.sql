-- Fitur: pembatalan per item, status investigasi selisih kas, field serah terima terpisah,
-- metode pembayaran ShopeeFood (In-App/COD).

-- 1) Metode pembayaran ShopeeFood
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SHOPEEFOOD_IN_APP';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SHOPEEFOOD_COD';

-- 2) Status investigasi selisih kas
CREATE TYPE "CashDifferenceStatus" AS ENUM (
  'BELUM_DIPERIKSA',
  'SEDANG_DIPERIKSA',
  'SUDAH_DIKETAHUI',
  'BELUM_TERSELESAIKAN'
);

ALTER TABLE "ClosingRecord"
  ADD COLUMN "cashDifferenceStatus" "CashDifferenceStatus" NOT NULL DEFAULT 'BELUM_DIPERIKSA',
  ADD COLUMN "cashDifferenceReviewedAt" TIMESTAMP(3),
  ADD COLUMN "cashDifferenceReviewedById" TEXT,
  ADD COLUMN "cashDifferenceReviewNote" TEXT;

-- 3) Pembatalan per item (item tidak dihapus, hanya ditandai)
ALTER TABLE "OrderItem"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

-- 4) Field serah terima terpisah
ALTER TABLE "ShiftHandover"
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "cashHandover" TEXT,
  ADD COLUMN "checklistAgenda" TEXT,
  ADD COLUMN "checklistService" TEXT;
