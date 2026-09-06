-- BULGU-T3-004 — iş emri kapanış phantom'u (Tambur geri alma WO kilidi almıyor)
-- Amaç: WO COMPLETED iken adımında hâlâ canlı (IN_PRODUCTION) top ve/veya açık
-- (exitedAt IS NULL) hareket bırakan satırları bul — bu bulgu senaryosunun DB'de
-- iz bırakmış olabileceği pencereyi arar (test_consistency §20 sınıfı invariant).

SELECT
  w."workOrderNumber",
  w.status                                                        AS wo_status,
  s.id                                                             AS step_id,
  s.status                                                         AS step_status,
  COUNT(r.id) FILTER (WHERE r.status = 'IN_PRODUCTION')            AS canli_top,
  COUNT(m.id) FILTER (WHERE m."exitedAt" IS NULL)                  AS acik_hareket
FROM work_orders w
JOIN work_order_steps s ON s."workOrderId" = w.id
LEFT JOIN rolls r
  ON r."currentStepId" = s.id AND r.status = 'IN_PRODUCTION'
LEFT JOIN roll_movements m
  ON m."workOrderStepId" = s.id AND m."exitedAt" IS NULL
WHERE w.status = 'COMPLETED'
GROUP BY 1, 2, 3, 4
HAVING COUNT(r.id) FILTER (WHERE r.status = 'IN_PRODUCTION') > 0
    OR COUNT(m.id) FILTER (WHERE m."exitedAt" IS NULL) > 0;
