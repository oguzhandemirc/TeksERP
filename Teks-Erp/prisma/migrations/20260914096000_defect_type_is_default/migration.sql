-- =============================================================================
-- DefectType.isDefault — VARSAYILAN hata tipi (çakılı varsayım kararı A, 2026-09-14)
-- =============================================================================
-- Tipsiz hata girişi (tablet Tambur "hata tipi seçilmedi") listenin İLKİNİ uyduruyordu;
-- artık `isDefault` olan tipe düşer, hiç yoksa yazma 400. Kurulumda en fazla BİR
-- varsayılan (partial unique). GEÇİŞ: hiç varsayılan yoksa `GENEL` kodlu tip
-- varsayılan olur — kod yoksa oluşturulur (bu literal YALNIZ burada yaşar; kod
-- kataloğu okur, literali bilmez). Geçmiş `roll_errors.defectTypeId IS NULL`
-- satırlarına DOKUNULMAZ (rapor kırılımı değişmez; tipsiz kova olarak kalır).
-- İdempotent: ikinci koşumda kolon/index vardır, INSERT/UPDATE 0 satır.
ALTER TABLE "defect_types" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "defect_types_one_default"
  ON "defect_types" ("isDefault") WHERE "isDefault" = true;

INSERT INTO "defect_types" ("id", "code", "name", "description", "isActive", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'GENEL', 'Genel', 'Varsayılan hata tipi — tipi seçilmeyen hata girişi buraya düşer', true, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "defect_types" WHERE "isDefault" = true)
  AND NOT EXISTS (SELECT 1 FROM "defect_types" WHERE "code" = 'GENEL');

UPDATE "defect_types" SET "isDefault" = true, "isActive" = true, "updatedAt" = now()
WHERE "code" = 'GENEL'
  AND NOT EXISTS (SELECT 1 FROM "defect_types" WHERE "isDefault" = true);
