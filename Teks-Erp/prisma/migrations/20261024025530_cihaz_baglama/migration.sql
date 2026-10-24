-- =============================================================================
-- 2026-10-24 — Cihaz eşleme v2 (D1): donanım özeti + bağlama defteri + yeniden bağlama talebi
-- =============================================================================
-- NE YAPAR: fiziksel cihaz = KİMLİK (`devices.id`); uygulama kurulumu = ANAHTAR
-- (`devices.deviceId`, yalnız yeniden bağlamayla değişir); bağlama olayları = DEFTER.
--   ① `devices`: `hwDigest` · `hwSource` · `mergedIntoId` (öz FK RESTRICT) · `mergedAt`
--      + kısmi UNIQUE `devices_hw_digest_live_uq` (canlı = birleşmemiş satırlarda özet tekil;
--        YUMUŞAK KAPI — mükerrer varsa RAISE NOTICE + ATLA; bugün kolon boş, tetiklenmez)
--      + CHECK `devices_merged_not_self` · `devices_merged_inactive`
--      + trigger `devices_merge_no_chain` (hedef birleşmiş olamaz; birleşen satırın kopyası olamaz).
--   ② DEFTER `device_binding_events` (append-only, yalnız createdAt; `deviceRefId` SetNull —
--      kalıcı silinen hayalet cihazın olayları kalır) + mühür trigger'ı
--      `device_binding_events_block_tamper` (DELETE RED; UPDATE yalnız FK SET NULL kaskadı).
--   ③ DURUM `device_rebind_requests` (+ CHECK `device_rebind_requests_status_chk`).
-- ADDITIVE: yalnız yeni tip/tablo/kolon (hepsi null'lanabilir) + kısıt; mevcut veri değişmez.
-- İdempotent: IF NOT EXISTS + duplicate_object yoklaması + DROP TRIGGER IF EXISTS.
-- `--create-only` çıktısındaki iki DEFERRABLE composite FK DropForeignKey satırı SİLİNDİ ([DB-21]).
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "DeviceBindingEventType" AS ENUM ('REGISTERED', 'REBIND_REQUESTED', 'REBOUND', 'REBIND_REJECTED', 'REVOKED', 'MERGED', 'UNMERGED', 'PROOF_RESET', 'PURGED', 'HW_CONFLICT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ① devices
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "hwDigest" VARCHAR(64);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "hwSource" VARCHAR(16);
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "mergedAt" TIMESTAMPTZ;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "mergedIntoId" UUID;

CREATE INDEX IF NOT EXISTS "devices_mergedIntoId_idx" ON "devices"("mergedIntoId");

DO $$ BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_merged_not_self') THEN
    ALTER TABLE "devices" ADD CONSTRAINT "devices_merged_not_self" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_merged_inactive') THEN
    ALTER TABLE "devices" ADD CONSTRAINT "devices_merged_inactive" CHECK ("mergedIntoId" IS NULL OR "isActive" = false);
  END IF;
END $$;

-- Kısmi UNIQUE — yumuşak kapı ([DB-24]): mükerrer canlı özet varsa ATLA, temizlikten sonra
-- bu dosya yeniden koşulur:
--   npx prisma db execute --file prisma/migrations/20261024025530_cihaz_baglama/migration.sql
DO $sed$
DECLARE
  n_dup integer;
BEGIN
  SELECT count(*) INTO n_dup FROM (
    SELECT "hwDigest" FROM "devices"
     WHERE "hwDigest" IS NOT NULL AND "mergedIntoId" IS NULL
     GROUP BY 1 HAVING count(*) > 1
  ) s;
  IF n_dup > 0 THEN
    RAISE NOTICE '[cihaz_baglama] devices_hw_digest_live_uq ATLANDI — % mükerrer canlı donanım özeti. Kopyaları birleştir, sonra bu dosyayı yeniden koş.', n_dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "devices_hw_digest_live_uq" ON "devices" ("hwDigest")
      WHERE "hwDigest" IS NOT NULL AND "mergedIntoId" IS NULL;
  END IF;
END
$sed$;

-- Zincir yasağı: birleşme tek adımdır (okuyucu `COALESCE(mergedIntoId, id)` bir adım çözer).
CREATE OR REPLACE FUNCTION "devices_merge_no_chain"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW."mergedIntoId" IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "devices" WHERE "id" = NEW."mergedIntoId" AND "mergedIntoId" IS NOT NULL) THEN
      RAISE EXCEPTION 'devices_merge_no_chain: hedef cihaz zaten birleşmiş (%).', NEW."mergedIntoId" USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "devices" WHERE "mergedIntoId" = NEW."id") THEN
      RAISE EXCEPTION 'devices_merge_no_chain: kopyaları olan cihaz birleştirilemez (%).', NEW."id" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "devices_merge_no_chain" ON "devices";
CREATE TRIGGER "devices_merge_no_chain"
  BEFORE INSERT OR UPDATE OF "mergedIntoId" ON "devices"
  FOR EACH ROW EXECUTE FUNCTION "devices_merge_no_chain"();

-- ② DEFTER device_binding_events
CREATE TABLE IF NOT EXISTS "device_binding_events" (
    "id" UUID NOT NULL,
    "deviceRefId" UUID,
    "localId" VARCHAR(64) NOT NULL,
    "deviceName" VARCHAR(120) NOT NULL,
    "event" "DeviceBindingEventType" NOT NULL,
    "actorId" UUID,
    "reason" VARCHAR(300),
    "hwDigest" VARCHAR(64),
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_binding_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "device_binding_events_deviceRefId_createdAt_idx" ON "device_binding_events"("deviceRefId", "createdAt");
CREATE INDEX IF NOT EXISTS "device_binding_events_localId_idx" ON "device_binding_events"("localId");

DO $$ BEGIN
  ALTER TABLE "device_binding_events" ADD CONSTRAINT "device_binding_events_deviceRefId_fkey" FOREIGN KEY ("deviceRefId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "device_binding_events" ADD CONSTRAINT "device_binding_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Defter mührü: satır silinmez; tek meşru UPDATE, cihaz kalıcı silinince FK'nın SET NULL
-- kaskadıdır (trigger derinliği > 1 ve yalnız deviceRefId → NULL).
CREATE OR REPLACE FUNCTION "device_binding_events_block_tamper"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  r "device_binding_events";
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND NEW."deviceRefId" IS NULL THEN
    r := NEW;
    r."deviceRefId" := OLD."deviceRefId";
    IF r IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'device_binding_events append-only: % reddedildi (ters yol karşı olaydır).', TG_OP USING ERRCODE = '23514';
END
$fn$;

DROP TRIGGER IF EXISTS "device_binding_events_block_tamper" ON "device_binding_events";
CREATE TRIGGER "device_binding_events_block_tamper"
  BEFORE DELETE OR UPDATE ON "device_binding_events"
  FOR EACH ROW EXECUTE FUNCTION "device_binding_events_block_tamper"();

-- ③ DURUM device_rebind_requests
CREATE TABLE IF NOT EXISTS "device_rebind_requests" (
    "id" UUID NOT NULL,
    "targetDeviceId" UUID NOT NULL,
    "localId" VARCHAR(64) NOT NULL,
    "kind" "DeviceKind" NOT NULL DEFAULT 'TABLET',
    "model" VARCHAR(120),
    "hwDigest" VARCHAR(64) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_rebind_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_rebind_requests_localId_key" ON "device_rebind_requests"("localId");
CREATE INDEX IF NOT EXISTS "device_rebind_requests_status_updatedAt_idx" ON "device_rebind_requests"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "device_rebind_requests_targetDeviceId_idx" ON "device_rebind_requests"("targetDeviceId");

DO $$ BEGIN
  ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_targetDeviceId_fkey" FOREIGN KEY ("targetDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_rebind_requests_status_chk') THEN
    ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_status_chk"
      CHECK ("status" IN ('OPEN', 'APPROVED', 'REJECTED'));
  END IF;
  -- Karar alanları durumla birlikte: OPEN kararsız, kapanmış talep kararlı.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_rebind_requests_decided_chk') THEN
    ALTER TABLE "device_rebind_requests" ADD CONSTRAINT "device_rebind_requests_decided_chk"
      CHECK (("status" = 'OPEN') = ("decidedAt" IS NULL));
  END IF;
END $$;
