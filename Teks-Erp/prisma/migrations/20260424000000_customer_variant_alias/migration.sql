-- CustomerVariantAlias: aynı desen her müşteride farklı adla geçebilir.
CREATE TABLE "customer_variant_aliases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "customerLabel" TEXT NOT NULL,
    "customerCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_variant_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_variant_aliases_customerId_variantId_key"
    ON "customer_variant_aliases"("customerId", "variantId");
CREATE INDEX "customer_variant_aliases_customerId_idx"
    ON "customer_variant_aliases"("customerId");
CREATE INDEX "customer_variant_aliases_variantId_idx"
    ON "customer_variant_aliases"("variantId");

ALTER TABLE "customer_variant_aliases"
    ADD CONSTRAINT "customer_variant_aliases_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_variant_aliases"
    ADD CONSTRAINT "customer_variant_aliases_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "item_variants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
