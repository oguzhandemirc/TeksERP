-- ALAN-BAZLI DEĞİŞİKLİK (Faz B2, 2026-08-19)
-- docs/design/AUDIT-DERINLESTIRME-TASARIM.md
--
-- `system_logs.changes` = [{ field, old, new }]. "Tam olarak ne değişti"
-- sorusunun tek cevabı. Nullable → tablo yeniden yazımı YOK, anlık.
--
-- ⚠️ GIN index EKLENMEDİ: bugün alan-bazlı sorgu YOK (okuma kayıt bazlı,
-- `(tableName, recordId)` index'iyle). system_logs en hızlı büyüyen tablo;
-- kullanılmayan GIN yalnız yazmayı yavaşlatır. İhtiyaç doğarsa
-- `USING gin (changes jsonb_path_ops)` eklenir.

ALTER TABLE "system_logs" ADD COLUMN "changes" JSONB;
