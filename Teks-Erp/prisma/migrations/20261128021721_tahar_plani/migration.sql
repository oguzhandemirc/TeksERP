-- T1 (Seyitoğlu 2026-11-28): TAHAR PLANI ana verisi + kumaştan opsiyonel bağ — yalnız EKLEME (expand-only).
-- Eski kumaşlar NULL kalır (tahar planı yok = bugünkü görünüm: kumaş görünümü desen kartının tahar türünden çizilir).

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "drawingInPlanId" UUID;

-- CreateTable
CREATE TABLE "drawing_in_plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "frameCount" SMALLINT NOT NULL,
    "threading" INTEGER[] NOT NULL,
    "notation" VARCHAR(500) NOT NULL,
    "threadingKey" VARCHAR(64) NOT NULL,
    "selvedgeThreading" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "nameFold" TEXT GENERATED ALWAYS AS (public.tr_fold("name")) STORED,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "drawing_in_plans_pkey" PRIMARY KEY ("id")
);

-- Servis kapısının (constants/drawing-in-plan.ts) ikinci hattı: çerçeve 1..16, dizi 1..512 tel, eleman ≤ çerçeve sayısı.
ALTER TABLE "drawing_in_plans" ADD CONSTRAINT "drawing_in_plans_frame_count_chk"
  CHECK ("frameCount" BETWEEN 1 AND 16);
ALTER TABLE "drawing_in_plans" ADD CONSTRAINT "drawing_in_plans_threading_chk"
  CHECK (cardinality("threading") BETWEEN 1 AND 512 AND 1 <= ALL ("threading") AND "frameCount" >= ALL ("threading"));
ALTER TABLE "drawing_in_plans" ADD CONSTRAINT "drawing_in_plans_selvedge_threading_chk"
  CHECK (cardinality("selvedgeThreading") <= 512 AND 1 <= ALL ("selvedgeThreading") AND "frameCount" >= ALL ("selvedgeThreading"));

-- CreateIndex
CREATE UNIQUE INDEX "drawing_in_plans_code_key" ON "drawing_in_plans"("code");

-- CreateIndex
CREATE INDEX "drawing_in_plans_threadingKey_idx" ON "drawing_in_plans"("threadingKey");

-- CreateIndex
CREATE INDEX "drawing_in_plans_createdById_idx" ON "drawing_in_plans"("createdById");

-- CreateIndex
CREATE INDEX "drawing_in_plans_updatedById_idx" ON "drawing_in_plans"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "drawing_in_plans_nameFold_key" ON "drawing_in_plans"("nameFold");

-- CreateIndex
CREATE INDEX "items_drawingInPlanId_idx" ON "items"("drawingInPlanId");

-- AddForeignKey
ALTER TABLE "drawing_in_plans" ADD CONSTRAINT "drawing_in_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_in_plans" ADD CONSTRAINT "drawing_in_plans_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_drawingInPlanId_fkey" FOREIGN KEY ("drawingInPlanId") REFERENCES "drawing_in_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
