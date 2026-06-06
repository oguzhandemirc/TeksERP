-- =============================================================================
-- TeksERP — İndeks Sağlık Teşhisi  (özellikle `rolls` aşırı-indeks analizi)
-- =============================================================================
-- KULLANIM:
--   psql "postgresql://oad@localhost:5432/adnansahin_db" -f scripts/index-health.sql
--
-- ÖNEMLİ — istatistikler trafik gerektirir:
--   pg_stat_user_indexes.idx_scan = "bu indeks kaç kez kullanıldı" sayacıdır.
--   Sayaç, istatistik son sıfırlamadan (veya DB başlangıcından) BERİ birikir.
--   Boş/yeni geliştirme DB'sinde her şey "0 = kullanılmadı" görünür — bu yanıltıcıdır.
--
--   Anlamlı sonuç için iki yol:
--     (a) STAGING/CANLI'da birkaç gün gerçek trafikten sonra çalıştır.
--     (b) DEV'de: büyük sentetik veri seed et → uygulamanın gerçek sorgu setini
--         (liste ekranları, Ürün Dengesi, WO detay, fason kuyruğu, raporlar) bir
--         süre çalıştır → sonra bu dosyayı çalıştır.
--
--   Sayacı temiz bir ölçüm penceresi için sıfırlamak istersen:
--     SELECT pg_stat_reset();   -- DİKKAT: tüm istatistikleri sıfırlar
-- =============================================================================

\echo '== 1) Tablo başına indeks sayısı (yüksek = yazma maliyeti) =================='
SELECT
  c.relname                         AS tablo,
  count(*)                          AS indeks_sayisi,
  pg_size_pretty(pg_relation_size(c.oid))                       AS tablo_boyutu,
  pg_size_pretty(sum(pg_relation_size(i.oid)))                  AS indeks_toplam_boyut
FROM pg_class c
JOIN pg_index x   ON x.indrelid = c.oid
JOIN pg_class i   ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.oid
ORDER BY count(*) DESC, sum(pg_relation_size(i.oid)) DESC;

\echo ''
\echo '== 2) KULLANILMAYAN indeksler (idx_scan = 0) — DROP adayları ================'
\echo '   (PK ve UNIQUE indeksleri hariç tutuldu; onlar kısıt taşıdığı için kalır)'
SELECT
  s.relname                         AS tablo,
  s.indexrelname                    AS indeks,
  s.idx_scan                        AS kullanim_sayisi,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS boyut
FROM pg_stat_user_indexes s
JOIN pg_index x ON x.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
  AND NOT x.indisprimary
  AND NOT x.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;

\echo ''
\echo '== 3) `rolls` indeksleri — tek tek kullanım + boyut ========================='
\echo '   Karar tablosu: idx_scan düşük + boyut büyük olanlar ilk gözden geçirilir.'
SELECT
  s.indexrelname                    AS indeks,
  s.idx_scan                        AS kullanim,
  s.idx_tup_read                    AS okunan_satir,
  s.idx_tup_fetch                   AS getirilen_satir,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS boyut,
  pg_get_indexdef(s.indexrelid)     AS tanim
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public' AND s.relname = 'rolls'
ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;

\echo ''
\echo '== 4) ÇAKIŞAN / önek-yutulan indeks adayları (aynı tablo, aynı ilk kolon) ==='
\echo '   Aynı leading column ile başlayan indeksler: biri diğerinin önekini'
\echo '   karşılıyor olabilir → fazlalık kontrolü için bak (otomatik DROP DEĞİL).'
SELECT
  t.relname AS tablo,
  a.indexrelname AS indeks_a,
  b.indexrelname AS indeks_b,
  pg_get_indexdef(a.indexrelid) AS tanim_a,
  pg_get_indexdef(b.indexrelid) AS tanim_b
FROM pg_stat_user_indexes a
JOIN pg_stat_user_indexes b
  ON a.relid = b.relid AND a.indexrelid < b.indexrelid
JOIN pg_class t ON t.oid = a.relid
JOIN pg_index xa ON xa.indexrelid = a.indexrelid
JOIN pg_index xb ON xb.indexrelid = b.indexrelid
WHERE a.schemaname = 'public'
  -- ilk indekslenen kolon aynı mı?
  AND (xa.indkey::text || ' ')::text LIKE ((split_part(xb.indkey::text,' ',1)) || ' %')
ORDER BY t.relname;

\echo ''
\echo '== 5) `rolls` null-yoğunluğu — PARTIAL index adayları ======================='
\echo '   null oranı yüksek FK kolonlar (shipmentId, sackId, batchSplitId,'
\echo '   parentRollId, parentReceiptId): tam B-tree null''lari da indeksler.'
\echo '   "WHERE col IS NOT NULL" partial index çok daha küçük + null insert''lerde'
\echo '   indeks bakımı SIFIR. Aşağıdaki oran %90+ ise partial''a çevirmeye değer.'
SELECT
  count(*)                                                          AS toplam,
  round(100.0 * count(*) FILTER (WHERE "shipmentId"      IS NULL) / NULLIF(count(*),0), 1) AS shipmentId_null_yuzde,
  round(100.0 * count(*) FILTER (WHERE "sackId"          IS NULL) / NULLIF(count(*),0), 1) AS sackId_null_yuzde,
  round(100.0 * count(*) FILTER (WHERE "batchSplitId"    IS NULL) / NULLIF(count(*),0), 1) AS batchSplitId_null_yuzde,
  round(100.0 * count(*) FILTER (WHERE "parentRollId"    IS NULL) / NULLIF(count(*),0), 1) AS parentRollId_null_yuzde,
  round(100.0 * count(*) FILTER (WHERE "parentReceiptId" IS NULL) / NULLIF(count(*),0), 1) AS parentReceiptId_null_yuzde
FROM rolls;

\echo ''
\echo '== 6) `rolls` status dağılımı — status-içeren indekslerin seçiciliği ========'
\echo '   status 5 ayrı indekste var; her status değişimi 5 indeks günceller.'
\echo '   Dağılım çok dengesizse (ör. %70 WAREHOUSE) bazı composite''ler zayıf seçicidir.'
SELECT status, count(*) AS adet,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS yuzde
FROM rolls
GROUP BY status
ORDER BY count(*) DESC;

\echo ''
\echo '== 7) CACHE HIT ORANI — çalışma kümesi RAM''e sığıyor mu? (ideal >%99) ======'
\echo '   Düşük (<%95) + büyük tablo = sık disk okuması → shared_buffers artır veya'
\echo '   sorguyu daralt. Heap = tablo verisi, Index = indeks sayfaları.'
SELECT
  relname                                                                       AS tablo,
  round(100.0 * heap_blks_hit / NULLIF(heap_blks_hit + heap_blks_read, 0), 2)   AS heap_hit_yuzde,
  round(100.0 * COALESCE(idx_blks_hit,0)
        / NULLIF(COALESCE(idx_blks_hit,0) + COALESCE(idx_blks_read,0), 0), 2)    AS index_hit_yuzde,
  pg_size_pretty(pg_relation_size(relid))                                        AS tablo_boyutu
FROM pg_statio_user_tables
WHERE heap_blks_hit + heap_blks_read > 0
ORDER BY (heap_blks_read + COALESCE(idx_blks_read,0)) DESC
LIMIT 15;

\echo ''
\echo '== 8) ÖLÜ SATIR + VACUUM tazeliği — pratik BLOAT göstergesi =================='
\echo '   olu_yuzde yüksekse (>%20) autovacuum yetişemiyor → şişme birikiyor.'
\echo '   son_autovacuum çok eskiyse o tablo için autovacuum ayarı gözden geçirilir.'
SELECT
  relname                                                                  AS tablo,
  n_live_tup                                                               AS canli_satir,
  n_dead_tup                                                               AS olu_satir,
  round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1)         AS olu_yuzde,
  to_char(last_autovacuum,  'YYYY-MM-DD HH24:MI')                          AS son_autovacuum,
  to_char(last_autoanalyze, 'YYYY-MM-DD HH24:MI')                          AS son_analyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;

\echo ''
\echo '== 9) KESİN BLOAT (pgstattuple) — REINDEX/VACUUM kararı için gerçek sayı ====='
\echo '   pgstattuple eklentisi gerekir (bir kez, superuser). Yoksa 8. bölüm proxy.'
\echo '   bos_yuzde yüksek (>%30) indeks = REINDEX adayı; tablo olu_yuzde yüksek = VACUUM.'
CREATE EXTENSION IF NOT EXISTS pgstattuple;
-- Tablo bloat'ı (yüksek hacim tablolar) — approx = hızlı (tam tarama yok)
-- NOT: pgstattuple alanları `double precision` döner → round() için ::numeric cast şart.
SELECT 'rolls'           AS tablo, round(dead_tuple_percent::numeric,1) AS olu_yuzde, round(approx_free_percent::numeric,1) AS bos_yuzde FROM pgstattuple_approx('rolls')
UNION ALL SELECT 'roll_movements',  round(dead_tuple_percent::numeric,1), round(approx_free_percent::numeric,1) FROM pgstattuple_approx('roll_movements')
UNION ALL SELECT 'roll_operations', round(dead_tuple_percent::numeric,1), round(approx_free_percent::numeric,1) FROM pgstattuple_approx('roll_operations')
UNION ALL SELECT 'system_logs',     round(dead_tuple_percent::numeric,1), round(approx_free_percent::numeric,1) FROM pgstattuple_approx('system_logs');
-- `rolls` indekslerinin bloat'ı (avg_leaf_density düşük = boş yer çok = REINDEX)
SELECT i.relname                                  AS indeks,
       round((100 - s.avg_leaf_density)::numeric, 1) AS bos_yuzde,
       round(s.leaf_fragmentation::numeric, 1)       AS parcalanma_yuzde
FROM pg_class t
JOIN pg_index ix ON ix.indrelid = t.oid
JOIN pg_class i  ON i.oid = ix.indexrelid
CROSS JOIN LATERAL pgstatindex(i.oid) s
WHERE t.relname = 'rolls' AND ix.indisvalid AND i.relkind = 'i'
ORDER BY s.avg_leaf_density ASC;

\echo ''
\echo '== 10) SEQ SCAN oranı — eksik index avı ===================================='
\echo '   Büyük tabloda seq_yuzde yüksekse (sürekli tam tarama) → eksik/yanlış index'
\echo '   veya indekssiz kolona filtre/sort. Küçük master-data için normal.'
SELECT
  relname                                                          AS tablo,
  seq_scan                                                         AS seq_tarama,
  idx_scan                                                         AS index_tarama,
  round(100.0 * seq_scan / NULLIF(seq_scan + idx_scan, 0), 1)      AS seq_yuzde,
  n_live_tup                                                       AS satir
FROM pg_stat_user_tables
WHERE seq_scan + idx_scan > 0
ORDER BY seq_scan DESC
LIMIT 20;
