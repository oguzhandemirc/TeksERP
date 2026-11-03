-- S1 (Gülkesim 2026-11-03): kullanıcı şablonu (`u-…`) oluşturma ucunun idempotency token'ı. Yalnız ekleme; dosya şablonu satırları NULL kalır.
-- AlterTable
ALTER TABLE "sender_templates" ADD COLUMN     "clientToken" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sender_templates_clientToken_key" ON "sender_templates"("clientToken");
