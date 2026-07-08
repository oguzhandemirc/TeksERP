-- =============================================================================
-- EndpointLatencyDaily — endpoint gecikme günlük özetleri (Faz 3)
-- =============================================================================
-- MANUEL migration (psql ile uygula + prisma migrate resolve --applied).
-- Additive: mevcut tablolara dokunmaz. Boş tabloya CREATE — kilit riski yok,
-- statement_timeout etkilenmez.

CREATE TABLE endpoint_latency_daily (
  id UUID NOT NULL,
  day DATE NOT NULL,
  "routeKey" VARCHAR(200) NOT NULL,
  count INTEGER NOT NULL,
  "errCount" INTEGER NOT NULL,
  "maxMs" INTEGER NOT NULL,
  buckets JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT endpoint_latency_daily_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "endpoint_latency_daily_day_routeKey_key"
  ON endpoint_latency_daily (day, "routeKey");
