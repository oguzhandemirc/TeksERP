-- =============================================================================
-- Rollup Step Status — Veri Düzeltme Migration'ı
-- =============================================================================
-- Step durumunu RollMovement bazlı kurallara göre yeniden hesaplar:
--   - PENDING   → step için hiç movement yok
--   - ACTIVE    → en az bir açık movement (exitedAt IS NULL) var
--   - COMPLETED → hiç açık yok, tüm aktif roller bu step için kapalı movement'a sahip
--   - SKIPPED   → terminaldir, dokunulmaz
--
-- Yapısal şema değişikliği yok. Sadece tutarlılık için veri düzeltme.
-- =============================================================================

-- 1) Açık movement'ı olan tüm (non-SKIPPED) step'leri ACTIVE'e çek
UPDATE "work_order_steps" s
SET "status" = 'ACTIVE',
    "startedAt" = COALESCE(s."startedAt", NOW())
WHERE s."status" <> 'SKIPPED'
  AND s."status" <> 'ACTIVE'
  AND EXISTS (
    SELECT 1 FROM "roll_movements" m
    WHERE m."workOrderStepId" = s."id"
      AND m."exitedAt" IS NULL
  );

-- 2) Açık movement'ı olmayan, en az bir kapalı movement'ı olan ve bu step'e
--    girmeyi bekleyen aktif rollü kalmamış step'leri COMPLETED yap
UPDATE "work_order_steps" s
SET "status" = 'COMPLETED',
    "completedAt" = COALESCE(s."completedAt", NOW())
WHERE s."status" <> 'SKIPPED'
  AND s."status" <> 'COMPLETED'
  AND NOT EXISTS (
    SELECT 1 FROM "roll_movements" m
    WHERE m."workOrderStepId" = s."id"
      AND m."exitedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "roll_movements" m
    WHERE m."workOrderStepId" = s."id"
      AND m."exitedAt" IS NOT NULL
  )
  AND NOT EXISTS (
    -- Bu step'e henüz girmemiş ama iş emrinin üretiminde olan roll var mı?
    SELECT 1 FROM "rolls" r
    WHERE r."status" IN (
      'IN_PRODUCTION',
      'AT_SUBCONTRACTOR',
      'RETURNED_FROM_SUBCONTRACTOR',
      'A1_STOCK'
    )
      AND EXISTS (
        SELECT 1 FROM "roll_movements" rm
        INNER JOIN "work_order_steps" ws ON ws."id" = rm."workOrderStepId"
        WHERE rm."rollId" = r."id"
          AND ws."workOrderId" = s."workOrderId"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "roll_movements" rm2
        WHERE rm2."rollId" = r."id"
          AND rm2."workOrderStepId" = s."id"
      )
  );
