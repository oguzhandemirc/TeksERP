-- D2b (D4-SEMA; D4-D2 kalanı): gelen belge PROCESS eşlemesi ÖZELLİK KAPSAMI taşır — aynı ham metin farklı
-- özellikte farklı değere eşlenebilsin. Mevcut satırlar propertyId NULL (kapsamsız) kalır: bugünkü davranış.
-- ADDITIVE + tekillik genişler: yeni anahtar (scope, gönderen, özellik, metin) NULLS NOT DISTINCT (E4 emsali).
-- Eski 3'lü anahtar altında tekil olan veri yeni 4'lü anahtarda da tekildir (propertyId hep NULL) — ön denetim gerekmez.

ALTER TABLE "delivery_note_aliases" ADD COLUMN IF NOT EXISTS "propertyId" UUID;

CREATE INDEX IF NOT EXISTS "delivery_note_aliases_propertyId_idx" ON "delivery_note_aliases"("propertyId");

DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_note_aliases_propertyId_fkey') THEN
    ALTER TABLE "delivery_note_aliases" ADD CONSTRAINT "delivery_note_aliases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Özellik kapsamı yalnız işlem (PROCESS) sözlüğünde anlamlı.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_note_aliases_property_scope_ck') THEN
    ALTER TABLE "delivery_note_aliases" ADD CONSTRAINT "delivery_note_aliases_property_scope_ck" CHECK ("propertyId" IS NULL OR "scope" = 'PROCESS');
  END IF;
END $fk$;

-- Yeni anahtar ÖNCE kurulur, eski SONRA düşer (arada tekilsiz an olmaz). Ad Prisma'nın 63 karakterlik kesimiyle aynı.
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_note_aliases_scope_senderCustomerId_propertyId_raw_key"
  ON "delivery_note_aliases"("scope", "senderCustomerId", "propertyId", "rawKey") NULLS NOT DISTINCT;
DROP INDEX IF EXISTS "delivery_note_aliases_scope_senderCustomerId_rawKey_key";
