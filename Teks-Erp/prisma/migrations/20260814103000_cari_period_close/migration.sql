-- =============================================================================
-- Cari dönem kapanışı (C3 · M4, 2026-08-14)
-- =============================================================================
-- Kapanış bir FOTOĞRAFTIR ("31.12.2025 itibarıyla bakiye"), bir hareket değil →
-- `cari_transactions`'a satır YAZMAZ. Yazsaydı bir sonraki ekstre aynı tutarı
-- hem devir satırında hem hareketlerde sayardı.
--
-- ⚠️ `periodEnd` DATE (timestamptz DEĞİL): takvim günü anahtarı. Timestamptz
-- olsaydı gün sınırı saat dilimine bağlanır ve aynı kapanış iki satıra
-- düşebilirdi (`exchange_rates.rateDate` emsali). `test_timestamptz_contract`
-- muaf listesinde gerekçesiyle kayıtlı.
--
-- ⚠️ `prisma migrate diff` çıktısındaki İKİ `DropForeignKey` satırı BİLİNÇLİ
-- OLARAK ALINMADI (DEFERRABLE composite FK'lar — bkz. 20260814101000 notu).
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: yeni tablo boş doğar, mevcut hiçbir sorgu ona
-- dokunmaz. Kapanış yüzeyi `finance.enabled` + `finance:close` arkasında.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

-- CreateTable
CREATE TABLE "cari_period_closes" (
    "id" UUID NOT NULL,
    "cariId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "periodEnd" DATE NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "txnCount" INTEGER NOT NULL,
    "notes" VARCHAR(500),
    "closedById" UUID,
    "reopenedAt" TIMESTAMPTZ,
    "reopenedById" UUID,
    "reopenReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cari_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cari_period_closes_cariId_periodEnd_idx" ON "cari_period_closes"("cariId", "periodEnd");

-- CreateIndex
-- AKTİF KAPANIŞ BAŞINA TEK SATIR — ve PARTIAL olması ZORUNLU.
-- Düz unique olsaydı yeniden açılan (reopen) bir dönem BİR DAHA kapatılamazdı:
-- eski satır aynı anahtarı tutmaya devam eder, ikinci kapanış P2002 alırdı.
-- Reopen satırı SİLMEZ (iz kalsın diye), o yüzden benzersizlik yalnız "hâlâ
-- kapalı" satırlar üzerinde tanımlanır. Emsal: cash_txn_one_opening_per_cashbox.
CREATE UNIQUE INDEX "cari_period_close_active_uq"
  ON "cari_period_closes"("cariId", "currency", "periodEnd")
  WHERE "reopenedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "cari_period_closes" ADD CONSTRAINT "cari_period_closes_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
