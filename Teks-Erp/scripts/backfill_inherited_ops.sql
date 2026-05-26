-- Tek seferlik backfill: cutOpenFabric bug fix öncesi oluşturulmuş Tambur
-- child roll'larına parent açık kumaşın KURSUN_APPLIED + QC2_COMPLETED
-- operasyonlarını inherit olarak kopyala.
--
-- Idempotent: NOT EXISTS koşulu sayesinde tekrar çalıştırılırsa duplicate
-- oluşturmaz. inheritedFromParentRollId = parent.id ile inherit kaynağı işaretli.

INSERT INTO roll_operations (
  id, "rollId", "workOrderStepId", "operationType",
  "operatorId", metadata, "inheritedFromParentRollId", "createdAt"
)
SELECT
  gen_random_uuid(),
  child.id,
  parent_op."workOrderStepId",
  parent_op."operationType",
  parent_op."operatorId",
  parent_op.metadata,
  parent.id,
  NOW()
FROM rolls child
JOIN rolls parent ON parent.id = child."parentRollId"
JOIN roll_operations parent_op ON parent_op."rollId" = parent.id
WHERE parent."entrySource" = 'SUBCONTRACTOR_RETURN'
  AND parent_op."operationType" IN ('KURSUN_APPLIED', 'QC2_COMPLETED')
  AND parent_op."inheritedFromParentRollId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM roll_operations existing
    WHERE existing."rollId" = child.id
      AND existing."operationType" = parent_op."operationType"
  );
