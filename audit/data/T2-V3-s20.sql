WITH adim AS (
  SELECT s.id, s.status::text AS kayitli, s."workOrderId", wo."workOrderNumber", wo.status::text AS wo_durum, s."stepSequence",
    (SELECT COUNT(*) FROM roll_movements rm JOIN rolls r ON r.id = rm."rollId"
      WHERE rm."workOrderStepId" = s.id AND rm."exitedAt" IS NULL AND r.status <> 'CANCELLED') AS acik,
    (SELECT COUNT(*) FROM roll_movements rm JOIN rolls r ON r.id = rm."rollId"
      WHERE rm."workOrderStepId" = s.id AND rm."exitedAt" IS NOT NULL AND r.status <> 'CANCELLED') AS kapali,
    (SELECT COUNT(*) FROM rolls r
      WHERE r.status IN ('IN_PRODUCTION','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR')
        AND EXISTS (SELECT 1 FROM roll_movements rm2
                    JOIN work_order_steps s2 ON s2.id = rm2."workOrderStepId"
                    WHERE rm2."rollId" = r.id AND s2."workOrderId" = s."workOrderId")
        AND NOT EXISTS (SELECT 1 FROM roll_movements rm3
                        WHERE rm3."rollId" = r.id AND rm3."workOrderStepId" = s.id)
        AND COALESCE((
              SELECT s2."stepSequence" FROM roll_movements rm4
              JOIN work_order_steps s2 ON s2.id = rm4."workOrderStepId"
              WHERE rm4."rollId" = r.id AND s2."workOrderId" = s."workOrderId"
              ORDER BY rm4."enteredAt" ASC LIMIT 1
            ), -1) <= s."stepSequence") AS bekleyen
  FROM work_order_steps s
  JOIN work_orders wo ON wo.id = s."workOrderId"
  WHERE s.status <> 'SKIPPED'
)
SELECT a.id, a."workOrderNumber", a.wo_durum, a."stepSequence", a.kayitli, a.acik, a.kapali, a.bekleyen,
       CASE WHEN a.acik > 0 THEN 'ACTIVE'
            WHEN a.kapali = 0 THEN 'PENDING'
            WHEN a.bekleyen = 0 THEN 'COMPLETED'
            ELSE 'ACTIVE' END AS beklenen
FROM adim a
WHERE a.kayitli <> (CASE WHEN a.acik > 0 THEN 'ACTIVE'
                         WHEN a.kapali = 0 THEN 'PENDING'
                         WHEN a.bekleyen = 0 THEN 'COMPLETED'
                         ELSE 'ACTIVE' END);
