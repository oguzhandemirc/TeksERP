-- ============================================================================
-- MUSTERIDEKI URUN ADI — KAPSAM OLCUMU  (SALT OKUNUR, hicbir sey yazmaz)
-- ============================================================================
-- Amac: "shipping.docItemNameMode" bayragini hangi degerde acacagimiza karar
-- vermek. Musterideki ad YOKSA sistem sessizce BIZIM adimiza duser (fail-open):
--   kapsam yuksek  -> "musterideki" anlamli
--   kapsam dusuk   -> "ikisi" sec (iki kolon birden), yoksa fabrika
--                     "calismiyor" der cunku cogu satirda kendi adini goremez
--
-- Calistirma (sunucuda, YENI veritabaninda):
--   psql -U tekserp -d tekserp_yeni -f olcum-musteri-adi.sql
-- ============================================================================

\echo '--- 1) SIPARIS SATIRI BAZINDA (bir seferlik override + master alias) ---'
SELECT
  count(*)                                                     AS toplam_satir,
  count(ol."customerItemName")                                 AS bir_seferlik_ad,
  count(cia.alias)                                             AS master_alias,
  count(COALESCE(ol."customerItemName", cia.alias))             AS kapsanan,
  round(100.0 * count(COALESCE(ol."customerItemName", cia.alias))
        / NULLIF(count(*), 0), 1)                              AS kapsam_yuzde
FROM order_lines ol
JOIN orders o              ON o.id = ol."orderId"
LEFT JOIN customer_item_aliases cia
       ON cia."itemId" = ol."itemId" AND cia."customerId" = o."customerId";

\echo ''
\echo '--- 2) SON 90 GUNDE ACILAN SIPARISLER (bugunku pratik) ---'
SELECT
  count(*)                                                     AS toplam_satir,
  count(COALESCE(ol."customerItemName", cia.alias))             AS kapsanan,
  round(100.0 * count(COALESCE(ol."customerItemName", cia.alias))
        / NULLIF(count(*), 0), 1)                              AS kapsam_yuzde
FROM order_lines ol
JOIN orders o              ON o.id = ol."orderId"
LEFT JOIN customer_item_aliases cia
       ON cia."itemId" = ol."itemId" AND cia."customerId" = o."customerId"
WHERE o."createdAt" > now() - interval '90 days';

\echo ''
\echo '--- 3) HANGI CARILERDE VAR (en cok alias tasiyan 15 cari) ---'
SELECT c.name AS cari, count(*) AS alias_adedi
FROM customer_item_aliases cia
JOIN customers c ON c.id = cia."customerId"
GROUP BY c.name
ORDER BY count(*) DESC
LIMIT 15;

\echo ''
\echo '--- 4) RENK TARAFI (ayni soru renkler icin) ---'
SELECT
  count(*)                                                     AS renkli_satir,
  count(COALESCE(ol."customerColorName", cca.alias))            AS kapsanan,
  round(100.0 * count(COALESCE(ol."customerColorName", cca.alias))
        / NULLIF(count(*), 0), 1)                              AS kapsam_yuzde
FROM order_lines ol
JOIN orders o              ON o.id = ol."orderId"
LEFT JOIN customer_color_aliases cca
       ON cca."colorId" = ol."colorId" AND cca."customerId" = o."customerId"
WHERE ol."colorId" IS NOT NULL;
