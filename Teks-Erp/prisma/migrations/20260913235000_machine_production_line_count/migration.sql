-- =============================================================================
-- ÜRETİM HATTI SAYISI — `machines.productionLineCount` (2026-09-13, dokuma P4b)
-- =============================================================================
-- NE YAPIYOR: var olan `machines` tablosuna varsayılanlı bir kolon + bir CHECK.
--
-- ⚠️ İLK KEZ CANLI TABLOYA KOLON (P1/P2/P4 üçü de BOŞ tablo yaratmıştı) — ama
--   HACİM ÖLÇÜLDÜ ve endişe yersiz çıktı: fabrikanın canlı yedeğinde `machines`
--   **6 satır / 112 kB** (karşılaştırma: `rolls` 5.813, `roll_movements` 2.293).
--   PG 11+ varsayılanlı ADD COLUMN'u zaten tabloyu yeniden yazmaz (varsayılan
--   katalogda yaşar); 6 satırda o tartışma da konusuzdur.
--   ⇒ Sınıf riski İŞARET eder, MİKTARI ölçmez — ve müdahalenin bedeli miktardan
--   gelir. Bu yüzden `SET statement_timeout = 0` GEREKMİYOR.
--
-- SIFIR FARK: `@default(1)` bugünkü davranıştır. Tek hatlı makinede
--   `productionLineNo` sabit 1'dir ⇒ `machine_runs`ın iki sedi (P2) bugünküyle
--   BİREBİR aynı kümeyi reddeder. Referans profilde hiçbir yüzey değişmez.
--
-- ⚠️ `Machine.warpBeamSlots` BU MIGRATION'DA YOK ve bilinçli: o kolon LEVENT
--   belgesinin (`DEVERE-LEVENT-TARAMASI.md`) parçasıdır ve tasarımın kendi
--   "tek parçalı sürüm" kuralına tabidir — olay defteri · durum kolonları ·
--   partial unique sed + `warpBeamSlots` · `beamsMountedDuring` helper'ı ·
--   mutabakat bekçisi AYNI SÜRÜMDE çıkar, yoksa yarım bir defter canlıya iner.
--   Buraya çekmek o beşliyi bölerdi. `productionLineNo` doğrulaması ona zaten
--   ihtiyaç duymuyor: `warpBeamSlots` GİRDİ ekseni, `productionLineCount` ÇIKTI.
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
-- =============================================================================

ALTER TABLE "machines"
  ADD COLUMN "productionLineCount" SMALLINT NOT NULL DEFAULT 1;

-- Sıfır ya da negatif hat sayısı "kumaş üretmeyen makine" demek olurdu; o hâl
-- zaten `productionLineNo` NULL ile ifade ediliyor. Karşı örnek arandı,
-- bulunamadı ⇒ dar yönde başlanıyor. Gevşetme yolu tek ifadelidir.
ALTER TABLE "machines" ADD CONSTRAINT "machines_productionLineCount_pos"
  CHECK ("productionLineCount" >= 1);
