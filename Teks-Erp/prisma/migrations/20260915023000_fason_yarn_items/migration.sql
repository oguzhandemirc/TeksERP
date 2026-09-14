-- =============================================================================
-- FASON İPLİK KALEMİ — kolonlar + sedler (fason G1, 4/4 — 2026-09-15, 01)
-- =============================================================================
-- Tasarım: 1e hükmü 2026-09-15 (H1–H5): iplik kalemi `kind=YARN` (`yarnItemId`+`warehouseId`+`lotId?`,
--   `dispatchedQty` = KG), defteri `yarn_movements` `SUBCONTRACT_*` satırları `dispatchItemId` bağıyla;
--   fasondaki bakiye TÜRETİLİR (sanal depo YOK). ADDITIVE: var olan satırlara DOKUNMAZ; `kind_ref_ck`
--   DROP+ADD ile üçüncü kol alır (eski iki kol bayt bayt aynı yüklem — ROLL/WARP_BEAM satırları geçer).
-- ⚠️ İDEMPOTENT ([DB-23]): her ifade ikinci koşumda sessiz. Enum değerleri 020000/021000/022000'de doğdu.

-- ── 1) Kalem kolonları ────────────────────────────────────────────────────────
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN IF NOT EXISTS "yarnItemId"  UUID;
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN IF NOT EXISTS "warehouseId" UUID;
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN IF NOT EXISTS "lotId"       UUID;

DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items"
    ADD CONSTRAINT "subcontractor_dispatch_items_yarnItemId_fkey" FOREIGN KEY ("yarnItemId")
    REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items"
    ADD CONSTRAINT "subcontractor_dispatch_items_warehouseId_fkey" FOREIGN KEY ("warehouseId")
    REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items"
    ADD CONSTRAINT "subcontractor_dispatch_items_lotId_fkey" FOREIGN KEY ("lotId")
    REFERENCES "yarn_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_yarnItemId_idx"  ON "subcontractor_dispatch_items" ("yarnItemId");
CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_warehouseId_idx" ON "subcontractor_dispatch_items" ("warehouseId");
CREATE INDEX IF NOT EXISTS "subcontractor_dispatch_items_lotId_idx"       ON "subcontractor_dispatch_items" ("lotId");

-- Tür ↔ bağ: ROLL ⇒ yalnız top · WARP_BEAM ⇒ yalnız levent · YARN ⇒ kalem+depo (lot serbest), top/levent boş.
-- DROP+ADD: CHECK gevşetilmiyor, ÜÇÜNCÜ KOL ekleniyor; iki eski kol birebir (`test_subcontractor_dispatch_yarn §0`).
ALTER TABLE "subcontractor_dispatch_items" DROP CONSTRAINT IF EXISTS "subcontractor_dispatch_items_kind_ref_ck";
DO $$ BEGIN
  ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_kind_ref_ck" CHECK (
    ("kind" = 'ROLL'      AND "rollId" IS NOT NULL AND "warpBeamId" IS NULL AND "yarnItemId" IS NULL AND "warehouseId" IS NULL AND "lotId" IS NULL) OR
    ("kind" = 'WARP_BEAM' AND "warpBeamId" IS NOT NULL AND "rollId" IS NULL AND "yarnItemId" IS NULL AND "warehouseId" IS NULL AND "lotId" IS NULL) OR
    ("kind" = 'YARN'      AND "yarnItemId" IS NOT NULL AND "warehouseId" IS NOT NULL AND "rollId" IS NULL AND "warpBeamId" IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2) İplik defteri: fason kalem bağı ────────────────────────────────────────
ALTER TABLE "yarn_movements" ADD COLUMN IF NOT EXISTS "dispatchItemId" UUID;
DO $$ BEGIN
  ALTER TABLE "yarn_movements"
    ADD CONSTRAINT "yarn_movements_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId")
    REFERENCES "subcontractor_dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "yarn_movements_dispatchItemId_idx" ON "yarn_movements" ("dispatchItemId");

-- SUBCONTRACT_* satırı ⇔ kalem bağı (warp_link_ck ikizi, iki yönlü).
DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_fason_link_ck" CHECK (
    ("kind" IN ('SUBCONTRACT_OUT', 'SUBCONTRACT_OUT_CANCEL', 'SUBCONTRACT_RETURN', 'SUBCONTRACT_RETURN_CANCEL')) = ("dispatchItemId" IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Dönüşte sebep ZORUNLU (`defter.md:17`: iade ayrı satır + sebep kodu; katalog `YARN_SUBCONTRACT_RETURN`).
DO $$ BEGIN
  ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_fason_return_reason_ck" CHECK (
    "kind" NOT IN ('SUBCONTRACT_RETURN', 'SUBCONTRACT_RETURN_CANCEL') OR "reasonCode" IS NOT NULL
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Kalem başına TEK çıkış: ikinci SUBCONTRACT_OUT (yarış/replay) DB'de düşer; dönüş çok satır (kısmi).
CREATE UNIQUE INDEX IF NOT EXISTS "yarn_movements_subcontract_out_uq"
  ON "yarn_movements" ("dispatchItemId") WHERE "kind" = 'SUBCONTRACT_OUT';
