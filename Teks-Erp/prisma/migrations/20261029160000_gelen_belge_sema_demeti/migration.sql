-- E4 (Gelen belge şema demeti, 2026-10-29): satır kaynağı taraması (scanId) · sözlük NULL-güvenli tekilliği ·
-- sahibe özel varsayılan ürün (delivery_note_customer_defaults). ADDITIVE; mevcut satıra DOKUNMAZ (geri doldurma yok:
-- modül hiçbir kurulumda açık değil, okuyucu null'a dayanıklı). --create-only; DropForeignKey satırları silindi.

-- AlterTable
ALTER TABLE "customer_delivery_note_lines" ADD COLUMN     "scanId" UUID;

-- CreateTable
CREATE TABLE "delivery_note_customer_defaults" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "defaultItemId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "delivery_note_customer_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_note_customer_defaults_customerId_key" ON "delivery_note_customer_defaults"("customerId");

-- CreateIndex
CREATE INDEX "delivery_note_customer_defaults_defaultItemId_idx" ON "delivery_note_customer_defaults"("defaultItemId");

-- CreateIndex
CREATE INDEX "customer_delivery_note_lines_scanId_idx" ON "customer_delivery_note_lines"("scanId");

-- AddForeignKey
ALTER TABLE "customer_delivery_note_lines" ADD CONSTRAINT "customer_delivery_note_lines_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "document_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_customer_defaults" ADD CONSTRAINT "delivery_note_customer_defaults_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_customer_defaults" ADD CONSTRAINT "delivery_note_customer_defaults_defaultItemId_fkey" FOREIGN KEY ("defaultItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_customer_defaults" ADD CONSTRAINT "delivery_note_customer_defaults_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_note_customer_defaults" ADD CONSTRAINT "delivery_note_customer_defaults_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sözlük tekilliği NULL gönderende de geçerli olsun (SENDER kapsamı ve gönderensiz öğrenme çift satır doğurmasın):
-- Prisma'nın kurduğu indeks NULLS NOT DISTINCT ile yeniden kurulur (PG 15+; CI 16, fabrika 16 — H7
-- `service_billing_links_active_uq` emsali). Ad AYNI kalır: şema `@@unique` beyanı ve `ON CONFLICT` hedefi değişmez.
-- Önce ölç: mükerrer varsa DUR (toplu DELETE yok — hangisinin kalacağı operatör kararıdır).
DO $$
DECLARE dup INTEGER;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT 1 FROM "delivery_note_aliases" GROUP BY "scope", "senderCustomerId", "rawKey" HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Gelen belge eşleme sözlüğünde % mükerrer anahtar var (aynı kapsam + gönderen + metin). Mükerrer satırları elle ayıklayıp migration''ı yeniden koşun.', dup;
  END IF;
END $$;

DROP INDEX "delivery_note_aliases_scope_senderCustomerId_rawKey_key";
CREATE UNIQUE INDEX "delivery_note_aliases_scope_senderCustomerId_rawKey_key"
  ON "delivery_note_aliases"("scope", "senderCustomerId", "rawKey") NULLS NOT DISTINCT;
