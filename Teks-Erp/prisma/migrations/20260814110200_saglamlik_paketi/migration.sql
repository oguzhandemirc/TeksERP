-- =============================================================================
-- SAĞLAMLIK PAKETİ (2026-08-14) — docs/design/ON-MUHASEBE-SAGLAMLIK-TASARIM.md
-- =============================================================================
-- ⚠️ BURADA İKİ `DropForeignKey` SATIRI VARDI ve SİLİNDİ (bilinçli): `migrate
-- diff` DEFERRABLE composite FK'leri (rolls/swatches × sackId+shipmentId) her
-- diff'te düşürmek ister; uygulansaydı çuval↔sevkiyat tutarlılık seddi sessizce
-- kalkardı (schema.prisma:2557-2558, perf kuralı 4).

-- AlterTable
ALTER TABLE "cari_transactions" ADD COLUMN     "reversesTxnId" UUID;

-- AlterTable — ⚠️ ÜÇ ADIM, tek `NOT NULL` DEĞİL. Diff `ADD COLUMN ... NOT NULL`
-- üretti; bu, İZOLE ticaret DB'sinde (0 çek) çalışır ama VERİ TAŞIYAN bir
-- kurulumda migration'ı patlatırdı. Çok-firmalı satışta migration her kurulumda
-- koşar: nullable ekle → backfill (`postingDate = issueDate` — o kurulumun
-- defteri ZATEN issueDate'ten yazılmış, ekstre bayt-bayt değişmez) → NOT NULL.
ALTER TABLE "cheques" ADD COLUMN     "postingDate" TIMESTAMPTZ;
UPDATE "cheques" SET "postingDate" = "issueDate" WHERE "postingDate" IS NULL;
ALTER TABLE "cheques" ALTER COLUMN "postingDate" SET NOT NULL;

-- AlterTable
ALTER TABLE "yarn_movements" ADD COLUMN     "unitPrice" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "cash_period_closes" (
    "id" UUID NOT NULL,
    "cashBoxId" UUID,
    "bankAccountId" UUID,
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

    CONSTRAINT "cash_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_period_closes_cashBoxId_periodEnd_idx" ON "cash_period_closes"("cashBoxId", "periodEnd");

-- CreateIndex
CREATE INDEX "cash_period_closes_bankAccountId_periodEnd_idx" ON "cash_period_closes"("bankAccountId", "periodEnd");

-- ⚠️ ÜÇ PARTIAL UNIQUE — diff düz unique üretti, elle partial'a çevrildi
-- (cari_period_close_active_uq emsali; şemada @@unique KALIR, Prisma predicate
-- farkını drift saymaz). Envanter: scripts/test_db_invariants.ts.
--
-- Kapanış unique'leri `WHERE "reopenedAt" IS NULL`: düz unique olsaydı yeniden
-- açılan bir dönem BİR DAHA kapatılamazdı (eski satır anahtarı tutmaya devam
-- eder). Hesap kolonu predicate'e de girer (XOR gereği yarısı NULL — index
-- yalnız kendi tarafının satırlarını taşısın).
-- CreateIndex
CREATE UNIQUE INDEX "cash_period_close_box_active_uq" ON "cash_period_closes"("cashBoxId", "periodEnd")
  WHERE "reopenedAt" IS NULL AND "cashBoxId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cash_period_close_bank_active_uq" ON "cash_period_closes"("bankAccountId", "periodEnd")
  WHERE "reopenedAt" IS NULL AND "bankAccountId" IS NOT NULL;

-- Storno bağı: bir satır EN FAZLA BİR KEZ terslenebilir (çift storno P2002→409).
-- Null-yoğun kolon → partial (perf kuralı 4).
-- CreateIndex
CREATE UNIQUE INDEX "cari_transactions_reversesTxnId_key" ON "cari_transactions"("reversesTxnId")
  WHERE "reversesTxnId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_reversesTxnId_fkey" FOREIGN KEY ("reversesTxnId") REFERENCES "cari_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_period_closes" ADD CONSTRAINT "cash_period_closes_cashBoxId_fkey" FOREIGN KEY ("cashBoxId") REFERENCES "cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_period_closes" ADD CONSTRAINT "cash_period_closes_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- CHECK KISITLARI — envanter: scripts/test_db_invariants.ts
-- =============================================================================

-- Kapanış hesabı: kasa XOR banka (Payment/CashTransaction sözleşmesiyle aynı).
ALTER TABLE "cash_period_closes"
  ADD CONSTRAINT "cash_period_close_account_xor"
  CHECK (("cashBoxId" IS NULL) <> ("bankAccountId" IS NULL));

-- ⚠️ SINIF 4 SEDDİ (çift yönlü CAS'ın DB katmanı): parasız-terminal bir çekte
-- CANLI kapama tutarı OLAMAZ. Uygulama yüklemi (claimTx allocatedTotal=0 +
-- bumpChequeAllocated status süzgeci) bir gün atlanırsa — ham SQL, yeni geçiş
-- yolu, bekçisiz refactor — satırın kendisi direnir. COLLECTED bilinçli olarak
-- DIŞARIDA: tahsil edilmiş çeke kapama MEŞRUDUR (müşterinin ödemesi
-- gerçekleşti); dışlanan yalnız paranın YOK olduğu durumlardır.
ALTER TABLE "cheques"
  ADD CONSTRAINT "cheques_terminal_not_allocated"
  CHECK (NOT (status IN ('BOUNCED', 'RETURNED', 'CANCELLED') AND "allocatedTotal" > 0));
