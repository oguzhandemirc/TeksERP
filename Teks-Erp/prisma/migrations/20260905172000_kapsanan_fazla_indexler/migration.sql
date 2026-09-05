-- =============================================================================
-- Non-partial UNIQUE tarafından TAM KAPSANAN 10 gereksiz index DÜŞÜRÜLÜR
-- (perf turu 2026-09-05, BULGU 4 — [DB-12] ihlali)
-- =============================================================================
-- NE YAPIYOR: onu da aynı tabloda, aynı kolonla (ya da o kolonun ÖN EKİ olduğu)
-- NON-PARTIAL bir UNIQUE index tarafından karşılanan on adet non-unique index'i
-- düşürür. [DB-12]: "composite unique/index'in ÖN EKİ index sayılır ve dördüncü
-- bir ağaç yazılmaz."
-- ADDITIVE Mİ: HAYIR — DROP içerir ve DROP GERİ ALINAMAZ. Geri almak gerekirse
-- çözüm bu dosyayı düzenlemek DEĞİL ([DB-31]), index'leri yeniden kuran YENİ bir
-- migration yazmaktır.
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya tamamen elle yazıldı).
-- Aynı commit'te `schema.prisma`daki on `@@index` satırı da silindi — aksi halde
-- `test_schema_drift` "CREATE INDEX" farkı görürdü.
--
-- DOĞRULAMA (her biri tek tek, EXPLAIN ile — pg_index/pg_attribute sorgusu
-- `docs/history/perf-2026-09-05/index-envanteri.json` BULGU 4):
--   kapsayan index UNIQUE mi · NON-PARTIAL mı · kolon ön eki gerçekten eşleşiyor mu
--   → onunda da EVET. `*_trgm_` (GIN) index'ler bu listeye GİRMEZ: aynı kolonda
--   dursalar da opclass farklıdır, btree unique onların işini GÖRMEZ.
--   `customers/items/subcontractors _nameFold_idx` de GİRMEZ: onların unique'i
--   PARTIAL'dır (`WHERE "mergedIntoId" IS NULL`) ve `findSimilarNames` tombstone'ları
--   bilerek gösterdiği için o partial'ı kullanamaz (BULGU 8).
--
-- ÖLÇÜM (enable_seqscan=off ile — tablolar 0-11 satır, aksi halde planlayıcı
-- zaten seq scan seçiyor ve iki index de görünmez olurdu):
--   customer_standalone_labels."customerId"  (bu listede idx_scan>0 olan TEK index: 597)
--     ÖNCE : Index Scan using customer_standalone_labels_customerId_idx (cost 0.47..8.49)
--     SONRA: Index Scan using customer_standalone_labels_customerId_templateId_key
--            (cost 0.47..8.49 — AYNI maliyet, aynı Index Cond)
--   machines."stationId"
--     ÖNCE : machines_stationId_nameFold_key  (planlayıcı düşürülecek index'i ZATEN
--            seçmiyordu — kapsayan unique daha iyi)
--     SONRA: machines_stationId_nameFold_key  (değişmedi)
--   subcontractor_direct_ship_allocations."directShipmentId"
--     ÖNCE/SONRA: ..._dsId_orderLineId_key (cost 8.26..16.28, değişmedi)
--   defect_types · fabric_properties · peripheral_devices · product_recipes ·
--   quality_grades · return_reasons · routes  ("nameFold" eşitliği =
--   `base.service.ts` findSimilarNames'in eşitlik dalı)
--     SONRA: her birinde `<tablo>_nameFold_key` seçildi, Index Cond aynı.
--   Toplam kazanç: 160 kB + on ağaçlık INSERT/UPDATE bakımı. KÜÇÜKTÜR ve öyle
--   olduğu ölçüldü; asıl değer kuralın DB'de tutuyor olması.
-- =============================================================================
SET statement_timeout = 0;

-- (customerId) ⊂ UNIQUE (customerId, templateId)
DROP INDEX IF EXISTS "customer_standalone_labels_customerId_idx";
-- (stationId) ⊂ UNIQUE (stationId, nameFold)
DROP INDEX IF EXISTS "machines_stationId_idx";
-- (directShipmentId) ⊂ UNIQUE (directShipmentId, orderLineId)
DROP INDEX IF EXISTS "subcontractor_direct_ship_allocations_directShipmentId_idx";
-- (nameFold) = UNIQUE (nameFold) — kapsayan unique NON-PARTIAL, birebir aynı kolon
DROP INDEX IF EXISTS "defect_types_nameFold_idx";
DROP INDEX IF EXISTS "fabric_properties_nameFold_idx";
DROP INDEX IF EXISTS "peripheral_devices_nameFold_idx";
DROP INDEX IF EXISTS "product_recipes_nameFold_idx";
DROP INDEX IF EXISTS "quality_grades_nameFold_idx";
DROP INDEX IF EXISTS "return_reasons_nameFold_idx";
DROP INDEX IF EXISTS "routes_nameFold_idx";
