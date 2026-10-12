-- Makine kaynaklı duruş D3b (K1): kart, insanın açtığı açık duruşu sahiplenir — kartın kendi
-- duruş anahtarı ayrı kolonda (insanın `stopKey`i kimlik olarak kalır).
-- ADDITIVE: nullable kolon + partial unique; canlı veriye dokunmaz. İdempotent.

ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "signalStopKey" UUID;

-- SAHİPLENME REPLAY SEDDİ: aynı kart anahtarı makine başına tek canlı satırı gösterir.
CREATE UNIQUE INDEX IF NOT EXISTS "machine_stops_signal_key_uq"
  ON "machine_stop_events"("machineId", "signalStopKey")
  WHERE "signalStopKey" IS NOT NULL AND "revokedAt" IS NULL;
