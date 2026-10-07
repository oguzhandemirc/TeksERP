-- Dağıtım iptali (`tekserp-paketiptal`: PAKET `pkt-*` + ISTEMCI `ist-*` satırları) — EKLEME-YALNIZ defter, `iptal_belgesi`nden
-- ayrı (kendi tekdüze `sira`sı). Ters mekanizma daha yüksek sıralı yeni belgedir; satır güncellenmez, silinmez.
-- Mevcut tablolara dokunmaz, yalnız ekler.
CREATE TABLE "paket_iptal_belgesi" (
    "id" UUID NOT NULL,
    "iptalId" UUID NOT NULL,
    "sira" INTEGER NOT NULL,
    "belge" TEXT NOT NULL,
    "imzalayanKid" VARCHAR(64) NOT NULL,
    "verilis" TIMESTAMPTZ NOT NULL,
    "kidler" TEXT[],
    "yukleyen" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paket_iptal_belgesi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paket_iptal_belgesi_sira_pozitif" CHECK ("sira" >= 1)
);

CREATE UNIQUE INDEX "paket_iptal_belgesi_iptalId_key" ON "paket_iptal_belgesi"("iptalId");
CREATE UNIQUE INDEX "paket_iptal_belgesi_sira_key" ON "paket_iptal_belgesi"("sira");

CREATE TRIGGER "paket_iptal_belgesi_defter" BEFORE UPDATE OR DELETE ON "paket_iptal_belgesi" FOR EACH ROW EXECUTE FUNCTION "defter_degismez"();
