-- ÇUVAL İZLERİ (ETİKET) — `sack_tags` katalog + `sack_tag_assignments` bağ (2026-09-04)
--
-- ADDITIVE: yalnız İKİ YENİ TABLO + index + FK. Mevcut hiçbir tablo/kolon/satır
-- değişmez (`sacks` üzerinde `ALTER` YOK — bağ tablosu FK'yı kendi tarafında taşır).
--
-- ⚠️⚠️ O-22 TUZAĞI — BU DOSYADAN İKİ SATIR ELLE SİLİNDİ. `Sack`e ilişki eklemek
-- `migrate dev`e `rolls`/`swatches` üzerindeki DEFERRABLE composite FK'ları
-- (`*_sackId_shipmentId_consistency_fkey`) DROP ettiriyor: o iki kısıt ham SQL ile
-- kurulmuştur ve Prisma şemasında GÖRÜNMEZ, bu yüzden her diff onları "fazlalık"
-- sanır (schema.prisma `Sack.@@unique([id, shipmentId])` üstündeki DRIFT notu).
-- Üretilen çıktıdaki şu iki blok SİLİNDİ ve GERİ EKLENMEZ:
--     ALTER TABLE "rolls"    DROP CONSTRAINT "rolls_sackId_shipmentId_consistency_fkey";
--     ALTER TABLE "swatches" DROP CONSTRAINT "swatches_sackId_shipmentId_consistency_fkey";
-- Uygulanmış olsalardı "çuvalı sevkiyatta ama topu değil" tutarsızlığını kapatan
-- tek sed düşerdi. Bu dosyayı `migrate dev` ile YENİDEN ÜRETME — elle düzeltilmiştir.

-- CreateTable
CREATE TABLE "sack_tags" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "hex" VARCHAR(9) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sack_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sack_tag_assignments" (
    "id" UUID NOT NULL,
    "sackId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "createdById" UUID,
    "clearedAt" TIMESTAMPTZ,
    "clearedShipmentId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sack_tag_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sack_tags_code_key" ON "sack_tags"("code");

-- CreateIndex
CREATE INDEX "sack_tags_isActive_sortOrder_idx" ON "sack_tags"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "sack_tag_assignments_tagId_idx" ON "sack_tag_assignments"("tagId");

-- CreateIndex
CREATE INDEX "sack_tag_assignments_clearedAt_idx" ON "sack_tag_assignments"("clearedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sack_tag_assignments_sackId_tagId_key" ON "sack_tag_assignments"("sackId", "tagId");

-- AddForeignKey
ALTER TABLE "sack_tag_assignments" ADD CONSTRAINT "sack_tag_assignments_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sack_tag_assignments" ADD CONSTRAINT "sack_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "sack_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sack_tag_assignments" ADD CONSTRAINT "sack_tag_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
