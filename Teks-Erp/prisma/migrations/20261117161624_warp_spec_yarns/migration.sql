-- FASON DEVERE D1 (2026-11-17) — çok iplikli çözgü kartı. YALNIZ EKLEME: mevcut kolonlar yerinde kalır,
-- tek iplikli kartlar bayt-aynı çalışır. Her mevcut karta TEK satır geri doldurulur (yeniden koşulabilir).

-- AlterTable
ALTER TABLE "warp_specs" ADD COLUMN     "sequenceNote" VARCHAR(160);

-- CreateTable
CREATE TABLE "warp_spec_yarns" (
    "id" UUID NOT NULL,
    "warpSpecId" UUID NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "endsCount" INTEGER NOT NULL,
    "sortOrder" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warp_spec_yarns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warp_spec_yarns_yarnItemId_idx" ON "warp_spec_yarns"("yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "warp_spec_yarns_warpSpecId_yarnItemId_key" ON "warp_spec_yarns"("warpSpecId", "yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "warp_spec_yarns_warpSpecId_sortOrder_key" ON "warp_spec_yarns"("warpSpecId", "sortOrder");

-- AddForeignKey
ALTER TABLE "warp_spec_yarns" ADD CONSTRAINT "warp_spec_yarns_warpSpecId_fkey" FOREIGN KEY ("warpSpecId") REFERENCES "warp_specs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_spec_yarns" ADD CONSTRAINT "warp_spec_yarns_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddi (`test_db_invariants` envanteri): tel > 0, sıra ≥ 0.
ALTER TABLE "warp_spec_yarns" ADD CONSTRAINT "warp_spec_yarns_ends_ck" CHECK ("endsCount" > 0 AND "sortOrder" >= 0);

-- Geri doldurma: her mevcut karta kolonlarından TEK satır (ana iplik, toplam tel, sıra 0). `WHERE NOT EXISTS` ile
-- yeniden koşulabilir; satırı olan kart atlanır.
INSERT INTO "warp_spec_yarns" ("id", "warpSpecId", "yarnItemId", "endsCount", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid(), ws."id", ws."yarnItemId", ws."endsCount", 0, ws."createdAt", ws."updatedAt"
FROM "warp_specs" ws
WHERE NOT EXISTS (SELECT 1 FROM "warp_spec_yarns" y WHERE y."warpSpecId" = ws."id");
