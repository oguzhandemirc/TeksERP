-- =============================================================================
-- INDEX'SİZ 5 DOMAIN FK — [DB-12] boşluğunun kapanması (2026-09-05)
-- =============================================================================
-- ADDITIVE: yalnız `CREATE INDEX IF NOT EXISTS`. Hiçbir kolon/kısıt/veri
-- değişmiyor; geri alma gerekirse `DROP INDEX` yeterlidir (ama migration geri
-- alınamaz kabul edilir — kök CLAUDE.md).
--
-- KAYNAK: docs/standart/VERITABANI.md §12 "Bilinen boşluklar" — 368 FK'nın
-- 96'sı index kapsamı dışında, 91'i BİLİNÇLİ künye FK'sı ([DB-11]), kalan 5'i
-- gerçek domain boşluğu. Bu dosya o 5'i kapatır:
--   1) subcontractor_direct_ship_allocations."dispatchId"  (NOT NULL → düz)
--   2) direct_shipments."branchId"                          (null-yoğun → kısmi)
--   3) sacks."branchId"                                     (null-yoğun → kısmi)
--   4) warehouse_movements."shipmentId"                     (null-yoğun → kısmi)
--   5) warehouse_movements."rollReturnId"                   (null-yoğun → kısmi)
--
-- KISMİ mi DÜZ mü: kolon NULLABLE ve NULL'lar baskınsa kısmi ([DB-14] + ev
-- emsali `warehouse_movements_transferId_idx` / `sacks_warehouseId_idx`).
-- `dispatchId` NOT NULL olduğu için düz. Kısmi index'ler şemada DÜZ `@@index`
-- olarak durur — Prisma predicate farkını drift saymaz — ve şema-dışı nesne
-- envanterine (`scripts/test_db_invariants.ts` §1) yazılır.
--
-- ⚠️ `CREATE INDEX CONCURRENTLY` YOK ([DB-26]): Prisma migration'ı tek
-- transaction içinde koşar, CONCURRENTLY orada çalışmaz. Yani bu dosya
-- ilgili tabloları index kurulumu süresince KİLİTLER.
--
-- ⚠️ CANLI MALİYET ÖLÇÜLMEDİ. Ölçülen sayılar YALNIZ geliştirme DB'sinindir
-- (tekserp_demo): subcontractor_direct_ship_allocations 0 · direct_shipments 0
-- · sacks 41 · warehouse_movements 213 satır → burada kurulum anlıktır. Canlı
-- kurulumda `sacks` ve `warehouse_movements` yüz binlere çıkabilir.
-- ⇒ [DB-29] ZORUNLU: bu migration canlıya gitmeden ÖNCE EN ESKİ CANLI DUMP
--   üzerinde prova edilir ve SÜRE ÖLÇÜLÜR (restore → `migrate deploy` →
--   bekçiler → profil boot). Ölçülmeden canlıya GİTMEZ. Ölçüm bir saniyeyi
--   aşarsa yöntem değişmeli (bakım penceresi ya da elle CONCURRENTLY —
--   migration dışında, ops adımı olarak).
-- =============================================================================

-- Büyük tabloya DDL → süre sınırı kaldırılır ([DB-25]).
SET statement_timeout = 0;

-- 1) Fasondan doğrudan sevk karşılanmaları — "bu sevkin tahsisleri" sorgusu
--    (`dispatch` üzerinden okuma + Cascade silme yolu) tam tarama yapıyordu.
CREATE INDEX IF NOT EXISTS "subcontractor_direct_ship_allocations_dispatchId_idx"
  ON "subcontractor_direct_ship_allocations" ("dispatchId");

-- 2) Doğrudan sevk belgesi → müşteri ŞUBESİ. Şube opsiyonel (çoğu sevk NULL).
CREATE INDEX IF NOT EXISTS "direct_shipments_branchId_idx"
  ON "direct_shipments" ("branchId") WHERE "branchId" IS NOT NULL;

-- 3) Çuval → müşteri şubesi. Aynı gerekçe; `sacks_warehouseId_idx` emsali.
CREATE INDEX IF NOT EXISTS "sacks_branchId_idx"
  ON "sacks" ("branchId") WHERE "branchId" IS NOT NULL;

-- 4-5) Depo hareket defterinin belge bağları. `transferId`/`goodsReceiptId`/
--      `sackId` kardeşleri 2026-08'de index almış, bu ikisi atlanmış.
--      Doluluk seyrek: yalnız SHIPMENT* ve RETURN olayları taşır.
CREATE INDEX IF NOT EXISTS "warehouse_movements_shipmentId_idx"
  ON "warehouse_movements" ("shipmentId") WHERE "shipmentId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "warehouse_movements_rollReturnId_idx"
  ON "warehouse_movements" ("rollReturnId") WHERE "rollReturnId" IS NOT NULL;
