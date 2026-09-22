-- Sevk partisi / paketleme grubu: kalıcı, kurulum-geneli tekil kod `PRT-YYMM-NNNN`.
-- Devralınan satırlar fabrika ayına (Europe/Istanbul) göre, createdAt sırasıyla kodlanır;
-- sonra kolon NOT NULL + UNIQUE olur. Geri alınamaz (rollback = yedekten restore).
ALTER TABLE "packing_groups" ADD COLUMN "code" VARCHAR(16);

UPDATE "packing_groups" pg
SET "code" = s.code
FROM (
  SELECT id,
         'PRT-' || to_char("createdAt" AT TIME ZONE 'Europe/Istanbul', 'YYMM') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY to_char("createdAt" AT TIME ZONE 'Europe/Istanbul', 'YYMM')
           ORDER BY "createdAt", id
         )::text, 4, '0') AS code
  FROM "packing_groups"
) s
WHERE pg.id = s.id AND pg."code" IS NULL;

ALTER TABLE "packing_groups" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "packing_groups_code_key" ON "packing_groups"("code");
