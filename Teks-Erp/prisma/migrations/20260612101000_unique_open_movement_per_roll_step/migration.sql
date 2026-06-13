-- "Bir top bir adımda en fazla BİR açık movement" invariant'ının DB seddi.
--
-- Eşzamanlılık denetimi (BACKEND-CODE-REVIEW-2.md M-8): handleStepStart
-- check-then-create, handleStepSkip / kursunFinish çift-dokunuş yarışları
-- sonraki adımda mükerrer AÇIK movement yaratabiliyordu; mükerrer satırlar
-- finishStep RETURNING'i üzerinden ileriye de yayılıyordu. Servis katmanına
-- atomik claim'ler eklendi; bu partial unique, sınıfın TAMAMI için son
-- savunma hattıdır (kaybeden P2002 alır).
--
-- Drift notu: partial UNIQUE index Prisma diff'inde @@index ile EŞLEŞMEZ
-- (non-unique partial'ların aksine). Bu yüzden şemada @@index karşılığı YOK;
-- Prisma-dışı adlandırma kullanılır ve Prisma bu indexi tamamen yok sayar
-- (diff temiz — doğrulandı).
SET statement_timeout = 0;

-- Önce mevcut mükerrer açık movement'ları kapat (en yenisi açık kalır) —
-- test verisinde geçmiş yarışlardan kalan satır olabilir; unique aksi halde kurulamaz.
UPDATE "roll_movements"
SET "exitedAt" = NOW(),
    "notes" = CASE
      WHEN "notes" IS NULL OR "notes" = '' THEN 'DEDUP_OPEN_MOVEMENT'
      ELSE "notes" || ' | DEDUP_OPEN_MOVEMENT'
    END
WHERE "id" IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "rollId", "workOrderStepId"
             ORDER BY "enteredAt" DESC, id DESC
           ) AS rn
    FROM "roll_movements"
    WHERE "exitedAt" IS NULL
  ) t
  WHERE t.rn > 1
);

DROP INDEX IF EXISTS "roll_movements_one_open_per_roll_step_uq";
CREATE UNIQUE INDEX "roll_movements_one_open_per_roll_step_uq"
  ON "roll_movements" ("rollId", "workOrderStepId")
  WHERE "exitedAt" IS NULL;
