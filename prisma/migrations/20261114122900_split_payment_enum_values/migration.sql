-- Keep enum value additions in a separate migration so PostgreSQL commits them
-- before OrderPayment uses them as a column default.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SPLIT';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'BELUM_LUNAS';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'LUNAS';
