-- =============================================================================
-- EMANET MÜLKİYET KOLONU — `ownerCustomerId` (warp_beams · yarn_lots · rolls) + köken CHECK (G3, 3/3)
-- =============================================================================
-- Hüküm 1e 2026-09-15 (E1–E5): sahiplik bir DOĞUM niteliğidir (ayrı defter yok, sahiplik değişimi =
--   yeni doğum); mülkiyet ekseni köken ekseninden BAĞIMSIZ (iki kolon). CONSIGNED ⇒ owner ZORUNLU ∧
--   supplier/subcontractor NULL; öteki kökenlerde owner SERBEST (müşteri ipliğiyle fasona sardırılan levent).
-- ADDITIVE: var olan satırlar NULL (= bizim mal, bugünkü davranış). `emanet.enabled` kapalıyken owner
--   YAZILAMAZ (servis 403) ⇒ hiç satır doğmaz ⇒ sevk kapısı hiç ısırmaz. İDEMPOTENT.
ALTER TABLE "warp_beams" ADD COLUMN IF NOT EXISTS "ownerCustomerId" UUID;
ALTER TABLE "yarn_lots"  ADD COLUMN IF NOT EXISTS "ownerCustomerId" UUID;
ALTER TABLE "rolls"      ADD COLUMN IF NOT EXISTS "ownerCustomerId" UUID;

DO $$ BEGIN
  ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId")
    REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId")
    REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "rolls" ADD CONSTRAINT "rolls_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId")
    REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "warp_beams_ownerCustomerId_idx" ON "warp_beams" ("ownerCustomerId");
CREATE INDEX IF NOT EXISTS "yarn_lots_ownerCustomerId_idx"  ON "yarn_lots"  ("ownerCustomerId");
CREATE INDEX IF NOT EXISTS "rolls_ownerCustomerId_idx"      ON "rolls"      ("ownerCustomerId");

-- Köken XOR'u DÖRT KOL — üç eski kol bayt bayt (test_emanet §0), CONSIGNED kolu eklendi.
-- Birincil doğrulama `resolveOriginParty` (Türkçe 400); CHECK ikinci hat.
ALTER TABLE "warp_beams" DROP CONSTRAINT IF EXISTS "warp_beams_origin_party_ck";
DO $$ BEGIN
  ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_origin_party_ck" CHECK (
  ("originKind" = 'IN_HOUSE'    AND "subcontractorId" IS NULL     AND "supplierId" IS NULL) OR
  ("originKind" = 'SUBCONTRACT' AND "subcontractorId" IS NOT NULL AND "supplierId" IS NULL) OR
  ("originKind" = 'PURCHASED'   AND (("subcontractorId" IS NULL) <> ("supplierId" IS NULL))) OR
  ("originKind" = 'CONSIGNED'   AND "ownerCustomerId" IS NOT NULL AND "subcontractorId" IS NULL AND "supplierId" IS NULL)
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
