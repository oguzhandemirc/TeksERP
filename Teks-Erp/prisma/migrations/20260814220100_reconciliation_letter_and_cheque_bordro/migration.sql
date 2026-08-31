-- =============================================================================
-- Mutabakat mektubu + çek teslim bordrosu (2026-08-15, J2 #18)
-- =============================================================================
-- Üç yeni tablo (`reconciliation_letters`, `cheque_delivery_notes`,
-- `cheque_delivery_note_items`) ve iki yeni durum enum'u.
--
-- ⚠️ 20260814220000'DEN SONRA KOŞMAK ZORUNDA: bu iki belgenin `PrintedDocType`
-- değerleri orada eklendi. Buradaki tablolar o değerleri DDL'de kullanmasa da
-- uygulama katmanı ikisini birlikte bekler; sıra pazarlık dışıdır.
--
-- ⚠️ `prisma migrate diff` çıktısındaki İKİ `DropForeignKey` satırı BİLİNÇLİ
-- OLARAK ALINMADI (`rolls_sackId_shipmentId_consistency_fkey` +
-- `swatches_...`): datamodel'de temsil edilemeyen DEFERRABLE composite FK'lar
-- her diff'te spurious DROP üretir (`schema.prisma` uyarısı + test_schema_drift
-- allowlist'i). Uygulanırlarsa çuval/sevkiyat tutarlılık seddi sessizce düşer.
--
-- ⚠️ ŞEMA-DIŞI NESNE YOK (bilinçli): ne partial index, ne CHECK constraint, ne
-- DEFERRABLE FK. `scripts/test_db_invariants.ts` envanteri İKİ YÖNLÜ denetlenir
-- (envanter-dışı nesne de KIRMIZI verir) ve bu iş paketinin kapsamı yalnız belge
-- katmanıdır. İş kuralları (tek yön · iptal edilmiş çek giremez · en fazla bir
-- yapılandırılmış hedef) servis katmanında ve bekçide kilitli. Gerçekten DB
-- seddi istenirse CHECK'ler AYRI bir migration'da gelir ve AYNI commit'te
-- envantere yazılır.
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: yeni tablolar boş doğar, mevcut hiçbir sorgu onlara
-- dokunmaz; hiçbir mevcut tablo değişmez. Yüzeyler `finance.enabled` rejiminin
-- arkasında (`requireFinanceEnabled`).
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

-- CreateEnum
CREATE TYPE "ReconciliationLetterStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChequeDeliveryNoteStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "reconciliation_letters" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "cariId" UUID NOT NULL,
    "asOf" TIMESTAMPTZ NOT NULL,
    "status" "ReconciliationLetterStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(500),
    "createdById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reconciliation_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_delivery_notes" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(32) NOT NULL,
    "kind" "ChequeKind" NOT NULL,
    "deliveryDate" TIMESTAMPTZ NOT NULL,
    "bankAccountId" UUID,
    "cariId" UUID,
    "targetLabel" VARCHAR(200),
    "status" "ChequeDeliveryNoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(500),
    "createdById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cheque_delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheque_delivery_note_items" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "chequeId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheque_delivery_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_letters_docNo_key" ON "reconciliation_letters"("docNo");

-- CreateIndex
CREATE INDEX "reconciliation_letters_cariId_createdAt_idx" ON "reconciliation_letters"("cariId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cheque_delivery_notes_docNo_key" ON "cheque_delivery_notes"("docNo");

-- CreateIndex
CREATE INDEX "cheque_delivery_notes_kind_deliveryDate_idx" ON "cheque_delivery_notes"("kind", "deliveryDate");

-- CreateIndex
CREATE INDEX "cheque_delivery_notes_cariId_idx" ON "cheque_delivery_notes"("cariId");

-- CreateIndex
CREATE INDEX "cheque_delivery_notes_bankAccountId_idx" ON "cheque_delivery_notes"("bankAccountId");

-- CreateIndex
CREATE INDEX "cheque_delivery_note_items_chequeId_idx" ON "cheque_delivery_note_items"("chequeId");

-- CreateIndex
CREATE UNIQUE INDEX "cheque_delivery_note_items_noteId_chequeId_key" ON "cheque_delivery_note_items"("noteId", "chequeId");

-- AddForeignKey
ALTER TABLE "reconciliation_letters" ADD CONSTRAINT "reconciliation_letters_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_delivery_notes" ADD CONSTRAINT "cheque_delivery_notes_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheque_delivery_notes" ADD CONSTRAINT "cheque_delivery_notes_cariId_fkey" FOREIGN KEY ("cariId") REFERENCES "cari_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Pivot satırı bordroyla birlikte yaşar (CASCADE) — ama bordro hiçbir zaman
-- SİLİNMEZ, iptal edilir (soft). CASCADE burada "yetim satır yapısal olarak
-- imkânsız" sigortasıdır, bir silme akışının parçası değil.
ALTER TABLE "cheque_delivery_note_items" ADD CONSTRAINT "cheque_delivery_note_items_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "cheque_delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: bordroya girmiş çek silinemez (zaten hiçbir yerde silinmiyor —
-- bu, kuralı DB'ye de söyletir).
ALTER TABLE "cheque_delivery_note_items" ADD CONSTRAINT "cheque_delivery_note_items_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
