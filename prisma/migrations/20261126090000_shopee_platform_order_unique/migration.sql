-- Mencegah nomor pesanan platform yang sama diinput dua kali oleh crew berbeda.
-- Replay order yang sama tetap aman: createOrder menemukan order lama lewat
-- clientTransactionId (= platformOrderId) sebelum sampai ke insert ini.
CREATE UNIQUE INDEX "ShopeeFoodOrder_platformOrderId_key"
  ON "ShopeeFoodOrder"("platformOrderId");
