-- İE ayrımı (2026-11-23): özel dokuma iş emri şablonu — "Dokuma İş Emri oluştur" › Özel.
-- YALNIZ EKLEME: yeni katalog tablosu `weaving_order_templates`; var olan tabloya dokunulmaz.
-- Şablon yalnız formu ön-doldurur, iş emri şablona bağlanmaz. FK'lar RESTRICT (sil = isActive=false).

-- CreateTable
CREATE TABLE IF NOT EXISTS "weaving_order_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "itemId" UUID,
    "executionKind" "WeavingExecutionKind",
    "subcontractorId" UUID,
    "plannedM" DECIMAL(12,3),
    "notes" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weaving_order_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "weaving_order_templates_itemId_idx" ON "weaving_order_templates"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "weaving_order_templates_subcontractorId_idx" ON "weaving_order_templates"("subcontractorId");

-- AddForeignKey
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weaving_order_templates_itemId_fkey') THEN
    ALTER TABLE "weaving_order_templates" ADD CONSTRAINT "weaving_order_templates_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weaving_order_templates_subcontractorId_fkey') THEN
    ALTER TABLE "weaving_order_templates" ADD CONSTRAINT "weaving_order_templates_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $fk$;
