-- CreateEnum
CREATE TYPE "RollVarianceKind" AS ENUM ('SCRAP', 'RECORD_CORRECTION', 'OVERAGE');

-- NOT: `prisma migrate dev` bu dosyayı üretirken iki DropForeignKey satırı da
-- ekledi (rolls_sackId_shipmentId_consistency_fkey + swatches_...). İkisi de ELLE
-- SİLİNDİ: o composite FK'lar Prisma datamodel'inde temsil edilemiyor, bu yüzden
-- her diff'te "fazlalık" sanılıp DROP edilmek isteniyor. Bırakılsaydı çuval/top
-- tutarlılık seddi sessizce kalkardı. Kural schema.prisma:2557-2558'de yazılı.

-- CreateTable
CREATE TABLE "roll_variances" (
    "id" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "workOrderStepId" UUID,
    "kind" "RollVarianceKind" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "reasonCode" VARCHAR(64),
    "reasonText" VARCHAR(500),
    "source" VARCHAR(64) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_variances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roll_variances_rollId_idx" ON "roll_variances"("rollId");

-- CreateIndex
CREATE INDEX "roll_variances_workOrderStepId_idx" ON "roll_variances"("workOrderStepId");

-- CreateIndex
CREATE INDEX "roll_variances_kind_createdAt_idx" ON "roll_variances"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "roll_variances_createdById_createdAt_idx" ON "roll_variances"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK: sapan metraj HER ZAMAN pozitif; yönü `kind` söyler.
-- Şemada temsil edilemez (Prisma native CHECK yok) → şema-dışı nesne.
-- ⚠️ `scripts/test_db_invariants.ts` envanterine EKLENDİ; oradan düşerse test kırmızı verir.
-- Neden sed: işaretli sayı saklamak "SUM(qty)" yazan her raporu sessizce yanlışlar
-- (biri işareti dikkate alır, diğeri almaz) ve bu, yıllar sonra fark edilir.
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_qty_positive" CHECK ("qty" > 0);
