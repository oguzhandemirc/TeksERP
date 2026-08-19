-- AUDIT SATIRI DEĞİŞTİRİLEMEZ (Faz B1, 2026-08-19)
-- docs/design/AUDIT-DERINLESTIRME-TASARIM.md
--
-- `system_logs.updatedAt` düşürülüyor: audit satırı yazıldıktan sonra HİÇ
-- güncellenmez (ISO 27001 A.8.15 — logların değiştirilmeye karşı korunması).
-- Kolonun varlığı yanlış bir kapı öneriyordu. Veri kaybı YOK: kolonu okuyan ya
-- da yazan tek bir kod yolu yoktu ve canlıda `updatedAt > createdAt` olan
-- 0 kayıt vardı (yani hiçbir satır güncellenmemişti).
--
-- ⚠️ `system_log_archives.updatedAt` DURUYOR ve düşürülmemeli: orası taşınmış
-- TARİHSEL veridir; arşiv satırının orijinal damgaları korunur.
--
-- ⚠️ ELLE YAZILDI (`migrate dev` kolon düşürmede onay ister). Depo kuralı
-- gereği sıra: git add → db execute → migrate resolve → DOĞRULA.

ALTER TABLE "system_logs" DROP COLUMN "updatedAt";
