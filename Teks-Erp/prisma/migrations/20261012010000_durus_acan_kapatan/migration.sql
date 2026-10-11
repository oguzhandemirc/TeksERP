-- =============================================================================
-- machine_stop_events — duruşu KİM AÇTI / KİM KAPATTI (dokuma alarmı B3)
-- =============================================================================
-- Yalnız insan yolu yazar (elle açma `openManualStop`, elle kapama `closeManualStop`); sinyal/watchdog NULL bırakır.
-- Eski satır NULL kalır = "bilinmiyor": backfill YOK, audit'ten türetme YASAK (audit yalnız ayak izidir).
-- FK users SET NULL (aynı tablodaki `classifiedById` emsali; kullanıcı zaten sert silinmez).
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.
-- =============================================================================
ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "openedById" UUID;
ALTER TABLE "machine_stop_events" ADD COLUMN IF NOT EXISTS "closedById" UUID;

DO $$ BEGIN ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
