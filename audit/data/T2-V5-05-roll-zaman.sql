-- V-5 TUR2 §2 — rolls zaman damgası tutarlılığı
SELECT
  count(*) AS toplam,
  count(*) FILTER (WHERE "finalizedAt" IS NOT NULL AND "finalizedAt" < "createdAt") AS finalize_olusturmadan_once,
  count(*) FILTER (WHERE "statusChangedAt" IS NOT NULL AND "statusChangedAt" < "createdAt") AS statusChanged_once,
  count(*) FILTER (WHERE "cancelledAt" IS NOT NULL AND "cancelledAt" < "createdAt") AS iptal_once,
  count(*) FILTER (WHERE "labelPrintedAt" IS NOT NULL AND "labelPrintedAt" < "createdAt") AS etiket_once,
  count(*) FILTER (WHERE "clientEnteredAt" IS NOT NULL AND "clientEnteredAt" > "createdAt" + interval '1 minute') AS cihaz_saati_ILERI,
  count(*) FILTER (WHERE "clientEnteredAt" IS NOT NULL AND "clientEnteredAt" < "createdAt" - interval '7 days') AS cihaz_saati_7GUN_GERI,
  count(*) FILTER (WHERE "clientEnteredAt" IS NOT NULL) AS cihaz_saati_dolu,
  count(*) FILTER (WHERE status='CANCELLED' AND "cancelledAt" IS NULL) AS iptal_ama_damgasiz,
  count(*) FILTER (WHERE status<>'CANCELLED' AND "cancelledAt" IS NOT NULL) AS damgali_ama_iptal_degil,
  count(*) FILTER (WHERE "statusChangedAt" IS NULL) AS statusChangedAt_bos,
  count(*) FILTER (WHERE "updatedAt" < "statusChangedAt") AS updated_statusChanged_ters
FROM rolls;
