\pset footer off
\echo '### V3-40 FS/FK belge no bicimi + gunluk bosluk'
SELECT 'FS' t, count(*) FILTER (WHERE "dispatchNo" !~ '^FS[0-9]{10}$') bicim_disi, count(*) FROM subcontractor_dispatches
UNION ALL SELECT 'FK', count(*) FILTER (WHERE "receiptNo" !~ '^FK[0-9]{10}$'), count(*) FROM subcontractor_receipts;
WITH x AS (SELECT substr("dispatchNo",3,6) g, substr("dispatchNo",9,4)::int s FROM subcontractor_dispatches WHERE "dispatchNo" ~ '^FS[0-9]{10}$')
SELECT g, max(s) enbuyuk, count(*) adet FROM x GROUP BY 1 HAVING max(s)<>count(*) ORDER BY 1;
WITH x AS (SELECT substr("receiptNo",3,6) g, substr("receiptNo",9,4)::int s FROM subcontractor_receipts WHERE "receiptNo" ~ '^FK[0-9]{10}$')
SELECT g, max(s) enbuyuk, count(*) adet FROM x GROUP BY 1 HAVING max(s)<>count(*) ORDER BY 1;

\echo '### V3-41 WorkOrderStep.stepData dolu mu (H10)'
SELECT count(*) toplam, count(*) FILTER (WHERE "stepData" IS NOT NULL AND "stepData"::text <> '{}') dolu FROM work_order_steps;

\echo '### V3-42 work_order_to_order_lines.allocatedQty dagilimi (olu kolon mu)'
SELECT count(*) toplam, count(*) FILTER (WHERE "allocatedQty"=0) sifir, sum("allocatedQty") FROM work_order_to_order_lines;

\echo '### V3-43 ROTA sablonu ile WO adim sayisi farki (sablon sonradan degismis mi)'
SELECT wo."workOrderNumber", wo.status, ro.code rota, (SELECT count(*) FROM work_order_steps s WHERE s."workOrderId"=wo.id) wo_adim,
       (SELECT count(*) FROM route_steps rs WHERE rs."routeId"=ro.id) sablon_adim
FROM work_orders wo JOIN routes ro ON ro.id=wo."routeTemplateId"
WHERE wo.status IN ('PLANNED','IN_PROGRESS')
  AND (SELECT count(*) FROM work_order_steps s WHERE s."workOrderId"=wo.id) <> (SELECT count(*) FROM route_steps rs WHERE rs."routeId"=ro.id);

\echo '### V3-44 KART okutma (traveler_card_scans) dagilimi'
SELECT count(*) toplam, count(DISTINCT "cardId") kart FROM traveler_card_scans;
SELECT s.\"scanType\", count(*) FROM traveler_card_scans s GROUP BY 1;

\echo '### V3-45 KART okutmasi ama adimi olmayan (workOrderStepId NULL)'
SELECT count(*) FILTER (WHERE "workOrderStepId" IS NULL) adimsiz, count(*) toplam FROM traveler_card_scans;

\echo '### V3-46 subcontractor_receipt_properties yetimleri / dagilim'
SELECT count(*) FROM subcontractor_receipt_properties;

\echo '### V3-47 WO hedef ozellikleri: pasif/silinmis ozellige bagli'
SELECT wo."workOrderNumber", fp.code, fp."isActive" FROM work_order_target_properties wtp
JOIN work_orders wo ON wo.id=wtp."workOrderId" JOIN fabric_properties fp ON fp.id=wtp."propertyId"
WHERE NOT fp."isActive" AND wo.status IN ('PLANNED','IN_PROGRESS');

\echo '### V3-48 WO: targetItem pasif / targetColor tombstone (canli WO)'
SELECT wo."workOrderNumber", wo.status, i.name, i."isActive", i."mergedIntoId" IS NOT NULL tomb FROM work_orders wo JOIN items i ON i.id=wo."targetItemId"
WHERE wo.status IN ('PLANNED','IN_PROGRESS') AND (NOT i."isActive" OR i."mergedIntoId" IS NOT NULL);
SELECT wo."workOrderNumber", c.name, c."isActive", c."mergedIntoId" IS NOT NULL tomb FROM work_orders wo JOIN colors c ON c.id=wo."targetColorId"
WHERE wo.status IN ('PLANNED','IN_PROGRESS') AND (NOT c."isActive" OR c."mergedIntoId" IS NOT NULL);

\echo '### V3-49 FASON: pasif fason firmaya acik sevk'
SELECT sd."dispatchNo", sc.name, sc."isActive", sc."mergedIntoId" IS NOT NULL tomb FROM subcontractor_dispatches sd JOIN subcontractors sc ON sc.id=sd."subcontractorId"
WHERE sd."cancelledAt" IS NULL AND (NOT sc."isActive" OR sc."mergedIntoId" IS NOT NULL);

\echo '### V3-50 FASON: sevk kalemi ile makbuz kaleminin ADIMI ayrisiyor mu'
SELECT sr."receiptNo", sr."stepId" makbuz_adim, sd."stepId" sevk_adim FROM subcontractor_receipt_items sri
JOIN subcontractor_receipts sr ON sr.id=sri."receiptId" JOIN subcontractor_dispatch_items sdi ON sdi.id=sri."sourceDispatchItemId"
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId" WHERE sr."stepId" <> sd."stepId";

\echo '### V3-51 FASON: makbuz WO ile sevk WO ayrismasi'
SELECT sr."receiptNo", sr."workOrderId", sd."workOrderId" FROM subcontractor_receipt_items sri
JOIN subcontractor_receipts sr ON sr.id=sri."receiptId" JOIN subcontractor_dispatch_items sdi ON sdi.id=sri."sourceDispatchItemId"
JOIN subcontractor_dispatches sd ON sd.id=sdi."dispatchId" WHERE sr."workOrderId" <> sd."workOrderId";

\echo '### V3-52 FASON: sourceDispatchItemId NULL kalem (acik-sevk guardini kacirir)'
SELECT count(*) FILTER (WHERE "sourceDispatchItemId" IS NULL) bagsiz, count(*) toplam FROM subcontractor_receipt_items;

\echo '### V3-53 BYPASS: acik atama var ama adim COMPLETED/SKIPPED'
SELECT kba.id, wo."workOrderNumber", s.status FROM kursun_bypass_assignments kba JOIN work_order_steps s ON s.id=kba."workOrderStepId" JOIN work_orders wo ON wo.id=kba."workOrderId"
WHERE kba."completedAt" IS NULL AND kba."cancelledAt" IS NULL AND s.status IN ('COMPLETED','SKIPPED');

\echo '### V3-54 PARTI: ayni WOda ayni numarali iki parti'
SELECT b."workOrderId", b."batchNumber", count(*) FROM batches b WHERE b."mergedIntoId" IS NULL GROUP BY 1,2 HAVING count(*)>1;

\echo '### V3-55 PARTI: topun partisi ile topun WO adimi ayrisiyor (INV-PAR-03 genis)'
SELECT r.barcode, r.status, b."batchNumber", b."workOrderId" parti_wo, s."workOrderId" adim_wo
FROM rolls r JOIN batches b ON b.id=r."batchId" LEFT JOIN work_order_steps s ON s.id=r."currentStepId"
WHERE s.id IS NOT NULL AND b."workOrderId" <> s."workOrderId";

\echo '### V3-56 WO: parametreler (rework kodu) dagilimi'
SELECT count(*) FILTER (WHERE parameters ? 'rework') rework, count(*) FROM work_orders;

\echo '### V3-57 KART: contentDirty ve WO son duzenleme iliskisi (bilgi)'
SELECT tc."contentDirty", count(*) FROM traveler_cards tc GROUP BY 1;

\echo '### V3-58 ADIM: ayni WOda ayni istasyon iki kez (bilgi)'
SELECT wo."workOrderNumber", st.name, count(*) FROM work_order_steps s JOIN work_orders wo ON wo.id=s."workOrderId" JOIN stations st ON st.id=s."stationId"
GROUP BY 1,2 HAVING count(*)>1;
