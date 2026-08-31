-- CreateEnum
CREATE TYPE "CariKind" AS ENUM ('CUSTOMER', 'SUBCONTRACTOR');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALES', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CariTxnSource" AS ENUM ('INVOICE', 'INVOICE_CANCEL', 'PAYMENT', 'PAYMENT_CANCEL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('MANUAL', 'TCMB');

-- CreateTable
CREATE TABLE "cari_accounts" (
    "id" UUID NOT NULL,
    "kind" "CariKind" NOT NULL,
    "customerId" UUID,
    "subcontractorId" UUID,
    "taxOffice" VARCHAR(100),
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'TRY',
    "paymentTermDays" INTEGER,
    "riskLimit" DECIMAL(14,2),
    "notes" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cari_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_balances" (
    "cariId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cari_balances_pkey" PRIMARY KEY ("cariId","currency")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "cariId" UUID NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMPTZ NOT NULL,
    "dueDate" TIMESTAMPTZ,
    "externalNo" VARCHAR(64),
    "notes" VARCHAR(500),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "withholdingTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotalTry" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipmentId" UUID,
    "directShipmentId" UUID,
    "returnGroupId" UUID,
    "subcontractorReceiptId" UUID,
    "confirmedAt" TIMESTAMPTZ,
    "confirmedById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID,
    "description" VARCHAR(300) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(16) NOT NULL DEFAULT 'm',
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "withholdingRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cari_transactions" (
    "id" UUID NOT NULL,
    "cariId" UUID NOT NULL,
    "currency" "Currency" NOT NULL,
    "txnDate" TIMESTAMPTZ NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amountTry" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "sourceType" "CariTxnSource" NOT NULL,
    "invoiceId" UUID,
    "paymentId" UUID,
    "description" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cari_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cariId" UUID NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountTry" DECIMAL(14,2) NOT NULL,
    "cashBoxId" UUID,
    "bankAccountId" UUID,
    "paymentDate" TIMESTAMPTZ NOT NULL,
    "reference" VARCHAR(120),
    "notes" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_boxes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cash_boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "bankName" VARCHAR(100),
    "iban" VARCHAR(34),
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "rateDate" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cari_accounts_customerId_key" ON "cari_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "cari_accounts_subcontractorId_key" ON "cari_accounts"("subcontractorId");

-- CreateIndex
CREATE INDEX "cari_accounts_kind_isActive_idx" ON "cari_accounts"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_docNo_key" ON "invoices"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_clientToken_key" ON "invoices"("clientToken");

-- CreateIndex
CREATE INDEX "invoices_cariId_status_issueDate_idx" ON "invoices"("cariId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_type_status_issueDate_idx" ON "invoices"("type", "status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_status_issueDate_idx" ON "invoices"("status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_shipmentId_idx" ON "invoices"("shipmentId");

-- CreateIndex
CREATE INDEX "invoices_directShipmentId_idx" ON "invoices"("directShipmentId");

-- CreateIndex
CREATE INDEX "invoices_returnGroupId_idx" ON "invoices"("returnGroupId");

-- CreateIndex
CREATE INDEX "invoices_subcontractorReceiptId_idx" ON "invoices"("subcontractorReceiptId");

-- CreateIndex
CREATE INDEX "invoice_lines_itemId_idx" ON "invoice_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoiceId_lineNo_key" ON "invoice_lines"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "cari_transactions_cariId_currency_txnDate_idx" ON "cari_transactions"("cariId", "currency", "txnDate");

-- CreateIndex
CREATE INDEX "cari_transactions_invoiceId_idx" ON "cari_transactions"("invoiceId");

-- CreateIndex
CREATE INDEX "cari_transactions_paymentId_idx" ON "cari_transactions"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_docNo_key" ON "payments"("docNo");

-- CreateIndex
CREATE UNIQUE INDEX "payments_clientToken_key" ON "payments"("clientToken");

-- CreateIndex
CREATE INDEX "payments_cariId_status_paymentDate_idx" ON "payments"("cariId", "status", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_direction_status_paymentDate_idx" ON "payments"("direction", "status", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_cashBoxId_paymentDate_idx" ON "payments"("cashBoxId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_bankAccountId_paymentDate_idx" ON "payments"("bankAccountId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "cash_boxes_code_key" ON "cash_boxes"("code");

-- CreateIndex
CREATE INDEX "cash_boxes_isActive_idx" ON "cash_boxes"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_code_key" ON "bank_accounts"("code");

-- CreateIndex
CREATE INDEX "bank_accounts_isActive_idx" ON "bank_accounts"("isActive");

-- CreateIndex
CREATE INDEX "exchange_rates_currency_rateDate_idx" ON "exchange_rates"("currency", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_rateDate_currency_key" ON "exchange_rates"("rateDate", "currency");

-- AddForeignKey
ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_balances" ADD CONSTRAINT "cari_balances_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_directShipmentId_fkey" FOREIGN KEY ("directShipmentId") REFERENCES "direct_shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subcontractorReceiptId_fkey" FOREIGN KEY ("subcontractorReceiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashBoxId_fkey" FOREIGN KEY ("cashBoxId") REFERENCES "cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- ŞEMA-DIŞI SEDDLER — Prisma datamodel'inde temsil edilemeyenler
-- =============================================================================
-- ⚠️ Hepsi `scripts/test_db_invariants.ts` envanterine YAZILMIŞTIR. Envantere
-- yazılmayan şema-dışı nesne, bir sonraki kolon DROP+ADD eden migration'da
-- sessizce kaybolur (2026-06 vakası: 9 partial index tam index'e döndü).
-- =============================================================================

-- ── 1) "BİR KAYNAK → EN ÇOK BİR AKTİF FATURA" ────────────────────────────────
-- Aynı sevkiyat iki kez faturalanırsa cari bakiyesi sessizce İKİ KATINA çıkar
-- ve bunu fark etmenin tek yolu ay sonunda müşteriyle yüzleşmektir. Uygulama
-- katmanındaki bir kontrol (findFirst → if → create) yarışa açıktır; yapısal
-- engel PARTIAL UNIQUE'tir.
--
-- `status <> 'CANCELLED'`: iptal edilmiş fatura yerinde KALIR (donmuş belge
-- silinmez) ama yeni bir fatura kesilmesini engellememelidir — storno'nun tüm
-- amacı budur.
CREATE UNIQUE INDEX "invoices_one_active_per_shipment"
  ON "invoices" ("shipmentId")
  WHERE "shipmentId" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "invoices_one_active_per_direct_shipment"
  ON "invoices" ("directShipmentId")
  WHERE "directShipmentId" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "invoices_one_active_per_return_group"
  ON "invoices" ("returnGroupId")
  WHERE "returnGroupId" IS NOT NULL AND "status" <> 'CANCELLED';

CREATE UNIQUE INDEX "invoices_one_active_per_subcon_receipt"
  ON "invoices" ("subcontractorReceiptId")
  WHERE "subcontractorReceiptId" IS NOT NULL AND "status" <> 'CANCELLED';

-- ── 2) CARİ HESAP: customerId XOR subcontractorId ────────────────────────────
-- Bir cari ya müşteridir ya fasondur. İkisi birden dolu olursa ekstre hangi
-- tarafın borcu olduğunu söyleyemez; ikisi de boşsa hesap kime aittir?
ALTER TABLE "cari_accounts"
  ADD CONSTRAINT "cari_accounts_party_xor"
  CHECK (("customerId" IS NOT NULL)::int + ("subcontractorId" IS NOT NULL)::int = 1);

-- `kind` ile dolu olan taraf TUTARLI olmalı — `kind` yalnız bir etiket değil,
-- sorguların filtrelediği kolondur (kind='CUSTOMER' ama subcontractorId dolu
-- olsaydı müşteri listesi o cariyi hiç göstermezdi).
ALTER TABLE "cari_accounts"
  ADD CONSTRAINT "cari_accounts_kind_matches_party"
  CHECK (
    ("kind" = 'CUSTOMER' AND "customerId" IS NOT NULL) OR
    ("kind" = 'SUBCONTRACTOR' AND "subcontractorId" IS NOT NULL)
  );

-- ── 3) ÖDEME: kasa XOR banka ─────────────────────────────────────────────────
-- Para ya kasadan ya bankadan çıkar. İkisi birden işaretlenirse iki bakiye
-- birden düşer ve fark hiçbir raporda görünmez.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_account_xor"
  CHECK (("cashBoxId" IS NOT NULL)::int + ("bankAccountId" IS NOT NULL)::int = 1);

-- Tutar POZİTİF — yön `direction` kolonunda yaşar (RollVariance/WarehouseMovement
-- emsali: işaretli tutar, yönü iki yerde saklamak demektir ve ikisi ayrışır).
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive"
  CHECK ("amount" > 0 AND "amountTry" > 0);

-- ── 4) CARİ HAREKET: borç XOR alacak, ikisi de negatif olamaz ────────────────
-- Muhasebede bir satır ya borçtur ya alacak. "Negatif borç" diye bir şey yoktur;
-- düzeltme ters satırla yapılır (append-only defterin tüm mantığı budur).
ALTER TABLE "cari_transactions"
  ADD CONSTRAINT "cari_txn_debit_credit_xor"
  CHECK (
    "debit" >= 0 AND "credit" >= 0 AND
    (("debit" > 0)::int + ("credit" > 0)::int) = 1
  );

-- ── 5) FATURA: onay/iptal damgaları BÜTÜN gelir ──────────────────────────────
-- Yarım durum yoktur: "onaylandı ama kim/ne zaman belli değil" bir fatura,
-- denetimde hiçbir şey kanıtlamaz.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_status_stamps"
  CHECK (
    ("status" <> 'CONFIRMED' OR "confirmedAt" IS NOT NULL) AND
    ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL)
  );

-- Kur POZİTİF — 0 kur, TL karşılığını sessizce 0 yapardı.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_rate_positive" CHECK ("exchangeRate" > 0);
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_rate_positive" CHECK ("exchangeRate" > 0);
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_rate_positive" CHECK ("rate" > 0);

-- ── 6) FATURA SATIRI: miktar ve fiyat negatif olamaz ─────────────────────────
-- İade faturası da POZİTİF satır taşır — yönü `type` (SALES_RETURN) söyler.
-- Negatif satırla iade yazmak, aynı bilgiyi iki yerde saklamaktır.
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_positive"
  CHECK ("qty" > 0 AND "unitPrice" >= 0 AND "discountRate" >= 0 AND "vatRate" >= 0 AND "withholdingRate" >= 0);
