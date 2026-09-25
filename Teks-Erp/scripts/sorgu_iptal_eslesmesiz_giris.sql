-- =============================================================================
-- İPTAL EDİLMİŞ İŞ EMRİNDE EŞLEŞMESİZ ÜRETİME ALMA SATIRI
-- =============================================================================
-- SALT OKUMA: yalnız SELECT. Fabrikada koşulup koşulmayacağına KULLANICI karar verir.
--   psql "<url>" -f scripts/sorgu_iptal_eslesmesiz_giris.sql
--
-- NE ARAR: iş emri iptali ham topları toplu `updateMany` ile STOCK'a çekiyor ve üretime
-- alma çıkışının (`PRODUCTION_ISSUE`) tersini yazmıyordu. Düzeltmeden ÖNCE iptal edilen
-- iş emirlerinin toplarında bu satır tersiz kaldı: defter topu "üretimde" sayar, top
-- rafta durur. Düzeltme ileriye dönüktür; bu sorgu geriye kalanı SAYAR, onarmaz.
--
-- ⚠️ Prova kopyasında (tekserp_prova4b_test) sonuç 0'dı: `PRODUCTION_ISSUE` satırı hiç
-- yoktu. Satır, üretime alma yazıcısının yayınından sonra doğar.
-- =============================================================================

-- 1) Döküm: iptal edilmiş iş emrinin adımına damgalı, tersi olmayan üretime alma satırı
SELECT w."workOrderNumber"            AS is_emri,
       w."cancelledAt"                AS iptal_ani,
       coalesce(r.barcode, '(açık)')  AS top,
       r.status                       AS topun_durumu,
       m."fromStatus"                 AS alindigi_durum,
       m.qty                          AS alinan_m,
       r."currentQty"                 AS simdiki_m,
       m."createdAt"                  AS alinma_ani
  FROM warehouse_movements m
  JOIN work_order_steps s ON s.id = m."workOrderStepId"
  JOIN work_orders w      ON w.id = s."workOrderId"
  JOIN rolls r            ON r.id = m."rollId"
 WHERE m."reasonCode" = 'PRODUCTION_ISSUE'
   AND m."reversesMovementId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM warehouse_movements x WHERE x."reversesMovementId" = m.id)
   AND w.status = 'CANCELLED'
   AND r.status <> 'IN_PRODUCTION'
 ORDER BY w."cancelledAt", r.barcode;

-- 2) Özet
SELECT count(*)                 AS eslesmesiz_satir,
       count(DISTINCT w.id)     AS is_emri,
       coalesce(sum(m.qty), 0)  AS toplam_m
  FROM warehouse_movements m
  JOIN work_order_steps s ON s.id = m."workOrderStepId"
  JOIN work_orders w      ON w.id = s."workOrderId"
  JOIN rolls r            ON r.id = m."rollId"
 WHERE m."reasonCode" = 'PRODUCTION_ISSUE'
   AND m."reversesMovementId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM warehouse_movements x WHERE x."reversesMovementId" = m.id)
   AND w.status = 'CANCELLED'
   AND r.status <> 'IN_PRODUCTION';
