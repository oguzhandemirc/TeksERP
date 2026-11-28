-- =============================================================================
-- TEZGÂH TAHARI (T2, Seyitoğlu 2026-11-28) — `machines`a çerçeve kapasitesi + takılı tahar — yalnız EKLEME (expand-only).
-- =============================================================================
-- Beş NULLABLE kolon, iki CHECK, iki index, iki FK; veri yazmaz. Eski tezgâhlar NULL kalır = "bilinmiyor"
-- (tezgâh önerisi bugünkü gibi nötr sıralar). Takılı tahar "şu an ne"dir, defter değildir (değişim izi audit).
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "frameCount" SMALLINT;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "mountedDrawingInPlanId" UUID;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "mountedDrawingInSource" VARCHAR(8);
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "mountedDrawingInAt" TIMESTAMPTZ;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "mountedDrawingInById" UUID;

-- Servis kapısının ikinci hattı: çerçeve sayısı tahar planıyla aynı aralık (1..16, constants/drawing-in-plan.ts HARD_MAX).
ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_frame_count_range";
ALTER TABLE "machines" ADD CONSTRAINT "machines_frame_count_range"
  CHECK ("frameCount" IS NULL OR "frameCount" BETWEEN 1 AND 16);

ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_mounted_drawing_in_source_chk";
ALTER TABLE "machines" ADD CONSTRAINT "machines_mounted_drawing_in_source_chk"
  CHECK ("mountedDrawingInSource" IS NULL OR "mountedDrawingInSource" IN ('AUTO', 'MANUAL'));

-- CreateIndex
CREATE INDEX IF NOT EXISTS "machines_mountedDrawingInPlanId_idx" ON "machines"("mountedDrawingInPlanId");
CREATE INDEX IF NOT EXISTS "machines_mountedDrawingInById_idx" ON "machines"("mountedDrawingInById");

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_mountedDrawingInPlanId_fkey" FOREIGN KEY ("mountedDrawingInPlanId") REFERENCES "drawing_in_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machines" ADD CONSTRAINT "machines_mountedDrawingInById_fkey" FOREIGN KEY ("mountedDrawingInById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
