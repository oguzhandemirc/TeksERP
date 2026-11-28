-- =============================================================================
-- TEZGÂH TAHARI GERİ YÜKLEME (2026-11-28) — levent takma (`warp_beam_events` MOUNTED) ve koşum açılışı (`machine_runs`)
-- tezgâhın takılı taharını değiştirdiyse ESKİ plan/kaynağı + makineye yazılan anı taşır — yalnız EKLEME (expand-only).
-- =============================================================================
-- Üç NULLABLE kolon × iki tablo, iki CHECK, iki index, iki FK; veri yazmaz. Eski satırlar NULL = "tahar değiştirmedi"
-- (geri almada tahar adımı yok — bugünkü davranış). Kolonlar INSERT'te bir kez yazılır, hiç değişmez.
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.

ALTER TABLE "machine_runs" ADD COLUMN IF NOT EXISTS "drawingInPrevPlanId" UUID;
ALTER TABLE "machine_runs" ADD COLUMN IF NOT EXISTS "drawingInPrevSource" VARCHAR(8);
ALTER TABLE "machine_runs" ADD COLUMN IF NOT EXISTS "drawingInSetAt" TIMESTAMPTZ;

ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "drawingInPrevPlanId" UUID;
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "drawingInPrevSource" VARCHAR(8);
ALTER TABLE "warp_beam_events" ADD COLUMN IF NOT EXISTS "drawingInSetAt" TIMESTAMPTZ;

-- Kaynak değeri makinedeki `machines_mounted_drawing_in_source_chk` ile aynı küme.
ALTER TABLE "machine_runs" DROP CONSTRAINT IF EXISTS "machine_runs_drawing_in_prev_source_chk";
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_drawing_in_prev_source_chk"
  CHECK ("drawingInPrevSource" IS NULL OR "drawingInPrevSource" IN ('AUTO', 'MANUAL'));

ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_drawing_in_prev_source_chk";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_drawing_in_prev_source_chk"
  CHECK ("drawingInPrevSource" IS NULL OR "drawingInPrevSource" IN ('AUTO', 'MANUAL'));

-- CreateIndex
CREATE INDEX IF NOT EXISTS "machine_runs_drawingInPrevPlanId_idx" ON "machine_runs"("drawingInPrevPlanId");
CREATE INDEX IF NOT EXISTS "warp_beam_events_drawingInPrevPlanId_idx" ON "warp_beam_events"("drawingInPrevPlanId");

-- AddForeignKey
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_drawingInPrevPlanId_fkey" FOREIGN KEY ("drawingInPrevPlanId") REFERENCES "drawing_in_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_drawingInPrevPlanId_fkey" FOREIGN KEY ("drawingInPrevPlanId") REFERENCES "drawing_in_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
