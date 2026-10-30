-- D4-B1a (2026-10-30) — Tambur ölçüm kaynağı modeli (DALGA4 §3.4; ister 2.9).
--  · MeterPhase'e CUT ayrı dosyada (20261030010000_meter_phase_cut; ADD VALUE yalnız kendi
--    migration'ında) — aşağıdaki CHECK yalnız 'IN'/'OUT' literal'ini anar.
--  · roll_meter_readings.basis / approvalMode NULL olabilir (CUT'ta sapma politikası yok);
--    IN/OUT zorunluluğu CHECK seddiyle KORUNUR (mevcut satırların hepsi IN/OUT ve dolu → sağlanır).
--  · roll_variances.measureSource: sapmayı doğuran ölçümlerin zayıf halkası. NULL = bilinmiyor;
--    backfill YOK (geçmiş satırın kaynağı bilinmiyor — uydurulmaz), doğuş kolonu.

-- AlterTable
ALTER TABLE "roll_meter_readings" ALTER COLUMN "basis" DROP NOT NULL,
ALTER COLUMN "approvalMode" DROP NOT NULL;

ALTER TABLE "roll_meter_readings" ADD CONSTRAINT "roll_meter_readings_policy_by_phase"
  CHECK ("phase" NOT IN ('IN', 'OUT') OR ("basis" IS NOT NULL AND "approvalMode" IS NOT NULL));

-- AlterTable
ALTER TABLE "roll_variances" ADD COLUMN "measureSource" "MachineDataSource";
