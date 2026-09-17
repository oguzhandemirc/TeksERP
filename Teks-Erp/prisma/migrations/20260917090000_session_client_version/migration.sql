-- =============================================================================
-- OTURUM KAYDINA İSTEMCİ SÜRÜMÜ — `sessions.clientVersion` (2026-09-17)
-- =============================================================================
-- YALNIZ EKLER: tek nullable kolon. Backfill YOK ve olamaz — bu alan bir GÖZLEM
-- kaydıdır; bu damgadan ÖNCE açılmış her oturum NULL kalır ve NULL "eski
-- istemci" DEĞİL "ölçülmedi" demektir. Uydurulmuş bir backfill, kaldırma fazı
-- kapısına ölçülmemiş bir zemini "temiz" diye gösterirdi.
--
-- ⚠️ Kolonun EKLENDİĞİ AN, ölçüm penceresinin başlangıcıdır: bu migration'ın
-- klasör adındaki damga `test_rol_modeli_kalinti` ④ kolu tarafından OKUNUR
-- (elle yazılmış tarih yok). 30 günlük pencere dolmadan hiçbir hüküm verilemez.
--
-- İdempotent: IF NOT EXISTS.
-- =============================================================================

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "clientVersion" VARCHAR(32);
