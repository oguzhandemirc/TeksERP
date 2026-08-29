-- =============================================================================
-- DENETİM ŞEMA KISITLARI (2026-08-29) — K1 · K4 · K5 · K6 · K7 · K8
-- =============================================================================
-- Kaynak: audit/RAPOR-2026-08-29.md §12.1. Taslakları
-- `prisma/migration-taslaklari/` altındadır ve gerekçeleri orada yazılıdır.
--
-- ⚠️ K2 ve K3 (kumaş adı/kodu tekilliği) BİLEREK BU MIGRATION'DA YOK — fabrika
--    verisinde mükerrer kayıt duruyor ve index kurulumu DÜŞÜYOR (ölçüldü:
--    ad `v-1430` 1 grup · kod `MC155`/`BGR150`/`SANTUK` 3 grup). Önce mükerrer
--    panelinden birleştirme/yeniden adlandırma gerekiyor; ondan sonra ayrı bir
--    migration olarak gelirler.
--
-- ÖLÇÜM: bu dosyanın tamamı fabrika verisinin BİREBİR kopyasında (33 MB,
-- `tekserp_saha_0825`) gerçekten kuruldu; her adım < 0,1 sn.
-- =============================================================================

-- ── K1 — top metrajı giriş metrajını AŞAMAZ ─────────────────────────────────
-- Kapattığı bulgular: T1-044 · T1-001 · T1-002 · T3-011 · T2-016
-- ÖN KOŞUL (sağlandı): depo kesimi artık `initialQty`ye dokunmuyor.
-- ⚠️ `NOT VALID` bilinçli — "yumuşak kapı" (nameFold emsali): tam tablo taraması
--    YOK, kısa ACCESS EXCLUSIVE, ve fabrikadaki 2 ESKİ ihlal satırı deploy'u
--    DÜŞÜRMEZ. Kısıt buna rağmen YENİ ve GÜNCELLENEN her satırı zorlar.
--    Eski 2 satır temizlendikten sonra elle:
--      ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;
--    (Ölçüldü: bugün VALIDATE düşüyor — bu beklenen ve kabul edilen durum.)
SET lock_timeout = '3s';
ALTER TABLE rolls
  ADD CONSTRAINT rolls_qty_le_initial
  CHECK ("currentQty" <= "initialQty") NOT VALID;

-- ⚠️ ÜÇ FK'da `ON UPDATE CASCADE` ZORUNLU (süs değil): Prisma datamodel'i FK'ları
--    böyle üretir; elle yazılan ALTER onu taşımazsa `test_schema_drift` haklı
--    olarak "belgesiz fark" der ve her koşumda kırmızı kalır (ölçüldü).

-- ── K4 — UYGULANMADI (bilinçli) ────────────────────────────────────────────
-- Taslak, birleştirme mezar taşının hedefine `ON DELETE RESTRICT` öneriyordu.
-- Uygulanmadı; gerekçe schema.prisma'daki `mergedInto` notunda ve denetim
-- raporunda yazılı: ① repo 2026-08-19'da bu bağın SetNull kalmasına GEREKÇELİ
-- karar verdi, ② `/permanent` ucunun bağımlılık kapısı mezar taşına bakmıyor →
-- kısıt orada okunaklı 400 değil HAM FK hatası üretirdi. Beş tablo da (items ·
-- customers · subcontractors · colors · batches) SET NULL olarak KALIYOR.

-- ── K5 — iş emri ↔ sipariş bağı sessizce silinemez ──────────────────────────
-- Kapattığı bulgu: T1-100 (saha 140 bağ; 3'ü bugün silinmeye açıktı)
-- ⚠️ Kod tarafı ÖNCE düzeltildi: sipariş kalemi silme yolu artık İPTAL EDİLMİŞ
--    iş emirlerinin bağını da sayıyor ve okunaklı 409 veriyor. O düzeltme
--    olmadan bu kısıt panelde ham FK hatası olarak görünürdü.
ALTER TABLE work_order_to_order_lines
  DROP CONSTRAINT "work_order_to_order_lines_orderLineId_fkey";
ALTER TABLE work_order_to_order_lines
  ADD CONSTRAINT "work_order_to_order_lines_orderLineId_fkey"
  FOREIGN KEY ("orderLineId") REFERENCES order_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── K6 — audit satırının kullanıcısı silinemez ──────────────────────────────
-- Kapattığı bulgu: T1-034 (şema RESTRICT diyordu, canlı FK SET NULL idi)
-- NOT: bunun ops ikizi `ALTER DATABASE <db> SET teks.audit_guard = 'on'` —
--      migration DEĞİL, deploy adımıdır (docs/ops).
ALTER TABLE system_logs DROP CONSTRAINT "system_logs_userId_fkey";
ALTER TABLE system_logs ADD CONSTRAINT "system_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── K7 — rapor ve iz indeksleri ─────────────────────────────────────────────
-- Kapattığı bulgular: T1-120 · T1-058
-- ⚠️ `CONCURRENTLY` KULLANILMIYOR: Prisma migration'ı tek transaction içinde
--    koşar ve CONCURRENTLY orada ÇALIŞMAZ. Ölçüldü — fabrika verisinde
--    `orders` 278 satır, `rolls`ta `directShipmentId` dolu 0 satır: düz
--    CREATE INDEX milisaniye mertebesinde. Tablolar büyürse yöntem değişmeli.
CREATE INDEX IF NOT EXISTS "orders_orderDate_idx"   ON orders ("orderDate");
CREATE INDEX IF NOT EXISTS "orders_completedAt_idx" ON orders ("completedAt");
-- Kısmi (şemada düz `@@index` durur — Prisma predicate farkını drift saymaz).
CREATE INDEX IF NOT EXISTS "rolls_directShipmentId_idx"
  ON rolls ("directShipmentId") WHERE "directShipmentId" IS NOT NULL;

-- ── K8 — refakat kartı "basım tarihi" YALAN söylemesin ──────────────────────
-- Kapattığı bulgu: T2-024 (saha 153 kart hiç basılmadan tarih taşıyor)
-- ⚠️ Kolon NULLABLE oluyor; MEVCUT satırlara DOKUNULMAZ (geçmiş veriyi toplu
--    düzeltmek kök nedeni gizler — o ayrı bir iş kararı). Liste sıralaması
--    kod tarafında NULL'a hazırlandı.
ALTER TABLE traveler_cards ALTER COLUMN "printedAt" DROP DEFAULT;
ALTER TABLE traveler_cards ALTER COLUMN "printedAt" DROP NOT NULL;
