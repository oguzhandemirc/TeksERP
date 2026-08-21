-- =============================================================================
-- SAPMA DEFTERİ — "sapmayı doğuran kayıt" adresi (2026-08-21)
-- =============================================================================
-- Fason kabulünde giden ↔ dönen metraj farkı (boyahane çekmesi) artık deftere
-- yazılıyor. Makbuz iptal edilince TAM O satırların terslenebilmesi için satırın
-- kaynağını taşıması gerekiyor: rollId + source + step ile aramak, kısmi
-- teslimatta önceki teslimatın meşru sapmasını da sessizce terslerdi.
--
-- Additive: yalnız NULL kolon + index. Mevcut satırlar (TAMBUR_*) NULL kalır ve
-- hiçbir yol onları okumaz. Vardiya içinde uygulanabilir (roll_variances küçük).
-- =============================================================================

ALTER TABLE "roll_variances" ADD COLUMN IF NOT EXISTS "sourceRefId" UUID;

CREATE INDEX IF NOT EXISTS "roll_variances_source_sourceRefId_idx"
  ON "roll_variances" ("source", "sourceRefId");
