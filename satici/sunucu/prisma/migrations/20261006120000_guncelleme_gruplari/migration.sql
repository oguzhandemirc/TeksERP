-- GÜNCELLEME GRUPLARI (tek ortak paket O2 — docs/design/TEK-ORTAK-PAKET.md §3.1). ADDITIVE + kanal düzeni:
--   1) kanal.sira INT NULL · kanal.aktif BOOLEAN NOT NULL DEFAULT true (sütun ekler; mevcut satırlar aktif doğar)
--   2) deploy/dagitim.json grupları test · oncu · genel satırları (var olan satır EZİLMEZ; yalnız boş sira doldurulur)
--   3) grup OLMAYAN kanal satırları aktif=false (canlıda: demofabrika). Satır SİLİNMEZ (FK Restrict, defter-öncelikli).
-- DOKUNMAZ: kurulum (durum · aktif · kanalKodu · kira · kod) — iptal/pasife alma portal kararıdır, migration'ın değil.
-- Grup kümesi üç yerde aynıdır ve bekçi ölçer (scripts/check-dagitim.mjs §7): bu dosya · dagitim.json · UPDATE_GROUPS.
-- İdempotent: ikinci koşum hiçbir satırı değiştirmez.

ALTER TABLE "kanal" ADD COLUMN IF NOT EXISTS "sira" INTEGER;
ALTER TABLE "kanal" ADD COLUMN IF NOT EXISTS "aktif" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "kanal" ("id", "kod", "ad", "tur", "guncelSurumler", "sira", "aktif", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'test', 'Test', 'uretim', '{}'::jsonb, 1, true, now(), now()),
  (gen_random_uuid(), 'oncu', 'Öncü', 'uretim', '{}'::jsonb, 2, true, now(), now()),
  (gen_random_uuid(), 'genel', 'Genel', 'uretim', '{}'::jsonb, 3, true, now(), now())
ON CONFLICT ("kod") DO NOTHING;

UPDATE "kanal" SET "sira" = CASE "kod" WHEN 'test' THEN 1 WHEN 'oncu' THEN 2 WHEN 'genel' THEN 3 END, "updatedAt" = now()
WHERE "kod" IN ('test', 'oncu', 'genel') AND "sira" IS NULL;

UPDATE "kanal" SET "aktif" = false, "updatedAt" = now()
WHERE "kod" NOT IN ('test', 'oncu', 'genel') AND "aktif" = true;
