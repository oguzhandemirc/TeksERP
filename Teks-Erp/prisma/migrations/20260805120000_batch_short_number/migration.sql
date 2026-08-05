-- =============================================================================
-- KISA PARTİ NO — P01 … P99, körlemesine sarar (2026-08-05 kullanıcı kararı)
-- =============================================================================
-- Fabrika numaralı FİZİKSEL parti plakası kullanıyor: plaka 99'da bitince başa
-- dönülüyor. Parti no artık tarih taşımıyor, dolayısıyla BENZERSİZ DEĞİL — aynı
-- numara birkaç günde bir yeniden kullanılıyor. Benzersizliğin kalkması bilinçli
-- ve açıkça istendi (bkz. `batch.service.generateBatchNumberTx` başlığı).
--
-- ⚠️ `batches_batchNumber_key` YALNIZ biçim değiştiği için düşmüyor — o kısıt aynı
--    zamanda ESKİ günlük biçimin (P+GGAAYY+sıra) yarış korumasıydı: `nextDailySeq`
--    kilitsiz okuyor, çakışan insert P2002 alıyor ve `withBarcodeRetry` tekrar
--    deniyordu. Kısıt kalkınca o koruma da kalkar; yerine `generateBatchNumberTx`
--    içindeki `pg_advisory_xact_lock(8022, 1)` geçti ve HER İKİ rejimi de kapsıyor.
--    Kilit olmadan bu migration'ı uygulamak, aynı gün doğan iki partinin sessizce
--    aynı kodu almasına kapı açardı (hata yok, log yok).
--
-- Boyut: `batches` birkaç yüz satırlık küçük bir tablo → DROP/CREATE INDEX anlıktır.
-- `SET statement_timeout = 0` GEREKMEZ (perf kuralı 14'ün eşiği yüz binlerce satır).
-- =============================================================================

-- 1) Benzersizlik kalkıyor. Partinin kimliği artık yalnız `id` (uuid).
DROP INDEX IF EXISTS "batches_batchNumber_key";

-- 2) Sayacın kaynağı: "en son doğan kısa parti" (createdAt DESC LIMIT 1).
--    batchNumber ile sıralanamaz — numara sardığı için en büyük numara "en yeni"
--    demek değildir (P99'dan sonra doğan P01 en yenisidir).
CREATE INDEX IF NOT EXISTS "batches_createdAt_idx" ON "batches"("createdAt");
