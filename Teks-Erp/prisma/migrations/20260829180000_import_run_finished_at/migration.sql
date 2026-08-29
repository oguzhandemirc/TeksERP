-- =============================================================================
-- BULGU-T1-008 — içe aktarım koşumu artık BAŞTA yazılıyor
-- =============================================================================
-- Replay anahtarı (`clientToken`) koşumun SONUNDA yazıldığı için, 15 sn'lik
-- istemci zaman aşımından sonra "Tekrar Dene" dosyanın TAMAMINI ikinci kez
-- yazıyordu: 900 satırlık sipariş dosyası 1.800 sipariş üretiyor ve kullanıcı
-- İKİ KEZ DE hata görüyordu (ikinci koşumun kayıt yazımı P2002'ye düşüyor).
--
-- `finishedAt IS NULL` = koşum HÂLÂ SÜRÜYOR. Replay guard bunu görünce 200 +
-- "başarılı" değil 409 döner — belirsiz durumu başarı saymak en pahalı hatadır.
--
-- ⚠️ `ImportRunStatus` enum'una RUNNING EKLENMEDİ (bilinçli): uygulanmış bir
-- enum değeri geri alınamaz, nullable kolon `DROP COLUMN` ile alınabilir.
-- Geri alma: ALTER TABLE import_runs DROP COLUMN "finishedAt";
--
-- MEVCUT SATIRLAR: hepsi bitmiş koşumlardır → damgayı `createdAt`ten alırlar.
-- NULL bırakmak onları "sonsuza dek koşuyor" gösterip token'larını kilitlerdi.
-- =============================================================================
ALTER TABLE import_runs ADD COLUMN "finishedAt" TIMESTAMPTZ;
UPDATE import_runs SET "finishedAt" = "createdAt" WHERE "finishedAt" IS NULL;
