-- =============================================================================
-- Fatura kapama — `payment_allocations` + denormalize sayaçlar (C2 · M3, 2026-08-14)
-- =============================================================================
-- "Hangi tahsilat/çek hangi faturayı kapattı" bağı + üç denormalize sayaç.
--
-- ⚠️ M2'DEN SONRA KOŞMAK ZORUNDA: `payment_allocations.chequeId` → `cheques`
-- FK'sı ve `cheques.allocatedTotal` kolonu M2'nin tablosuna yazar.
--
-- ⚠️ AÇIK/KISMİ/KAPALI bir KOLON DEĞİLDİR — `paidTotal` ile `grandTotal`
-- karşılaştırılarak TÜRETİLİR. Ayrı bir `paymentStatus` kolonu, ikinci bir
-- denormalize alan demekti ve iki denormalize alan bir gün ayrışır: "kapalı
-- görünen ama parası gelmemiş fatura" tam olarak böyle doğar.
--
-- ⚠️ `prisma migrate diff` çıktısındaki İKİ `DropForeignKey` satırı BİLİNÇLİ
-- OLARAK ALINMADI (DEFERRABLE composite FK'lar — bkz. 20260814101000 notu).
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: yeni tablo boş doğar; üç kolon da DEFAULT 0 ile
-- eklenir. (PG11+ sabit DEFAULT'lu kolon ekleme de metadata-only'dir; tablo
-- yeniden yazılmaz.) Mevcut 7 fatura / 3 tahsilat satırı CHECK'leri sağlıyor
-- (ölçüldü: min grandTotal 2169.60, min amount 500.00).
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "allocatedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "allocatedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "paymentId" UUID,
    "chequeId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_chequeId_idx" ON "payment_allocations"("chequeId");

-- CreateIndex
-- AÇIK FATURA yolu — yaşlandırma raporunun ve "kapat" ekranının tek sorgusu.
-- PARTIAL: kapanmış ve iptal edilmiş faturalar (zamanla toplamın büyük çoğunluğu)
-- indekse HİÇ girmez, yani index cironun değil AÇIK BAKİYENİN büyüklüğünde kalır.
-- Şemada düz `@@index([cariId, currency, dueDate], map: "invoices_open")` durur;
-- Prisma 7 predicate farkını drift saymaz (perf kuralı 4).
CREATE INDEX "invoices_open" ON "invoices"("cariId", "currency", "dueDate")
  WHERE "status" = 'CONFIRMED' AND "paidTotal" < "grandTotal";

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- ŞEMA-DIŞI SEDDLER — hepsi `scripts/test_db_invariants.ts` envanterinde
-- =============================================================================

-- Kapama kaynağı ya TAHSİLAT ya ÇEK — ikisi birden olamaz, hiçbiri de olamaz.
-- İkisi birden dolu olsaydı tek kapama İKİ sayacı birden tüketir (Payment ve
-- Cheque) ve ikisi de fatura tarafıyla ayrışırdı; hiçbiri dolu olmasaydı
-- "parası nereden geldiği bilinmeyen kapama" doğardı.
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_source_xor"
  CHECK (("paymentId" IS NOT NULL)::int + ("chequeId" IS NOT NULL)::int = 1);

-- Kapama tutarı POZİTİF: 0 tutarlı kapama satırı defteri kirletir ve hiçbir şey
-- söylemez; negatif "kapama" ise stornodur ve satır SİLİNEREK yapılır
-- (tahsilat/fatura iptali allocation'ları çözer — sayaçlar aynı tx'te düşer).
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_positive" CHECK ("amount" > 0);

-- ⚠️ SAYAÇ SEDDLERİ — denormalize alanın DB seddi.
-- Bunlar `Order.shippedQty` (seddi OLMAYAN denormalize alan, drift'i yıllarca
-- görünmez) dersinin karşılığıdır: üst sınır DB'de kilitli olduğu için "fatura
-- tutarından fazla kapandı" durumu YAZILAMAZ. Alt sınır 0: eksi kapama, iptal
-- yolunun sayacı fazla düşürdüğünü söyler ve o an patlaması gerekir.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_paid_total_range"
  CHECK ("paidTotal" >= 0 AND "paidTotal" <= "grandTotal");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_allocated_total_range"
  CHECK ("allocatedTotal" >= 0 AND "allocatedTotal" <= "amount");

ALTER TABLE "cheques"
  ADD CONSTRAINT "cheques_allocated_total_range"
  CHECK ("allocatedTotal" >= 0 AND "allocatedTotal" <= "amount");
