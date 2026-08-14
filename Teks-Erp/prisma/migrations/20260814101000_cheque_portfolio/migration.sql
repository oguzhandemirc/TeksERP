-- =============================================================================
-- Çek / senet portföyü (C1 · M2, 2026-08-14)
-- =============================================================================
-- İki yeni tablo (`cheques` başlık + `cheque_events` append-only durum defteri),
-- dört yeni enum ve `cari_transactions.chequeId` bağı.
--
-- ⚠️ M1'DEN SONRA KOŞMAK ZORUNDA: bu tabloların yazacağı `CariTxnSource` değerleri
-- (CHEQUE_*) 20260814100000'de eklendi. PG'de aynı transaction içinde eklenip
-- kullanılamadıkları için sıra pazarlık dışıdır.
--
-- ⚠️ `prisma migrate diff` çıktısındaki İKİ `DropForeignKey` satırı BİLİNÇLİ
-- OLARAK ALINMADI (`rolls_sackId_shipmentId_consistency_fkey` +
-- `swatches_...`): datamodel'de temsil edilemeyen DEFERRABLE composite FK'lar
-- her diff'te spurious DROP üretir (`schema.prisma` uyarısı + test_schema_drift
-- allowlist'i). Uygulanırlarsa çuval/sevkiyat tutarlılık seddi sessizce düşer.
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: yeni tablolar boş doğar, mevcut hiçbir sorgu
-- onlara dokunmaz; `cari_transactions`'a eklenen kolon NULLABLE ve DEFAULT'suz
-- (PG11+ metadata-only, tablo yeniden yazılmaz). Yüzeyler `finance.enabled`
-- rejiminin arkasında.
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

-- CreateEnum
CREATE TYPE "ChequeKind" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "ChequeDocType" AS ENUM ('CHEQUE', 'PROMISSORY_NOTE');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('PORTFOLIO', 'AT_BANK', 'ENDORSED', 'COLLECTED', 'BOUNCED', 'RETURNED', 'ISSUED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChequeEventType" AS ENUM ('RECEIVE', 'ISSUE', 'DEPOSIT', 'COLLECT', 'ENDORSE', 'BOUNCE', 'RETURN', 'PAY', 'CANCEL');

-- AlterTable
ALTER TABLE "cari_transactions" ADD COLUMN     "chequeId" UUID;

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "kind" "ChequeKind" NOT NULL,
    "docType" "ChequeDocType" NOT NULL DEFAULT 'CHEQUE',
    "status" "ChequeStatus" NOT NULL,
    "cariId" UUID NOT NULL,
    "endorsedToCariId" UUID,
    "bankAccountId" UUID,
    "currency" "Currency" NOT NULL DEFAULT 'TRY',
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountTry" DECIMAL(14,2) NOT NULL,
    "issueDate" TIMESTAMPTZ NOT NULL,
    "dueDate" TIMESTAMPTZ NOT NULL,
    "serialNo" VARCHAR(64),
    "bankName" VARCHAR(100),
    "branchName" VARCHAR(100),
    "drawerName" VARCHAR(150),
    "notes" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "clientToken" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_events" (
    "id" UUID NOT NULL,
    "chequeId" UUID NOT NULL,
    "type" "ChequeEventType" NOT NULL,
    "fromStatus" "ChequeStatus",
    "toStatus" "ChequeStatus" NOT NULL,
    "eventDate" TIMESTAMPTZ NOT NULL,
    "counterCariId" UUID,
    "bankAccountId" UUID,
    "cashBoxId" UUID,
    "notes" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cheques_docNo_key" ON "cheques"("docNo");

-- CreateIndex
-- PARTIAL: idempotency anahtarı taşımayan satırlar (panelden elle girilen çek)
-- indekse hiç girmesin — projenin yerleşik `clientToken` konvansiyonu.
CREATE UNIQUE INDEX "cheques_clientToken_key"
  ON "cheques"("clientToken") WHERE "clientToken" IS NOT NULL;

-- CreateIndex
CREATE INDEX "cheques_cariId_status_dueDate_idx" ON "cheques"("cariId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "cheques_status_dueDate_idx" ON "cheques"("status", "dueDate");

-- CreateIndex
CREATE INDEX "cheques_endorsedToCariId_idx" ON "cheques"("endorsedToCariId");

-- CreateIndex
CREATE INDEX "cheques_bankAccountId_idx" ON "cheques"("bankAccountId");

-- CreateIndex
CREATE INDEX "cheque_events_chequeId_eventDate_idx" ON "cheque_events"("chequeId", "eventDate");

-- CreateIndex
CREATE INDEX "cheque_events_type_eventDate_idx" ON "cheque_events"("type", "eventDate");

-- CreateIndex
CREATE INDEX "cheque_events_bankAccountId_eventDate_idx" ON "cheque_events"("bankAccountId", "eventDate");

-- CreateIndex
CREATE INDEX "cheque_events_cashBoxId_eventDate_idx" ON "cheque_events"("cashBoxId", "eventDate");

-- CreateIndex
CREATE INDEX "cheque_events_counterCariId_idx" ON "cheque_events"("counterCariId");

-- CreateIndex
CREATE INDEX "cari_transactions_chequeId_idx" ON "cari_transactions"("chequeId");

-- AddForeignKey
ALTER TABLE "cari_transactions" ADD CONSTRAINT "cari_transactions_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_endorsedToCariId_fkey" FOREIGN KEY ("endorsedToCariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_counterCariId_fkey" FOREIGN KEY ("counterCariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_cashBoxId_fkey" FOREIGN KEY ("cashBoxId") REFERENCES "cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- ŞEMA-DIŞI SEDDLER — hepsi `scripts/test_db_invariants.ts` envanterinde
-- =============================================================================

-- Tutar POZİTİF. Sıfır tutarlı çek diye bir şey yoktur; negatif tutar ise yönü
-- ikinci bir yerde saklamak demektir (yön `kind` + defter satırındadır).
ALTER TABLE "cheques"
  ADD CONSTRAINT "cheques_amount_positive"
  CHECK ("amount" > 0 AND "amountTry" > 0);

-- Kur damgası pozitif — 0 kur, TL karşılığını sessizce sıfırlar.
ALTER TABLE "cheques"
  ADD CONSTRAINT "cheques_rate_positive" CHECK ("exchangeRate" > 0);

-- CİRO TUTARLILIĞI. Planın yazdığı KATI çift-yönlü eşitlik
-- (`status='ENDORSED' = endorsedToCariId IS NOT NULL`) UYGULANAMAZ ve bunun
-- sebebi planın KENDİ kuralıdır: "BOUNCE → ENDORSED'dan geldiyse ciro carisine
-- ters CREDIT". Yani ciro edilmiş bir çek karşılıksız çıktığında durum
-- BOUNCED'a geçer ama ciro carisi hâlâ BİLİNMEK ZORUNDADIR (ters kayıt ona
-- yazılacak). Katı eşitlik bu geçişi ya imkânsız kılar ya da alanı NULL'lamaya
-- zorlardı — yani tam da ihtiyaç duyulan bilgiyi silerdi.
-- Korunan iki yarı:
--   ① ENDORSED durumu ciro carisiz OLAMAZ ("ciro ettim ama kime?" yalanı),
--   ② çek daha CANLI ve ciro edilmemişken (portföyde / bankada / kendi çekimiz
--      verilmişken) ciro carisi taşıyamaz — sahte bir ciro izi doğmasın.
-- Terminal durumlar serbesttir: oraya ciro edilmiş çek de, edilmemiş çek de gelir.
ALTER TABLE "cheques"
  ADD CONSTRAINT "cheques_endorsed_cari"
  CHECK (
    ("status" = 'ENDORSED' AND "endorsedToCariId" IS NOT NULL)
    OR ("status" IN ('PORTFOLIO', 'AT_BANK', 'ISSUED') AND "endorsedToCariId" IS NULL)
    OR ("status" IN ('COLLECTED', 'BOUNCED', 'RETURNED', 'PAID', 'CANCELLED'))
  );

-- Olay satırı kasa VEYA banka taşır — ikisi birden OLAMAZ. "En çok bir" (XOR
-- değil): olayların çoğu (RECEIVE/ENDORSE/RETURN) hiçbir hesaba dokunmaz.
-- İkisi birden dolu olsaydı tek tahsilat İKİ bakiyeyi birden oynatır ve fark
-- hiçbir raporda görünmezdi (`payments_account_xor` ile aynı gerekçe).
ALTER TABLE "cheque_events"
  ADD CONSTRAINT "cheque_events_account_not_both"
  CHECK (NOT ("cashBoxId" IS NOT NULL AND "bankAccountId" IS NOT NULL));
