-- CreateEnum
CREATE TYPE "CashTxnKind" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER_OUT', 'TRANSFER_IN', 'OPENING');

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "kind" "CashTxnKind" NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cashBoxId" UUID,
    "bankAccountId" UUID,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountTry" DECIMAL(14,2) NOT NULL,
    "txnDate" TIMESTAMPTZ NOT NULL,
    "category" VARCHAR(120),
    "description" VARCHAR(300),
    "reference" VARCHAR(120),
    "transferGroupId" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_docNo_key" ON "cash_transactions"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_clientToken_key"
  ON "cash_transactions"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex
CREATE INDEX "cash_transactions_cashBoxId_txnDate_idx" ON "cash_transactions"("cashBoxId", "txnDate");

-- CreateIndex
CREATE INDEX "cash_transactions_bankAccountId_txnDate_idx" ON "cash_transactions"("bankAccountId", "txnDate");

-- CreateIndex
CREATE INDEX "cash_transactions_kind_status_txnDate_idx" ON "cash_transactions"("kind", "status", "txnDate");

-- CreateIndex
CREATE INDEX "cash_transactions_transferGroupId_idx" ON "cash_transactions"("transferGroupId");

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashBoxId_fkey" FOREIGN KEY ("cashBoxId") REFERENCES "cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- ŞEMA-DIŞI SEDDLER
-- =============================================================================

-- Kasa XOR banka — Payment ile AYNI kural. İkisi birden işaretlenirse iki
-- bakiye birden oynar ve fark hiçbir raporda görünmez.
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_account_xor"
  CHECK (("cashBoxId" IS NOT NULL)::int + ("bankAccountId" IS NOT NULL)::int = 1);

-- Tutar POZİTİF — yön `direction` kolonunda yaşar (işaretli tutar, yönü iki
-- yerde saklamaktır: RollVariance/WarehouseMovement emsali).
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_amount_positive"
  CHECK ("amount" > 0 AND "amountTry" > 0);

ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_rate_positive" CHECK ("exchangeRate" > 0);

-- Tür ile yön TUTARLI olmak zorunda: gider/virman-çıkışı para ÇIKARIR,
-- gelir/virman-girişi/açılış para GİRDİRİR. Tutarsız satır, kasa defterini
-- okunamaz yapar ("gider ama bakiye artmış").
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_kind_matches_direction"
  CHECK (
    ("kind" IN ('EXPENSE', 'TRANSFER_OUT') AND "direction" = 'OUT') OR
    ("kind" IN ('INCOME', 'TRANSFER_IN', 'OPENING') AND "direction" = 'IN')
  );

-- Virman satırı grubunu TAŞIMAK ZORUNDA; tekil hareket taşıyamaz. Grupsuz bir
-- TRANSFER_OUT, karşı bacağı bulunamayan yarım virman demektir.
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_transfer_group"
  CHECK (
    (("kind" IN ('TRANSFER_OUT', 'TRANSFER_IN')) AND "transferGroupId" IS NOT NULL) OR
    (("kind" NOT IN ('TRANSFER_OUT', 'TRANSFER_IN')) AND "transferGroupId" IS NULL)
  );

-- İptal damgası BÜTÜN gelir (yarım durum yok — invoices_status_stamps emsali).
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_cancel_stamp"
  CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

-- AÇILIŞ HESAP BAŞINA TEK: ikinci bir devir satırı, "hangisi gerçek açılış"
-- sorusunu cevapsız bırakır ve bakiyeyi sessizce şişirir. İptal edilmiş açılış
-- yenisini ENGELLEMEZ (yanlış girilen devir iptal edilip tekrar girilebilir).
CREATE UNIQUE INDEX "cash_txn_one_opening_per_cashbox"
  ON "cash_transactions" ("cashBoxId")
  WHERE "kind" = 'OPENING' AND "cashBoxId" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "cash_txn_one_opening_per_bank"
  ON "cash_transactions" ("bankAccountId")
  WHERE "kind" = 'OPENING' AND "bankAccountId" IS NOT NULL AND "status" <> 'CANCELLED';
