-- =============================================================================
-- B-1 + B-2 — Sevkiyat olay defteri ve çuval tartı defteri (defter doktrini)
-- =============================================================================
-- B-1: `Shipment`ta iptal künyesi HİÇ YOKTU (37 modelde var, iptal edilebilen
--      tek belgede yok) ve geri alma `dispatchedAt`/`dispatchedById`i NULL'lıyor,
--      yani "sevk edildi" gerçeğini siliyordu. `ShipmentEvent` tam geçmişi tutar
--      (ChequeEvent emsali); damgalar artık silinmez.
-- B-2: Yeniden tartı `Sack.weightKg`in ÜSTÜNE yazıyor, sıfırlama dört alanı
--      birden siliyordu — irsaliyeye giden BRÜT kg'ın önceki değeri hiçbir
--      kalıcı kolonda kalmıyordu. `SackWeighing` ölçüm defteri (RollVariance
--      emsali); `Sack.weightKg` denormalize GÜNCEL olarak kalır.
--
-- ⚠️ ENUM'LAR AYRI İFADEDE DEĞİL, YENİ TİP: `CREATE TYPE` ile doğuyorlar, yani
-- ADD VALUE aynı-tx kısıtı BURAYA UYGULANMAZ (o kısıt VAR OLAN tipe değer
-- eklemekle ilgilidir).
--
-- GÜVENLİ: iki YENİ tablo + `Shipment`a dört NULLABLE kolon. Mevcut satırlara
-- dokunulmaz, tablo yeniden yazımı yok. Geriye dönük defter satırı ÜRETİLMEZ —
-- olmayan geçmişi uydurmak defteri yalanlar; defter bu migration'dan İTİBAREN
-- doludur ve eski sevkiyatların geçmişi audit'te kalır.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "ShipmentEventType" AS ENUM
    ('PLANNED', 'DISPATCHED', 'UNDISPATCHED', 'CANCELLED', 'INVOICED', 'INVOICE_CLEARED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SackWeighingKind" AS ENUM ('WEIGHED', 'REWEIGHED', 'CLEARED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cancelledAt"      TIMESTAMPTZ;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cancelledById"    UUID;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cancelReason"     VARCHAR(300);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "cancelReasonCode" VARCHAR(64);

CREATE TABLE IF NOT EXISTS "shipment_events" (
  "id"          UUID NOT NULL,
  "shipmentId"  UUID NOT NULL,
  "type"        "ShipmentEventType" NOT NULL,
  "fromStatus"  "ShipmentStatus",
  "toStatus"    "ShipmentStatus" NOT NULL,
  "eventDate"   TIMESTAMPTZ NOT NULL,
  "reason"      VARCHAR(300),
  "reasonCode"  VARCHAR(64),
  "createdById" UUID,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shipment_events_shipmentId_createdAt_idx"
  ON "shipment_events" ("shipmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "shipment_events_type_createdAt_idx"
  ON "shipment_events" ("type", "createdAt");

DO $$ BEGIN
  ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "sack_weighings" (
  "id"           UUID NOT NULL,
  "sackId"       UUID NOT NULL,
  "kind"         "SackWeighingKind" NOT NULL,
  "weightKg"     DECIMAL(12,3),
  "weightSource" "SackWeightSource",
  "weighedById"  UUID,
  "weighedAt"    TIMESTAMPTZ NOT NULL,
  "notes"        VARCHAR(300),
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sack_weighings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sack_weighings_sackId_createdAt_idx"
  ON "sack_weighings" ("sackId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "sack_weighings" ADD CONSTRAINT "sack_weighings_sackId_fkey"
    FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
