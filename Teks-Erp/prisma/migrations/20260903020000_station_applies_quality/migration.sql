-- Kalite = İSTASYON YETENEĞİ, Faz A (2026-09-03)
--
-- Eskiden "bu adım kalite kontrol yürütür mü" sorusuna `kind = 'PROCESS_QC'`
-- diye cevap veriliyordu ve bu literal 28 karar noktasına elle kopyalanmıştı.
-- Kalite artık istasyonun KENDİ alanı; tür yalnız Faz A köprüsü olarak
-- yüklemin içinde duruyor (`stepCanApplyQuality`).

-- AlterTable
ALTER TABLE "stations" ADD COLUMN     "appliesQuality" BOOLEAN NOT NULL DEFAULT false;

-- Mevcut satırların DOLDURULMASI (bugünkü davranışı BİREBİR korur):
--   • kind = 'PROCESS_QC'  → true  (bugün kalite yürüten TEK istasyon türü)
--   • diğer her istasyon   → false (kolon varsayılanı)
--
-- ⚠️ Backfill YALNIZ PROCESS_QC'yi çeker. Başka bir türe `true` yazmak SESSİZ
-- bir davranış değişikliği olurdu: kanalize edilen 19 karar noktası (7 bellek
-- içi yüklem + 12 Prisma where) bugün `kind = 'PROCESS_QC'` kümesini
-- görüyor; kümeye satır eklemek kurşun kuyruğunu, bypass uygunluğunu ve
-- Kanban "Kurşun" kolonunu aynı anda genişletirdi.
--
-- ⚠️ Bu UPDATE seed'i KURTARMAZ: migration seed'den ÖNCE, tablo boşken koşar
-- (prisma/seed.ts:316-322 notu). Taze kurulumun KURSUN_KK2 satırı bu yüzden
-- seed'de AÇIKÇA `appliesQuality: true` yazar.
UPDATE "stations" SET "appliesQuality" = true WHERE "kind" = 'PROCESS_QC';
