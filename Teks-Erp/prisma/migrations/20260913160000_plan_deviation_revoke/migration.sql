-- =============================================================================
-- PLAN-SAPMA DEFTERİNE GERİ ALMA DAMGASI (2026-09-13)
-- =============================================================================
-- NE YAPIYOR: `roll_plan_deviations` tablosuna üç kolon ekler —
--   revokedAt / revokedById / revokeReason.
--
-- ADDITIVE Mİ: EVET. Üç kolon da NULLABLE, varsayılan YOK, backfill YOK.
--   Mevcut satırların tamamı `revokedAt IS NULL` kalır = "yürürlükte", yani
--   BUGÜNKÜ DAVRANIŞ BİREBİR KORUNUR.
--
-- ⚠️ BACKFILL NEDEN YOK — ÖLÇÜLDÜ (2026-09-13, fabrika yedeği):
--   tabloda 2 satır var, ikisi de `finalize` kaynaklı, iki ayrı confirmationId,
--   iki ayrı top, ana toplar TAMBUR_CONSUMED, iş emri IN_PROGRESS.
--   HİÇBİRİ GERİ ALINMAMIŞ ⇒ damgalanacak yanlış satır YOK. Geriye dönük damga
--   bir VERİ KARARIDIR ve burada konusuzdur.
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
--
-- İNDEKS BİLİNÇLİ OLARAK EKLENMEDİ: karnenin üç sorgusu da zaten
--   `createdAt` aralığıyla daraltıyor ve tablo küçük (2 satır). `revokedAt`
--   üstünde ayrı bir ağaç bugün ölçülmemiş bir maliyettir; gerekirse EXPLAIN
--   ile ölçülüp ayrı migration'da eklenir (perf kuralı 12).
-- =============================================================================

ALTER TABLE "roll_plan_deviations"
  ADD COLUMN IF NOT EXISTS "revokedAt"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "revokedById"  UUID,
  ADD COLUMN IF NOT EXISTS "revokeReason" VARCHAR(300);
