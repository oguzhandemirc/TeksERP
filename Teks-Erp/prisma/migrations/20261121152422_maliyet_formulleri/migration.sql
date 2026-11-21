-- SY-C1: ek maliyet formülleri — damgalı sürüm (YarnCostPrice deseni); yalnız EKLEME.

-- CreateTable
CREATE TABLE "cost_formulas" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "expression" VARCHAR(500) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "sortOrder" SMALLINT NOT NULL DEFAULT 0,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "note" VARCHAR(300),
    "revokedAt" TIMESTAMPTZ,
    "revokedById" UUID,
    "revokeReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,

    CONSTRAINT "cost_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_formulas_code_createdAt_idx" ON "cost_formulas"("code", "createdAt");

-- CreateIndex
CREATE INDEX "cost_formulas_createdById_idx" ON "cost_formulas"("createdById");

-- AddForeignKey
ALTER TABLE "cost_formulas" ADD CONSTRAINT "cost_formulas_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DB SEDLERİ: kod başına TEK AKTİF sürüm (damgalı geçmiş serbest) + sıra/sürüm/ifade CHECK'leri.
CREATE UNIQUE INDEX "cost_formulas_active_code_uq" ON "cost_formulas"("code")
  WHERE "revokedAt" IS NULL;
ALTER TABLE "cost_formulas" ADD CONSTRAINT "cost_formulas_sort_order_ck" CHECK ("sortOrder" >= 0);
ALTER TABLE "cost_formulas" ADD CONSTRAINT "cost_formulas_version_no_ck" CHECK ("versionNo" >= 1);
ALTER TABLE "cost_formulas" ADD CONSTRAINT "cost_formulas_expression_ck" CHECK (length(btrim("expression")) > 0);
