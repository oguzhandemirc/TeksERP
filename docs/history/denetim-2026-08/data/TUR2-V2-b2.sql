\echo '=== V2-Q16 iade defteri: aktif iade ama top hala SHIPPED / shipmentId dolu ==='
SELECT rr.id, r.barcode, r.status, r."shipmentId" FROM roll_returns rr JOIN rolls r ON r.id=rr."rollId" WHERE rr."cancelledAt" IS NULL AND (r.status='SHIPPED' OR r."shipmentId" IS NOT NULL);
\echo '=== V2-Q17 ayni topa >1 aktif iade ==='
SELECT "rollId", count(*) FROM roll_returns WHERE "cancelledAt" IS NULL GROUP BY 1 HAVING count(*)>1;
\echo '=== V2-Q18 iade miktari > topun giris metraji ==='
SELECT rr.id, rr.qty, r."initialQty", r.barcode FROM roll_returns rr JOIN rolls r ON r.id=rr."rollId" WHERE rr.qty > r."initialQty"+0.001;
\echo '=== V2-Q18b iade miktari > o topun sevk edildigi cuvaldaki tahsis (satir bazinda) - bilgi ==='
SELECT rr.id, rr.qty, rr."prevSackId" IS NULL AS prevsacksiz, rr."fromShipmentId" IS NULL AS sevkiyatsiz, rr."orderId" IS NULL AS siparissiz, rr."returnGroupId" IS NULL AS grupsuz, rr."createdAt"::date
FROM roll_returns rr ORDER BY rr."createdAt";
\echo '=== V2-Q19 iade grubu (returnGroupId) ama RETURN_DISPATCH belgesi yok (2026-08-02+) ==='
SELECT rr.id, rr."createdAt", rr."returnGroupId" FROM roll_returns rr WHERE rr."cancelledAt" IS NULL AND rr."createdAt" >= '2026-08-02'
AND NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType"='RETURN_DISPATCH' AND pd."sourceId"=COALESCE(rr."returnGroupId", rr.id));
\echo '=== V2-Q20 aktif iadenin sevkiyati DISPATCHED degil ==='
SELECT rr.id, sh."shipmentNo", sh.status FROM roll_returns rr JOIN shipments sh ON sh.id=rr."fromShipmentId" WHERE rr."cancelledAt" IS NULL AND sh.status<>'DISPATCHED';
\echo '=== V2-Q21 DISPATCHED ama donmus irsaliye yok ==='
SELECT sh."shipmentNo", sh."dispatchedAt" FROM shipments sh WHERE sh.status='DISPATCHED' AND NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType"='SHIPMENT_DISPATCH' AND pd."sourceId"=sh.id);
\echo '=== V2-Q22 ACTIVE irsaliye <-> sevkiyat DISPATCHED ==='
SELECT pd."documentNo", pd.status, pd.version, sh.status AS sevk FROM printed_documents pd JOIN shipments sh ON sh.id=pd."sourceId" WHERE pd."docType"='SHIPMENT_DISPATCH' AND ((pd.status='ACTIVE' AND sh.status<>'DISPATCHED') OR (pd.status='VOIDED' AND sh.status='DISPATCHED'));
\echo '=== V2-Q23 kaynakta >1 ACTIVE belge ==='
SELECT "docType","sourceId",count(*) FROM printed_documents WHERE status='ACTIVE' GROUP BY 1,2 HAVING count(*)>1;
\echo '=== V2-Q24 belge surum bosluklari (max(version) <> adet) ==='
SELECT "docType","sourceId",count(*) AS adet, max(version) AS mx, min(version) AS mn FROM printed_documents GROUP BY 1,2 HAVING max(version)<>count(*) OR min(version)<>1 ORDER BY 1 LIMIT 40;
\echo '=== V2-Q24b belge surum bosluk OZETI docType bazinda ==='
SELECT "docType", count(*) AS kaynak_sayisi FROM (SELECT "docType","sourceId",count(*) AS adet, max(version) AS mx FROM printed_documents GROUP BY 1,2 HAVING max(version)<>count(*)) q GROUP BY 1;
\echo '=== V2-Q25 snapshot bos / NULL ==='
SELECT "docType", count(*) FILTER (WHERE snapshot IS NULL OR snapshot='null'::jsonb OR snapshot='{}'::jsonb) AS bos, count(*) AS toplam FROM printed_documents GROUP BY 1 ORDER BY 1;
\echo '=== V2-Q26 documentNo mukerrer / bicim ==='
SELECT "documentNo", count(*) FROM printed_documents GROUP BY 1 HAVING count(*)>1 ORDER BY 2 DESC LIMIT 20;
\echo '=== V2-Q27 reconstructed belge (bilgi) ==='
SELECT "docType", count(*) FILTER (WHERE reconstructed) AS yeniden_kurulmus, count(*) FROM printed_documents GROUP BY 1;
\echo '=== V2-Q28 sackNo/orderNumber/shipmentNo gunluk sayac bosluk-mukerrer (LEAD) ==='
WITH k AS (
  SELECT 'SIP' AS p, "orderNumber" AS v FROM orders WHERE "orderNumber" ~ '^SIP[0-9]{10}$'
  UNION ALL SELECT 'SVK', "shipmentNo" FROM shipments WHERE "shipmentNo" ~ '^SVK[0-9]{10}$'
  UNION ALL SELECT 'CV', "sackNo" FROM sacks WHERE "sackNo" ~ '^CV[0-9]{10}$'),
s AS (SELECT p, substr(v,length(p)+1,6) AS gun, substr(v,length(p)+7)::int AS sira FROM k)
SELECT p, gun, sira AS onceki, lead(sira) OVER (PARTITION BY p,gun ORDER BY sira) AS sonraki
FROM s QUALIFY false;
