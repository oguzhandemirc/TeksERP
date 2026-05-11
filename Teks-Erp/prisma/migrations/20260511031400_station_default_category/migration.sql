-- EXTERNAL istasyonlar için varsayılan fason kategorisi (örn. BOYAHANE_DIS → DYE_HOUSE).
-- WO oluştururken fason planlama modalında kategori dropdown'ı otomatik önerilir;
-- kullanıcı değiştirebilir.
ALTER TABLE "stations" ADD COLUMN "defaultCategoryId" TEXT;

ALTER TABLE "stations" ADD CONSTRAINT "stations_defaultCategoryId_fkey"
  FOREIGN KEY ("defaultCategoryId") REFERENCES "subcontractor_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stations_defaultCategoryId_idx" ON "stations"("defaultCategoryId");
