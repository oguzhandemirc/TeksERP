\pset footer off
\echo '### V3-01 WO type=ORDER_PRODUCTION ama HIC bag yok (canli WO)'
SELECT wo."workOrderNumber", wo.status, wo."createdAt" FROM work_orders wo
WHERE wo.type='ORDER_PRODUCTION' AND wo.status NOT IN ('CANCELLED','SUPERSEDED')
  AND NOT EXISTS (SELECT 1 FROM work_order_to_order_lines l WHERE l."workOrderId"=wo.id);

\echo '### V3-02 WO type=STOCK_PRODUCTION ama bag VAR (canli WO)'
SELECT wo."workOrderNumber", wo.status, (SELECT count(*) FROM work_order_to_order_lines l WHERE l."workOrderId"=wo.id) n FROM work_orders wo
WHERE wo.type='STOCK_PRODUCTION' AND wo.status NOT IN ('CANCELLED','SUPERSEDED')
  AND EXISTS (SELECT 1 FROM work_order_to_order_lines l WHERE l."workOrderId"=wo.id);

\echo '### V3-02b terminal WO tip sapmasi (bilgi)'
SELECT wo.status, wo.type, count(*) FROM work_orders wo
WHERE wo.status IN ('CANCELLED','SUPERSEDED')
  AND ((wo.type='ORDER_PRODUCTION') <> EXISTS (SELECT 1 FROM work_order_to_order_lines l WHERE l."workOrderId"=wo.id))
GROUP BY 1,2;

\echo '### V3-03 COMPLETED WO ama ACTIVE/PENDING adim var'
SELECT wo."workOrderNumber", wo."updatedAt", string_agg(s."stepSequence"||':'||s.status,',' ORDER BY s."stepSequence") FROM work_orders wo
JOIN work_order_steps s ON s."workOrderId"=wo.id
WHERE wo.status='COMPLETED' AND s.status IN ('ACTIVE','PENDING') GROUP BY 1,2;

\echo '### V3-04 CANCELLED/SUPERSEDED WO ama adimlari SKIPPED degil'
SELECT wo."workOrderNumber", wo.status, wo."cancelledAt", string_agg(s."stepSequence"||':'||s.status,',' ORDER BY s."stepSequence") FROM work_orders wo
JOIN work_order_steps s ON s."workOrderId"=wo.id
WHERE wo.status IN ('CANCELLED','SUPERSEDED') AND s.status NOT IN ('SKIPPED') GROUP BY 1,2,3;

\echo '### V3-05 CANCELLED/SUPERSEDED WO adiminda CANLI top (IN_PRODUCTION/AT_SUB)'
SELECT wo."workOrderNumber", wo.status, r.barcode, r.status FROM rolls r
JOIN work_order_steps s ON s.id=r."currentStepId" JOIN work_orders wo ON wo.id=s."workOrderId"
WHERE wo.status IN ('CANCELLED','SUPERSEDED') AND r.status IN ('IN_PRODUCTION','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR');

\echo '### V3-06 PLANNED/IN_PROGRESS WO ama HIC canli top yok ve son hareket >30 gun (zombi WO, bilgi)'
SELECT wo."workOrderNumber", wo.status, wo."updatedAt"::date,
  (SELECT count(*) FROM rolls r JOIN work_order_steps s2 ON s2.id=r."currentStepId" WHERE s2."workOrderId"=wo.id) canli
FROM work_orders wo WHERE wo.status IN ('PLANNED','IN_PROGRESS')
  AND NOT EXISTS (SELECT 1 FROM rolls r JOIN work_order_steps s2 ON s2.id=r."currentStepId" WHERE s2."workOrderId"=wo.id)
ORDER BY wo."updatedAt";

\echo '### V3-07 adimsiz WO (rota kurulmamis)'
SELECT wo."workOrderNumber", wo.status, wo."createdAt" FROM work_orders wo
WHERE NOT EXISTS (SELECT 1 FROM work_order_steps s WHERE s."workOrderId"=wo.id);

\echo '### V3-08 adim sirasi 1..n degil (bosluk/tekrar)'
SELECT wo."workOrderNumber", array_agg(s."stepSequence" ORDER BY s."stepSequence") FROM work_orders wo JOIN work_order_steps s ON s."workOrderId"=wo.id
GROUP BY wo.id, wo."workOrderNumber"
HAVING min(s."stepSequence")<>1 OR max(s."stepSequence")<>count(*);

\echo '### V3-09 COMPLETED adim ama completedAt NULL / ACTIVE adim ama startedAt NULL'
SELECT count(*) FILTER (WHERE s.status='COMPLETED' AND s."completedAt" IS NULL) comp_damgasiz,
       count(*) FILTER (WHERE s.status='ACTIVE' AND s."startedAt" IS NULL) act_damgasiz,
       count(*) FILTER (WHERE s.status IN ('PENDING') AND s."completedAt" IS NOT NULL) pending_ama_bitmis
FROM work_order_steps s;

\echo '### V3-10 FASON: acik sevk kalemi var ama top AT_SUBCONTRACTOR degil (OPEN_OUTSTANDING ikizi)'
SELECT sd."dispatchNo", r.barcode, r.status, sdi."dispatchedQty", sd."dispatchedAt"
FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId"
JOIN rolls r ON r.id=sdi."rollId"
WHERE sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL AND sdi."remainderClosedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM subcontractor_receipt_items sri JOIN subcontractor_receipts sr ON sr.id=sri."receiptId"
                  WHERE sri."sourceDispatchItemId"=sdi.id AND sri."isPartial"=false AND sr."cancelledAt" IS NULL)
  AND r.status <> 'AT_SUBCONTRACTOR';

\echo '### V3-11 FASON: kalem KAPALI (tam makbuz var) ama top hala AT_SUBCONTRACTOR'
SELECT sd."dispatchNo", r.barcode, r.status, sr."receiptNo", sr."receivedAt"
FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId"
JOIN rolls r ON r.id=sdi."rollId"
JOIN subcontractor_receipt_items sri ON sri."sourceDispatchItemId"=sdi.id AND sri."isPartial"=false
JOIN subcontractor_receipts sr ON sr.id=sri."receiptId" AND sr."cancelledAt" IS NULL
WHERE r.status='AT_SUBCONTRACTOR';

\echo '### V3-12 FASON: aktif makbuzlarin receivedQty toplami > dispatchedQty'
SELECT sd."dispatchNo", r.barcode, sdi."dispatchedQty", SUM(COALESCE(sri."receivedQty",0)) kabul
FROM subcontractor_dispatch_items sdi JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId" JOIN rolls r ON r.id=sdi."rollId"
JOIN subcontractor_receipt_items sri ON sri."sourceDispatchItemId"=sdi.id
JOIN subcontractor_receipts sr ON sr.id=sri."receiptId" AND sr."cancelledAt" IS NULL
GROUP BY 1,2,3 HAVING SUM(COALESCE(sri."receivedQty",0)) > sdi."dispatchedQty"+0.001;

\echo '### V3-13 FASON: bir kaleme birden fazla AKTIF TAM makbuz satiri'
SELECT sdi.id, sd."dispatchNo", count(*) FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId"
JOIN subcontractor_receipt_items sri ON sri."sourceDispatchItemId"=sdi.id AND sri."isPartial"=false
JOIN subcontractor_receipts sr ON sr.id=sri."receiptId" AND sr."cancelledAt" IS NULL
GROUP BY 1,2 HAVING count(*)>1;

\echo '### V3-14 FASON: receivedQty NULL dagilimi (isPartial kirilimi)'
SELECT "isPartial", count(*) toplam, count(*) FILTER (WHERE "receivedQty" IS NULL) qty_null FROM subcontractor_receipt_items GROUP BY 1;

\echo '### V3-15 FASON: receipt clientToken tekrari / dolulugu'
SELECT count(*) toplam, count("clientToken") tokenli, count(DISTINCT "clientToken") tekil FROM subcontractor_receipts;

\echo '### V3-16 FASON: remainderClosedAt damgali kalem ama top SUBCONTRACTOR_CONSUMED degil'
SELECT sd."dispatchNo", r.barcode, r.status, sdi."remainderClosedAt" FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId" JOIN rolls r ON r.id=sdi."rollId"
WHERE sdi."remainderClosedAt" IS NOT NULL AND r.status <> 'SUBCONTRACTOR_CONSUMED';

\echo '### V3-17 FASON: iptal edilmis sevkin kalemi ama top hala AT_SUBCONTRACTOR'
SELECT sd."dispatchNo", sd."cancelledAt", r.barcode, r.status FROM subcontractor_dispatch_items sdi
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId" JOIN rolls r ON r.id=sdi."rollId"
WHERE sd."cancelledAt" IS NOT NULL AND r.status='AT_SUBCONTRACTOR';

\echo '### V3-18 FASON: makbuz iptal edilmis ama dogan cocuk toplar hala canli'
SELECT sr."receiptNo", sr."cancelledAt", r.barcode, r.status FROM subcontractor_receipts sr
JOIN rolls r ON r."parentReceiptId"=sr.id
WHERE sr."cancelledAt" IS NOT NULL AND r.status NOT IN ('CANCELLED','SCRAP');

\echo '### V3-19 FASON: cekme defteri - aktif makbuzda dogan<>tuketilen ve RollVariance yok (TUM tarihler)'
SELECT sr."receiptNo", sr."receivedAt"::date, q.tuketilen, q.dogan, (q.dogan-q.tuketilen) fark, q.defter FROM (
  SELECT sr2.id,
   (SELECT COALESCE(SUM(COALESCE(sri."receivedQty", sdi."dispatchedQty")),0) FROM subcontractor_receipt_items sri LEFT JOIN subcontractor_dispatch_items sdi ON sdi.id=sri."sourceDispatchItemId" WHERE sri."receiptId"=sr2.id) tuketilen,
   (SELECT COALESCE(SUM(c."initialQty"),0) FROM rolls c WHERE c."parentReceiptId"=sr2.id AND c.status<>'CANCELLED') dogan,
   EXISTS (SELECT 1 FROM roll_variances v WHERE v."sourceRefId"=sr2.id AND v."reversedAt" IS NULL) defter
  FROM subcontractor_receipts sr2 WHERE sr2."cancelledAt" IS NULL) q
JOIN subcontractor_receipts sr ON sr.id=q.id
WHERE abs(q.dogan-q.tuketilen) > 0.01 AND NOT q.defter ORDER BY 2;

\echo '### V3-19b FASON: RollVariance SUBCONTRACTOR_RETURN satir sayisi (bilgi)'
SELECT source, kind, count(*), sum(qty) FROM roll_variances GROUP BY 1,2 ORDER BY 1,2;

\echo '### V3-20 FASON: sevkin partisi baska WOya ait / parti NULL'
SELECT sd."dispatchNo", sd."batchId", b."workOrderId" parti_wo, sd."workOrderId" sevk_wo FROM subcontractor_dispatches sd
LEFT JOIN batches b ON b.id=sd."batchId" WHERE sd."batchId" IS NULL OR b."workOrderId" <> sd."workOrderId";

\echo '### V3-21 dispatchWithoutColor bayragi: route_steps + work_order_steps dagilimi'
SELECT 'route_steps' t, "dispatchWithoutColor", count(*) FROM route_steps GROUP BY 1,2
UNION ALL SELECT 'work_order_steps', "dispatchWithoutColor", count(*) FROM work_order_steps GROUP BY 1,2;

\echo '### V3-22 ROTA KAPSAMASI: hedef rengi olan canli WO ama renk verebilen adim yok'
SELECT wo."workOrderNumber", wo.status, c.name renk, wo."createdAt"::date FROM work_orders wo
JOIN colors c ON c.id=wo."targetColorId"
WHERE wo."targetColorId" IS NOT NULL AND wo.status NOT IN ('CANCELLED','SUPERSEDED')
  AND NOT EXISTS (
    SELECT 1 FROM work_order_steps s LEFT JOIN stations st ON st.id=s."stationId" LEFT JOIN subcontractor_categories sc ON sc.id=s."requiredCategoryId"
    WHERE s."workOrderId"=wo.id AND (st."appliesColor" OR sc."appliesColor"))
ORDER BY 4;

\echo '### V3-23 ROTA KAPSAMASI: hedef ozelligi olan canli WO ama o ozelligi veren adim yok'
SELECT wo."workOrderNumber", wo.status, fp.code ozellik FROM work_orders wo
JOIN work_order_target_properties wtp ON wtp."workOrderId"=wo.id
JOIN fabric_properties fp ON fp.id=wtp."propertyId"
WHERE wo.status NOT IN ('CANCELLED','SUPERSEDED')
  AND NOT EXISTS (SELECT 1 FROM work_order_steps s JOIN station_properties sp ON sp."stationId"=s."stationId" WHERE s."workOrderId"=wo.id AND sp."propertyId"=wtp."propertyId");

\echo '### V3-24 KART: WO basina kart sayisi <> 1 (tum tarihler)'
SELECT wo."workOrderNumber", wo."createdAt"::date, count(tc.id) kart FROM work_orders wo LEFT JOIN traveler_cards tc ON tc."workOrderId"=wo.id
GROUP BY 1,2 HAVING count(tc.id)<>1 ORDER BY 2;

\echo '### V3-25 KART: kart durumu <> WO durumu'
SELECT wo."workOrderNumber", wo.status wo_st, tc.status kart_st, tc."voidedAt", wo."updatedAt"::date FROM work_orders wo JOIN traveler_cards tc ON tc."workOrderId"=wo.id
WHERE (wo.status='COMPLETED' AND tc.status='ACTIVE')
   OR (wo.status IN ('CANCELLED','SUPERSEDED') AND tc.status NOT IN ('VOIDED','COMPLETED'))
   OR (wo.status IN ('PLANNED','IN_PROGRESS') AND tc.status<>'ACTIVE');

\echo '### V3-26 KART: version dagilimi + defter (printed_documents TRAVELER_CARD) mutabakati'
SELECT tc.version, count(*) FROM traveler_cards tc GROUP BY 1 ORDER BY 1;
SELECT tc."cardNumber", tc.version kart, m.mx defter FROM traveler_cards tc
JOIN LATERAL (SELECT max(version) mx, count(*) n FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id) m ON true
WHERE m.mx IS DISTINCT FROM NULL AND (m.mx > tc.version OR m.mx <> m.n);

\echo '### V3-26b KART: defter satiri hic yok ama kart basilmis (printedAt dolu)'
SELECT count(*) FILTER (WHERE tc."printedAt" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id)) basili_deftersiz,
       count(*) FILTER (WHERE tc."printedAt" IS NOT NULL) basili, count(*) toplam FROM traveler_cards tc;

\echo '### V3-27 KART: snapshot NULL / contentDirty dagilimi'
SELECT status, count(*) toplam, count(*) FILTER (WHERE snapshot IS NULL) snapshotsiz, count(*) FILTER (WHERE "contentDirty") bayat FROM traveler_cards GROUP BY 1;

\echo '### V3-28 PARTI: WOsuz parti / WO terminal ama parti canli topu var'
SELECT count(*) FILTER (WHERE "workOrderId" IS NULL) wosuz, count(*) toplam FROM batches;

\echo '### V3-29 PARTI: canli topu olmayan ama fason sevkinde acik kullanilan parti'
SELECT b."batchNumber", b."createdAt"::date, wo."workOrderNumber", wo.status FROM batches b
JOIN work_orders wo ON wo.id=b."workOrderId"
WHERE b."mergedIntoId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM rolls r WHERE r."batchId"=b.id AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED'))
  AND wo.status IN ('PLANNED','IN_PROGRESS') ORDER BY 2;

\echo '### V3-30 PARTI: kisa numara sayac durumu (son 15 kisa parti)'
SELECT "batchNumber", "createdAt" FROM batches WHERE "batchNumber" ~ '^P(0[1-9]|[1-9][0-9])$' ORDER BY "createdAt" DESC LIMIT 15;

\echo '### V3-30b PARTI: ayni anda CANLI ayni numarali parti (korlemesine sarma bedeli)'
SELECT b."batchNumber", count(*) canli_parti, string_agg(wo."workOrderNumber",',') FROM batches b JOIN work_orders wo ON wo.id=b."workOrderId"
WHERE b."mergedIntoId" IS NULL AND EXISTS (SELECT 1 FROM rolls r WHERE r."batchId"=b.id AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SHIPPED'))
GROUP BY 1 HAVING count(*)>1;

\echo '### V3-31 BYPASS: atama dagilimi + UNASSIGNED marker izi'
SELECT count(*) toplam, count(*) FILTER (WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL) acik,
       count(*) FILTER (WHERE "machineId" IS NULL) makinesiz, count(*) FILTER (WHERE "completedVia" IS NOT NULL) tamamlanma_yolu FROM kursun_bypass_assignments;
SELECT "completedVia", count(*) FROM kursun_bypass_assignments GROUP BY 1;
SELECT count(*) FILTER (WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:UNASSIGNED:%') unassigned_marker,
       count(*) FILTER (WHERE notes LIKE 'KURSUN_BYPASS_FINISHED:%') tum_marker FROM roll_movements;

\echo '### V3-32 KARTELA: AT_KARTELA top ama acik kartela sevki yok'
SELECT r.barcode, r.status, r."updatedAt" FROM rolls r WHERE r.status='AT_KARTELA'
  AND NOT EXISTS (SELECT 1 FROM kartela_dispatch_items kdi JOIN kartela_dispatches kd ON kd.id=kdi."dispatchId" WHERE kdi."rollId"=r.id AND kd."cancelledAt" IS NULL);

\echo '### V3-32b KARTELA: KARTELA_CONSUMED top ama makbuz izi yok; swatch sayaclari'
SELECT count(*) FROM rolls r WHERE r.status='KARTELA_CONSUMED'
  AND NOT EXISTS (SELECT 1 FROM kartela_receipt_items kri JOIN kartela_receipts kr ON kr.id=kri."receiptId" WHERE kri."consumedRollId"=r.id AND kr."cancelledAt" IS NULL);
SELECT count(*) swatch, count(*) FILTER (WHERE "cancelledAt" IS NOT NULL) iptal FROM swatches;
SELECT count(*) kd, count(*) FILTER (WHERE "cancelledAt" IS NOT NULL) iptal FROM kartela_dispatches;

\echo '### V3-33 MAKINE: createdMachineId istasyon uyumu (topun makinesi hangi istasyonda)'
SELECT count(*) toplam, count("createdMachineId") makineli FROM rolls;
SELECT st.name istasyon, count(*) FROM rolls r JOIN machines m ON m.id=r."createdMachineId" JOIN stations st ON st.id=m."stationId" GROUP BY 1 ORDER BY 2 DESC;

\echo '### V3-33b MAKINE: pasif makineye/istasyona bagli yeni top (son 30 gun)'
SELECT count(*) FROM rolls r JOIN machines m ON m.id=r."createdMachineId" WHERE NOT m."isActive" AND r."createdAt" >= (SELECT max("createdAt") FROM rolls)-interval '30 days';

\echo '### V3-34 ADIM: fason adimi ama plannedSubcontractorId ve requiredCategoryId ikisi de NULL'
SELECT wo."workOrderNumber", wo.status, s."stepSequence", st.name, st.kind FROM work_order_steps s
JOIN work_orders wo ON wo.id=s."workOrderId" JOIN stations st ON st.id=s."stationId"
WHERE st.type='EXTERNAL' AND s."plannedSubcontractorId" IS NULL AND s."requiredCategoryId" IS NULL AND wo.status IN ('PLANNED','IN_PROGRESS');

\echo '### V3-35 ROTA: route_steps sirasi 1..n degil / istasyonu pasif'
SELECT r.code, array_agg(rs.sequence ORDER BY rs.sequence) FROM routes r JOIN route_steps rs ON rs."routeId"=r.id WHERE r."isActive"
GROUP BY r.id, r.code HAVING min(rs.sequence)<>1 OR max(rs.sequence)<>count(*);
SELECT r.code, st.name FROM routes r JOIN route_steps rs ON rs."routeId"=r.id JOIN stations st ON st.id=rs."stationId" WHERE r."isActive" AND NOT st."isActive";

\echo '### V3-36 IE numara bicimi / gunluk bosluk'
SELECT count(*) FILTER (WHERE "workOrderNumber" !~ '^IE[0-9]{6}[0-9]{4}$') bicim_disi, count(*) toplam FROM work_orders;

\echo '### V3-37 WO clientToken tekrari'
SELECT count(*) toplam, count("clientToken") tokenli, count(DISTINCT "clientToken") tekil FROM work_orders;

\echo '### V3-38 GIRIS NOKTASI: asagidan katilan top yukari adimi bekletiyor mu (derived, canli WO)'
SELECT wo."workOrderNumber", s."stepSequence", s.status,
  (SELECT count(*) FROM rolls r WHERE r.status IN ('IN_PRODUCTION','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR')
     AND EXISTS (SELECT 1 FROM roll_movements rm2 JOIN work_order_steps s2 ON s2.id=rm2."workOrderStepId" WHERE rm2."rollId"=r.id AND s2."workOrderId"=s."workOrderId")
     AND NOT EXISTS (SELECT 1 FROM roll_movements rm3 WHERE rm3."rollId"=r.id AND rm3."workOrderStepId"=s.id)
     AND COALESCE((SELECT s3."stepSequence" FROM roll_movements rm4 JOIN work_order_steps s3 ON s3.id=rm4."workOrderStepId" WHERE rm4."rollId"=r.id AND s3."workOrderId"=s."workOrderId" ORDER BY rm4."enteredAt" LIMIT 1),-1) > s."stepSequence") asagidan
FROM work_order_steps s JOIN work_orders wo ON wo.id=s."workOrderId"
WHERE wo.status IN ('PLANNED','IN_PROGRESS') AND s.status<>'SKIPPED'
GROUP BY 1,2,3,s.id,s."workOrderId" HAVING true ORDER BY 1,2;
