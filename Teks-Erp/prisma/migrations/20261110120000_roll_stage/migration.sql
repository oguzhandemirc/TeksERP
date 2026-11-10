-- =============================================================================
-- Top aşaması (2026-11-10): `Roll.stage` (RAW | SEMI_FINISHED | FINISHED) + rota/İE adımı `outputStage`.
-- Etiket türü (ROLL_RAW/ROLL_FINISHED) artık renkten değil bu kolondan türer (`roll-stage.helper`).
-- ADDITIVE: yeni enum tipi (bu dosyada DOĞUYOR → CREATE TYPE + kullanım aynı dosyada serbest),
-- varsayılanlı NOT NULL kolon (PG 11+ katalog değişikliği) + iki nullable kolon (null = otomatik).
-- TOHUM: kolon İLK kez eklendiğinde renkli toplar FINISHED yazılır — bugünkü "renkli = bitmiş etiket"
-- davranışının aynası; ayrıntılı geri doldurma ayrı betik (`scripts/backfill_roll_stage.ts`, dry-run).
-- Tohum yalnız kolonu ekleyen koşumda çalışır (ikinci koşum hiçbir satıra dokunmaz); `updatedAt` değişmez.
-- =============================================================================
SET statement_timeout = 0;

DO $t$ BEGIN
  CREATE TYPE "RollStage" AS ENUM ('RAW', 'SEMI_FINISHED', 'FINISHED');
EXCEPTION WHEN duplicate_object THEN NULL; END $t$;

DO $c$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'rolls' AND column_name = 'stage'
  ) THEN
    ALTER TABLE "rolls" ADD COLUMN "stage" "RollStage" NOT NULL DEFAULT 'RAW';
    UPDATE "rolls" SET "stage" = 'FINISHED' WHERE "colorId" IS NOT NULL;
  END IF;
END $c$;

ALTER TABLE "route_steps" ADD COLUMN IF NOT EXISTS "outputStage" "RollStage";
ALTER TABLE "work_order_steps" ADD COLUMN IF NOT EXISTS "outputStage" "RollStage";
