-- D4-I1a (ister 4.7): cari kilidi — DURUM + tarihçe, defter değil. Toplu DELETE/UPDATE yok; yalnız yeni tablo.
-- CreateTable
CREATE TABLE "cari_holds" (
    "id" UUID NOT NULL,
    "cariId" UUID NOT NULL,
    "blocksIntake" BOOLEAN NOT NULL DEFAULT false,
    "blocksShipment" BOOLEAN NOT NULL DEFAULT false,
    "blocksInvoice" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" VARCHAR(40) NOT NULL,
    "reasonText" VARCHAR(300),
    "placedById" UUID NOT NULL,
    "releasedAt" TIMESTAMPTZ,
    "releasedById" UUID,
    "releaseReason" VARCHAR(300),
    "clientToken" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cari_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cari_holds_clientToken_key" ON "cari_holds"("clientToken");

-- CreateIndex
CREATE INDEX "cari_holds_cariId_createdAt_idx" ON "cari_holds"("cariId", "createdAt");

-- AddForeignKey
ALTER TABLE "cari_holds" ADD CONSTRAINT "cari_holds_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hesap başına en çok bir AKTİF kilit; açılmış satır tarihçedir (yeniden kilit yeni satır). Prisma ifade edemez.
CREATE UNIQUE INDEX "cari_holds_active_cariId_key" ON "cari_holds"("cariId") WHERE "releasedAt" IS NULL;

-- Kapsamsız kilit anlamsız: en az bir kapı seçilir.
ALTER TABLE "cari_holds" ADD CONSTRAINT "cari_holds_scope_chk" CHECK ("blocksIntake" OR "blocksShipment" OR "blocksInvoice");

-- Açma damgası açanı taşır (kim açtı görünür kalsın).
ALTER TABLE "cari_holds" ADD CONSTRAINT "cari_holds_release_actor_chk" CHECK ("releasedAt" IS NULL OR "releasedById" IS NOT NULL);
