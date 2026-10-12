-- Makine kaynaklı duruş D4 — watchdog. ADDITIVE: üç boş geçilebilir kolon, veri göçü yok.
--   machine_collectors.lastSeenAt  — kartın son geçerli imzalı isteği (canlılık)
--   machine_collectors.silentSince — kart sessiz durumu (watchdog yazar, kartın ilk isteği temizler)
--   machine_stop_events.lateEndedAt — mühürlü vardiya yüzünden uygulanamayan gerçek bitiş (geciken kapanışlar)
ALTER TABLE "machine_collectors" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMPTZ;
ALTER TABLE "machine_collectors" ADD COLUMN IF NOT EXISTS "silentSince" TIMESTAMPTZ;
ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "lateEndedAt" TIMESTAMPTZ;
