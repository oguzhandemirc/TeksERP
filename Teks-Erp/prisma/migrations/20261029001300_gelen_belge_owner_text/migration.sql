-- D3b (2026-10-29): belgedeki Müşteri/FİRMA/Sayın alanının HAM metni — sahip eşlemesi (eslestirme.service) bundan
-- önerilir; `ownerCustomerId` yalnız operatör/alias çözümünde dolar. ADDITIVE ve idempotent.
ALTER TABLE "customer_delivery_notes" ADD COLUMN IF NOT EXISTS "ownerText" VARCHAR(160);
