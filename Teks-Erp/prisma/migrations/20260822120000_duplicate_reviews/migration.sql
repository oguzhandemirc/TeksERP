-- =============================================================================
-- MÜKERRER İNCELEME KUYRUĞU — duplicate_reviews · 2026-08-22 (mükerrer paneli v2 P1)
-- =============================================================================
-- Tespit motoru adayları her taramada yeniden hesaplar; saklanan şey KARARDIR:
-- "mükerrer değil" (kuyruktan kalıcı düşer) · "birleştirildi" (motor yazar) ·
-- "ertelendi". Karar ÇİFT bazlı (pairKey = küçük id:büyük id). Yeni tablo,
-- additive; mevcut tablolara DOKUNMAZ.
-- =============================================================================
CREATE TYPE "DuplicateReviewEntity" AS ENUM ('CUSTOMER', 'ITEM', 'COLOR', 'SUBCONTRACTOR');
CREATE TYPE "DuplicateReviewDecision" AS ENUM ('NOT_DUPLICATE', 'MERGED', 'DEFERRED');

CREATE TABLE "duplicate_reviews" (
    "id" UUID NOT NULL,
    "entity" "DuplicateReviewEntity" NOT NULL,
    "pairKey" VARCHAR(80) NOT NULL,
    "aId" UUID NOT NULL,
    "bId" UUID NOT NULL,
    "decision" "DuplicateReviewDecision" NOT NULL,
    "evidence" JSONB,
    "note" VARCHAR(500),
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "duplicate_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duplicate_reviews_entity_pairKey_key" ON "duplicate_reviews"("entity", "pairKey");
CREATE INDEX "duplicate_reviews_entity_decision_idx" ON "duplicate_reviews"("entity", "decision");

ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
