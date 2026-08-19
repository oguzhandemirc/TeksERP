-- OLAYIN CİHAZI (Faz B3, 2026-08-19) · docs/design/AUDIT-DERINLESTIRME-TASARIM.md
--
-- ISO 27001 A.8.15 log kaydında "nerede/nasıl" bileşenini ister. Ölçüldü:
-- 96.026 DOMAIN audit kaydının HİÇBİRİNDE cihaz/IP yoktu (yalnız AUTH'ta vardı).
-- Sahada 10 tablet AYNI kullanıcıyla çalışıyor → "hangi tabletten yapıldı"
-- sorusu cevapsızdı.
--
-- Nullable: geçmiş kayıtlarda değer yok, job/script bağlamında da null kalır.
-- Index EKLENMEDİ — cihaza göre sorgu yolu bugün YOK; system_logs en hızlı
-- büyüyen tablo, kullanılmayan index yalnız yazmayı yavaşlatır.

ALTER TABLE "system_logs" ADD COLUMN "deviceId" TEXT;
