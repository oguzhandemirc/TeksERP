-- =============================================================================
-- TAM STOK SAYIMI — sayım listesi + fark fişi (2026-08-15, J2 #19)
-- =============================================================================
-- İki yeni tablo (`stock_counts`, `stock_count_lines`), iki yeni enum ve
-- `yarn_movements`e tipli belge bağı (`stockCountId`).
--
-- ⚠️ 20260815090000'DEN SONRA KOŞMAK ZORUNDA: belgenin `PrintedDocType` değeri
-- orada eklendi (`ALTER TYPE ADD VALUE` aynı tx'te kullanılamaz kuralı).
--
-- ⚠️ `prisma migrate diff` çıktısındaki İKİ `DropForeignKey` satırı BİLİNÇLİ
-- OLARAK ALINMADI (`rolls_sackId_shipmentId_consistency_fkey` +
-- `swatches_...`): datamodel'de temsil edilemeyen DEFERRABLE composite FK'lar
-- her diff'te spurious DROP üretir (`schema.prisma` uyarısı + test_schema_drift
-- allowlist'i). Uygulanırlarsa çuval/sevkiyat tutarlılık seddi sessizce düşer.
--
-- ⚠️ `yarn_movements."stockCountId"` NULLABLE eklenir → PG11+'ta metadata-only
-- (tablo yeniden yazılmaz). DEFAULT vermek tam tablo yazımı demekti.
--
-- ⚠️ İKİ COMPOSITE UNIQUE BİRBİRİNİ BOZMAZ: PG'de NULL'lar birbirinden AYRIDIR.
-- ROLL satırında `itemId` NULL, YARN satırında `rollId` NULL → her iki kısıt da
-- yalnız kendi türündeki satırları kapsar ("aynı sayımda aynı top/kalem iki kez
-- olamaz"). Tek bir CHECK ile `rollId XOR itemId` de yazılabilirdi; yazılmadı,
-- çünkü `test_db_invariants` envanteri iki yönlü denetlenir ve bu iş paketinin
-- kapsamı belge+servis katmanıdır (kural servis ve bekçide kilitli).
--
-- ⚠️ ŞEMA-DIŞI NESNE YOK (bilinçli): ne partial index, ne CHECK, ne DEFERRABLE
-- FK. Envantere yazılacak bir şey yok — `test_db_invariants` beklenen listesi
-- değişmez.
--
-- ⚠️ FABRİKAYA ETKİSİ SIFIR: yeni tablolar boş doğar, mevcut hiçbir sorgu
-- onlara dokunmaz, mevcut hiçbir kolon değişmez. Yüzeyler `finance.enabled`
-- rejiminin arkasında (`requireFinanceEnabled`).
--
-- GÜVENLİ: yalnız EKLEME.
-- =============================================================================

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountLineKind" AS ENUM ('ROLL', 'YARN');

-- AlterTable
ALTER TABLE "yarn_movements" ADD COLUMN     "stockCountId" UUID;

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "countNo" VARCHAR(32) NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(500),
    "completedAt" TIMESTAMPTZ,
    "completedById" UUID,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "stockCountId" UUID NOT NULL,
    "kind" "StockCountLineKind" NOT NULL,
    "rollId" UUID,
    "itemId" UUID,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),
    "found" BOOLEAN,
    "notes" VARCHAR(300),
    "outOfScopeReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_countNo_key" ON "stock_counts"("countNo");

-- CreateIndex
CREATE INDEX "stock_counts_warehouseId_status_idx" ON "stock_counts"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "stock_count_lines_rollId_idx" ON "stock_count_lines"("rollId");

-- CreateIndex
CREATE INDEX "stock_count_lines_itemId_idx" ON "stock_count_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stockCountId_rollId_key" ON "stock_count_lines"("stockCountId", "rollId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_stockCountId_itemId_key" ON "stock_count_lines"("stockCountId", "itemId");

-- CreateIndex
CREATE INDEX "yarn_movements_stockCountId_idx" ON "yarn_movements"("stockCountId");

-- AddForeignKey
-- RESTRICT: fark fişini doğuran sayım silinemez (zaten hiçbir yerde silinmiyor —
-- kural DB seddine de yazılır).
ALTER TABLE "yarn_movements" ADD CONSTRAINT "yarn_movements_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT (CASCADE DEĞİL): sayım satırları belgenin kanıtıdır; sayımı silmek
-- yasak, iptal etmek serbest.
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: sayılmış top silinemez (toplar zaten silinmez, iptal edilir).
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
