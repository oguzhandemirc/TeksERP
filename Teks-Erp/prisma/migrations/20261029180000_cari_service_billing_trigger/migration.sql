-- H8b: müşteri bazlı hizmet faturası tetiği (NULL = fabrika ayarı; mevcut satırlar NULL kalır → bugünkü davranış).
ALTER TABLE "cari_accounts" ADD COLUMN "serviceBillingTrigger" VARCHAR(20);

-- Çift yüklem: servis 400'ü ilk hat, bu CHECK son hat (fabrika ayarının değer kümesiyle birebir).
ALTER TABLE "cari_accounts" ADD CONSTRAINT "cari_accounts_service_billing_trigger_ck"
  CHECK ("serviceBillingTrigger" IS NULL OR "serviceBillingTrigger" IN ('PER_SHIPMENT', 'PERIOD_END'));
