-- Roll idempotency anahtarı (clientToken): sunucu-atanan SIRALI barkoda (TEKS+YYMMDD+H/F+A001..)
-- geçişle, barkod artık dedup görevini yapamaz → ağ-retry'de mükerrer top yaratılmasını
-- bu alan önler. Null-yoğun (yalnız KK1/mobil kayıtları dolu) → PARTIAL unique index.
ALTER TABLE "rolls" ADD COLUMN "clientToken" UUID;
CREATE UNIQUE INDEX "rolls_clientToken_key" ON "rolls"("clientToken") WHERE "clientToken" IS NOT NULL;
