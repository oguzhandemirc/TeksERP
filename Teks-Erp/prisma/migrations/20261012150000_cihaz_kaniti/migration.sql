-- Cihaz kanıtı (güvenlik Bölge 5 B3): onaylı tabletin kimliği sunucunun verdiği sırla bağlanır.
-- ADDITIVE: üç null'lanabilir kolon; mevcut satırlar NULL kalır (sır ilk bağlantıda verilir).
-- Sırrın kendisi DB'de tutulmaz — yalnız tuz; sır LICENSE_DIR'deki anahtar halkasıyla türetilir.
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "proofSalt" VARCHAR(100);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "proofIssuedAt" TIMESTAMPTZ;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "proofConfirmedAt" TIMESTAMPTZ;
