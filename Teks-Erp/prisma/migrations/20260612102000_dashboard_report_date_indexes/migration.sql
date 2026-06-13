-- H-14 (BACKEND-CODE-REVIEW-2.md): Dashboard ve rapor tarih-aralığı sorgularının
-- filtre kolonları indekssizdi — roll_movements/roll_errors/roll_operations
-- milyonlara büyüyünce her dashboard açılışı/rapor full seq scan'e düşer ve
-- statement_timeout=30s sorguyu İPTAL ederdi.
--
-- Kapsanan sorgular:
--   dashboard.getStationsLiveState  → rm."exitedAt" >= bugün (t alt sorgusu)
--   dashboard.getDefectsSummary     → roll_errors."detectedAt" >= bugün
--   quality raporları               → detectedAt / processedAt aralıkları
--   production.getOperatorPerformance → roll_operations."createdAt" aralığı
--
-- Not: rm."exitedAt" IS NULL (açık hareket) sorguları bu indexe muhtaç değil —
-- 20260612101000'deki partial unique (WHERE exitedAt IS NULL) küçük kümeyi
-- zaten kapsıyor. Bu yüzden exitedAt indexi yalnız NOT NULL dilimi tutar
-- (şemadaki @@index([exitedAt]) ile drift-free desen).
SET statement_timeout = 0;

CREATE INDEX "roll_errors_detectedAt_idx" ON "roll_errors" ("detectedAt");
CREATE INDEX "roll_errors_processedAt_idx" ON "roll_errors" ("processedAt");

CREATE INDEX "roll_operations_createdAt_idx" ON "roll_operations" ("createdAt");

CREATE INDEX "roll_movements_exitedAt_idx"
  ON "roll_movements" ("exitedAt")
  WHERE "exitedAt" IS NOT NULL;
