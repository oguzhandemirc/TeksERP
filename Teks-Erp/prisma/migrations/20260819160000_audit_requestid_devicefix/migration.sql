-- =============================================================================
-- İŞLEM GRUPLAMA (requestId) + arşiv deviceId TİP DÜZELTMESİ
-- =============================================================================
-- Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
--
-- 1) requestId — SAP `CDHDR` karşılığı. Bir kaydetme tuşu birden çok audit
--    satırı üretir (iş emri + adımlar + sipariş bağları) ama aralarında BAĞ
--    YOKTU: "bu üç değişiklik aynı işlemden mi çıktı?" sorusu cevapsızdı.
--    Değer istek başına bir kez üretilir (AsyncLocalStorage bağlamı — Faz B3'te
--    kuruldu, yeni bağımlılık yok). Job/script bağlamı NULL kalır.
--
-- 2) ⚠️ ARŞİV deviceId TİP HATASI — GERÇEK, HENÜZ PATLAMAMIŞ BİR BUG.
--    `20260819140000` arşive `deviceId` kolonunu UUID olarak açtı; oysa sıcak
--    `system_logs.deviceId` TEXT ve değeri `x-device-id` BAŞLIĞINDAN geliyor
--    (serbest metin: "TAB-01", "BEKCI-TABLET"…). Arşivleyici 6 ayda bir koşar
--    ve İLK gerçek koşumunda 22P02 ile TÜM batch'i düşürürdü — yani hata,
--    yazıldıktan aylar sonra ve kimsenin bakmadığı bir işte patlayacaktı.
--    Kolon bugün tamamen NULL (arşivleyici bu kolonla hiç koşmadı) → ALTER anlık.
--
-- Maliyet: iki nullable kolon + iki düz index. Tablolar küçük (system_logs
-- ~4,4k satır) → saniyenin altında. 6 ay sonra ~550k satırda aynı iş ACCESS
-- EXCLUSIVE kilitle vardiya durdururdu; pencere ŞİMDİ açık.
-- =============================================================================

-- 1) Arşiv deviceId: UUID → TEXT (sıcak tabloyla aynı tip).
ALTER TABLE "system_log_archives"
  ALTER COLUMN "deviceId" TYPE TEXT USING "deviceId"::text;

-- 2) requestId kolonları. Değer daima `crypto.randomUUID()` olduğu için UUID
--    tipi güvenli (deviceId'deki başlık-kaynaklı serbest metin riski YOK).
ALTER TABLE "system_logs" ADD COLUMN IF NOT EXISTS "requestId" UUID;
ALTER TABLE "system_log_archives" ADD COLUMN IF NOT EXISTS "requestId" UUID;

-- 3) Gruplama sorgusu ("bu işlemin diğer satırları") her iki tabloda da koşar —
--    arşiv paritesi bilinçli: deviceId/changes'te bir kez yaşandı, 6 ay sonra
--    özellik sessizce ölüyordu.
--    ⚠️ DÜZ index, partial DEĞİL: partial olsaydı `test_db_invariants`in
--    iki-yönlü PARTIAL_INDEXES envanterine kayıt zorunluluğu doğardı ve kazancı
--    yoktu (kolon zaten çoğunlukla dolu olacak).
CREATE INDEX IF NOT EXISTS "system_logs_requestId_idx" ON "system_logs"("requestId");
CREATE INDEX IF NOT EXISTS "system_log_archives_requestId_idx" ON "system_log_archives"("requestId");
