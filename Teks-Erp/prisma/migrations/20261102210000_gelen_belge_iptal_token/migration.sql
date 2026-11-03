-- K15 2026-11-02: onaylı gelen belge İPTALİNİN deneme kimliği (clientToken replay, tek boğaz `tokenReplay`).
-- ADDITIVE: yalnız nullable kolon + tekil index; mevcut satırlar NULL kalır (bugünkü davranış), veri göçü yok.

ALTER TABLE "customer_delivery_notes" ADD COLUMN IF NOT EXISTS "cancelClientToken" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "customer_delivery_notes_cancelClientToken_key" ON "customer_delivery_notes"("cancelClientToken");
