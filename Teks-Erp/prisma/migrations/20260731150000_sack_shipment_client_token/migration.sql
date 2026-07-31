-- G-7 (2026-07-31 denetimi A4): Sack + Shipment idempotency anahtari.
-- Roll/Order/WorkOrder paritesi — nullable + unique (NULL'lar cakismaz), eski
-- istemci token gondermez, davranis degismez. Elle yazildi (migrate dev'in
-- sacks composite-FK drop tuzagindan kacinmak icin — schema.prisma:2557-2558).
-- Unique index adlari Prisma @unique konvansiyonu (_key) ile birebir.
SET statement_timeout = 0;

ALTER TABLE "sacks"     ADD COLUMN "clientToken" UUID;
ALTER TABLE "shipments" ADD COLUMN "clientToken" UUID;

CREATE UNIQUE INDEX "sacks_clientToken_key"     ON "sacks"("clientToken");
CREATE UNIQUE INDEX "shipments_clientToken_key" ON "shipments"("clientToken");
