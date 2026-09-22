-- =============================================================================
-- JOB STATE — zamanlanmış işin son durumu, iş başına tek satır (2026-09-22, 08)
-- =============================================================================
-- Offsite süpürücünün "son başarılı kopya ne zaman" bilgisi bellekte duruyordu
-- ve reboot'ta kayboluyordu; panel yalnız SON turun sonucunu görüyordu.
-- ADDITIVE: var olan hiçbir tabloya/kolona dokunmaz; tablo BOŞ doğar, ilk
--   süpürmede tek satır yazılır.
-- ⚠️ İDEMPOTENT (RECETELER migration 11): ikinci koşumda sessiz geçer.

CREATE TABLE IF NOT EXISTS "job_states" (
  "id"                  UUID                     NOT NULL,
  "job"                 VARCHAR(60)              NOT NULL,
  "lastRunAt"           TIMESTAMPTZ(3),
  "lastOkAt"            TIMESTAMPTZ(3),
  "lastError"           VARCHAR(1000),
  "consecutiveFailures" INTEGER                  NOT NULL DEFAULT 0,
  "lastResult"          JSONB,
  "createdAt"           TIMESTAMPTZ(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(3)           NOT NULL,
  CONSTRAINT "job_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_states_job_key" ON "job_states"("job");
