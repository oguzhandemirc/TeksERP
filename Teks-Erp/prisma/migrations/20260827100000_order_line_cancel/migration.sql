-- SİPARİŞ KALEMİ İPTALİ (2026-08-27)
--
-- İhtiyaç: 10 kalemlik siparişin 3 kalemini iptal edip kalan 7'siyle devam
-- edebilmek. Bugüne dek MÜMKÜN DEĞİLDİ: kalem çıkarmanın tek yolu hard-delete
-- idi ve aktif iş emri bağı varsa tamamen reddediliyordu
-- ("İş emri açılmış siparişin kalemleri değiştirilemez").
--
-- SOFT iptal: satır SİLİNMEZ. Sevk edilmiş metrajı defterde durur ve listede
-- "iptal" işaretiyle görünür — mal çıkmışsa o gerçek kaybolmamalı.
--
-- `cancelledAt IS NULL` = AKTİF kalem. Bu, kolonun null-yoğun olduğu ALIŞILMIŞ
-- durumun TERSİDİR: sorgular NULL olanı arar, dolu olanı dışlar. Partial index
-- bu yüzden `WHERE "cancelledAt" IS NULL` ile kurulur — iptal edilmiş satırlar
-- index'e hiç girmez ve "açık talep" sorguları (WO picker, karşılanma, üretim
-- dengesi, talep analizi) yalnız aktif satırları tarar.
--
-- Sebep kataloğu AYRI DEĞİL: `ReasonPresetKind.ORDER_CANCEL` yeniden kullanılır
-- (fabrikanın tek yerden düzenlediği liste ikiye bölünmesin). Kalem-özel sebep
-- ihtiyacı doğarsa o zaman yeni kind açılır.
ALTER TABLE "order_lines"
  ADD COLUMN IF NOT EXISTS "cancelledAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancelReason"     TEXT,
  ADD COLUMN IF NOT EXISTS "cancelReasonCode" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "cancelledById"    UUID;

-- FK: kim iptal etti. RESTRICT değil SET NULL — kullanıcı silinse de kalemin
-- iptal olgusu kaybolmamalı (künye kuralı: olgu kalır, kimlik düşebilir).
ALTER TABLE "order_lines"
  DROP CONSTRAINT IF EXISTS "order_lines_cancelledById_fkey";
ALTER TABLE "order_lines"
  ADD CONSTRAINT "order_lines_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- INDEX BİLİNÇLİ OLARAK EKLENMEDİ. "Aktif kalem" sorguları `orderId` ile
-- başlıyor ve `order_lines_orderId_idx` zaten var; sipariş başına kalem sayısı
-- küçük olduğu için `cancelledAt IS NULL` süzgeci heap'te bedavaya yakın.
-- Ayrıca satırların ÇOĞU aktif olacağı için `WHERE cancelledAt IS NULL` partial
-- index'i tabloyu neredeyse tamamen kopyalardı — kazanç yok, bakım maliyeti var.
-- Ölçümle bir sorgu yolu doğarsa (ör. iptal edilmiş kalemleri raporlayan bir
-- yüzey) o zaman ÖLÇÜLEREK eklenir.
