-- =============================================================================
-- TEZGAH DURUŞ DEFTERİ + VARDİYA + TOPLAYICI (2026-09-13, dokuma Faz 1 · P2b-1)
-- =============================================================================
-- NE YAPIYOR: dört pg enum + altı tablo + üç şema-dışı partial index.
--   MachineDataSource · MachineStopLossClass · MachineSignalKind · MachineStopEndSource
--   shift_definitions · shift_instances · machine_collectors ·
--   machine_collector_machines · machine_stop_events · machine_stop_reclasses
--
-- ADDITIVE Mİ: EVET, tamamen. Var olan hiçbir tabloya/kolona DOKUNMAZ; hepsi
--   yeni ve BOŞ doğar. Referans profilde hiçbir yüzey değişmez.
--
-- ⚠️ `ReasonPresetKind.MACHINE_STOP` BU DOSYADA YOK — bilinçli ve P2b-2'ye ait.
--   Gerekçe: `ADD VALUE` GERİ ALINAMAZ (PG enum değeri düşürülemez) ve canlı
--   `reason_presets` tablosuna kolon + CHECK + katalog + boot job'ı getirir.
--   Bölme MEŞRU çünkü bağımlılık TEK YÖNLÜ: `machine_stop_events.reasonCode`
--   FK'SIZ `VARCHAR(64)`tür (`rolls.cancelReasonCode` emsali) ⇒ bu dilim enum
--   değeri olmadan TAM çalışır; tersi doğru değildir.
--
-- ⚠️ `CREATE TYPE` onu kullanan `CREATE TABLE` ile AYNI DOSYADA — doğrudur.
--   PG 55P04 kısıtı `ALTER TYPE … ADD VALUE`a özgüdür; yeni bir TİPİN
--   `CREATE TYPE`ı kendi tx'inde kullanılabilir (`docs/RECETELER.md` § enum).
--
-- ⛔ TOPLAYICININ SIR KOLONLARI BU DOSYADA YOK (`tokenHash`/`tokenIssuedAt`/
--   `tokenRotatedAt`). Bir sırrı taşıyan kolon, onu koruyan KURALLARLA aynı
--   dilimde iner: yazma yüzeyi yokken güvenli GÖRÜNÜR ama kurallarından ÖNCE
--   var olur ve ilk yazan kişi kuralları arayıp bulamaz. Eksiklik değil, SIRA.
--
-- `nameFold` KOLONLARI NULLABLE — ve bu, tasarımın "ham SQL'de NOT NULL" talimatından
--   BİLİNÇLİ bir sapmadır. Talimatın gerekçesi *"nullable fold + UNIQUE, NULLS
--   DISTINCT yüzünden sınırsız adsız satır kabul eder"*; ÖLÇTÜM, o dal ERİŞİLEMEZ:
--     · kolon `GENERATED ALWAYS AS` ⇒ PG DOĞRUDAN YAZMAYI REDDEDER (motor seddi,
--       trigger değil — atlatılamaz)
--     · `tr_fold` STRICT (`pg_proc.proisstrict = t`) ⇒ yalnız NULL girdide NULL döner
--     · girdi `name` ve o NOT NULL ⇒ fold hiçbir satırda NULL olamaz
--   ⇒ NOT NULL erişilemez bir dalı korur ve bedeli KALICIDIR: Prisma tarafı
--   `String?` olduğu için `test_schema_drift` her koşumda "DROP NOT NULL" farkı
--   görür ve ancak bir allowlist girdisiyle susturulabilirdi.
--   Repo konvansiyonu da bu: mevcut BEŞ fold kolonu (machines · items · colors ·
--   stations · warp_specs) — BEŞİ DE nullable (ölçüldü).
--
-- ⚠️ KALINTI RİSK, ADIYLA BIRAKILIYOR: bu iki fold'un NULL olamamasının TEK
--   dayanağı kaynak `name`in NOT NULL olmasıdır ve türetme SESSİZDİR. Biri
--   `name`i nullable yaparsa fold da sessizce nullable olur ve UNIQUE deliği
--   kendiliğinden açılır. Bunu ölçen BİR KAPI YOKTUR (`EXPRESSION_UNIQUES`
--   envanteri `expr`+`predicate` tutar, kaynak nullability'sini tutmaz).
--   Tasarımın istediği NOT NULL bunu yakalardı; bu kararla yakalanmıyor ve
--   kabul edilen şey budur.
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: altı tablo da boş doğuyor.
-- =============================================================================

CREATE TYPE "MachineDataSource"    AS ENUM ('MACHINE', 'INFERRED', 'OPERATOR', 'SUPERVISOR', 'SIMULATED');
CREATE TYPE "MachineStopLossClass" AS ENUM ('UNPLANNED', 'SETUP', 'PLANNED', 'NON_SCHEDULED', 'MINOR');
CREATE TYPE "MachineSignalKind"    AS ENUM ('RUN_CONTACT', 'PICK_COUNTER', 'COURSE_COUNTER', 'RACK_COUNTER', 'RUN_SECONDS', 'INSTANT_RPM', 'WARP_STOP', 'WEFT_STOP', 'OPERATOR_STOP', 'STOP_CODE', 'FABRIC_LENGTH');
CREATE TYPE "MachineStopEndSource" AS ENUM ('SIGNAL', 'OPERATOR', 'WATCHDOG');

-- ── VARDİYA KATALOĞU ────────────────────────────────────────────────────────
CREATE TABLE "shift_definitions" (
  "id"                  UUID         NOT NULL,
  "code"                VARCHAR(8)   NOT NULL,
  "name"                VARCHAR(100) NOT NULL,
  "startMinute"         INTEGER      NOT NULL,
  "durationMinutes"     INTEGER      NOT NULL,
  "plannedBreakMinutes" INTEGER      NOT NULL DEFAULT 0,
  "activeWeekdays"      INTEGER[]    NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "sortOrder"           INTEGER      NOT NULL DEFAULT 0,
  "isActive"            BOOLEAN      NOT NULL DEFAULT true,
  "nameFold"            TEXT         GENERATED ALWAYS AS (public.tr_fold("name")) STORED,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL,
  "createdById"         UUID,
  "updatedById"         UUID,
  CONSTRAINT "shift_definitions_pkey" PRIMARY KEY ("id")
);

-- Vardiya penceresi gün içinde başlar (0..1439) ve süresi pozitiftir; mola
-- süreyi aşamaz. Üçü de POT'un (planlı süre) girdisidir: sıfır/negatif süre
-- paydayı sessizce çökertir, mola > süre negatif POT üretir.
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_window_sane"
  CHECK ("startMinute" >= 0 AND "startMinute" <= 1439
     AND "durationMinutes" > 0
     AND "plannedBreakMinutes" >= 0 AND "plannedBreakMinutes" < "durationMinutes");

CREATE UNIQUE INDEX "shift_definitions_code_key"     ON "shift_definitions"("code");
CREATE UNIQUE INDEX "shift_definitions_nameFold_key" ON "shift_definitions"("nameFold");
CREATE INDEX "shift_definitions_isActive_sortOrder_idx" ON "shift_definitions"("isActive", "sortOrder");

-- ── VARDİYA PENCERESİ ───────────────────────────────────────────────────────
CREATE TABLE "shift_instances" (
  "id"                UUID        NOT NULL,
  "shiftDefinitionId" UUID        NOT NULL,
  "factoryDayKey"     TIMESTAMPTZ NOT NULL,
  "startsAt"          TIMESTAMPTZ NOT NULL,
  "endsAt"            TIMESTAMPTZ NOT NULL,
  "isCancelled"       BOOLEAN     NOT NULL DEFAULT false,
  "cancelReason"      VARCHAR(300),
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL,
  CONSTRAINT "shift_instances_pkey" PRIMARY KEY ("id")
);

-- Pencere ileri akar. Eşitlik de reddedilir: sıfır uzunluklu pencere POT'u
-- sıfırlar ve randıman 0/0'a düşer.
ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_time_order"
  CHECK ("endsAt" > "startsAt");

-- Job iki kez koşarsa ikinci satır DOĞMAZ ⇒ advisory kilit gerekmiyor.
CREATE UNIQUE INDEX "shift_instances_shiftDefinitionId_factoryDayKey_key" ON "shift_instances"("shiftDefinitionId", "factoryDayKey");
CREATE INDEX "shift_instances_startsAt_idx" ON "shift_instances"("startsAt");

ALTER TABLE "shift_instances" ADD CONSTRAINT "shift_instances_shiftDefinitionId_fkey"
  FOREIGN KEY ("shiftDefinitionId") REFERENCES "shift_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shift_definitions" ADD CONSTRAINT "shift_definitions_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── KENAR TOPLAYICI (SIR KOLONLARI YOK — yukarıdaki şerh) ───────────────────
CREATE TABLE "machine_collectors" (
  "id"             UUID           NOT NULL,
  "collectorKey"   VARCHAR(64)    NOT NULL,
  "name"           VARCHAR(100)   NOT NULL,
  "nameFold"       TEXT           GENERATED ALWAYS AS (public.tr_fold("name")) STORED,
  "hostname"       VARCHAR(128),
  "agentVersion"   VARCHAR(32),
  "status"         "DeviceStatus" NOT NULL DEFAULT 'PENDING',
  "installationId" VARCHAR(64),
  "clockSkewMs"    INTEGER,
  "revokedAt"      TIMESTAMPTZ,
  "revokedById"    UUID,
  "isActive"       BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ    NOT NULL,
  "createdById"    UUID,
  "updatedById"    UUID,
  CONSTRAINT "machine_collectors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "machine_collectors_collectorKey_key" ON "machine_collectors"("collectorKey");
CREATE UNIQUE INDEX "machine_collectors_nameFold_key"     ON "machine_collectors"("nameFold");
CREATE INDEX "machine_collectors_status_idx"              ON "machine_collectors"("status");

ALTER TABLE "machine_collectors" ADD CONSTRAINT "machine_collectors_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "machine_collectors" ADD CONSTRAINT "machine_collectors_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── YAZMA KAPSAMI ───────────────────────────────────────────────────────────
-- ⚠️ `machineId` UNIQUE: bir makinenin TEK yazarı olur. İki toplayıcı aynı
--    tezgaha basarsa upsert'ler birbirini sessizce ezer ve açık-duruş seddi
--    ajana SONSUZ 409 gibi görünürdü — bu bir yapılandırma hatasıdır.
CREATE TABLE "machine_collector_machines" (
  "collectorId" UUID        NOT NULL,
  "machineId"   UUID        NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "machine_collector_machines_pkey" PRIMARY KEY ("collectorId", "machineId")
);
CREATE UNIQUE INDEX "machine_collector_machines_machineId_key" ON "machine_collector_machines"("machineId");

ALTER TABLE "machine_collector_machines" ADD CONSTRAINT "machine_collector_machines_collectorId_fkey"
  FOREIGN KEY ("collectorId") REFERENCES "machine_collectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machine_collector_machines" ADD CONSTRAINT "machine_collector_machines_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DURUŞ DEFTERİ ───────────────────────────────────────────────────────────
CREATE TABLE "machine_stop_events" (
  "id"                 UUID        NOT NULL,
  "machineId"          UUID        NOT NULL,
  "runId"              UUID,
  "stopKey"            UUID        NOT NULL,
  "startedAt"          TIMESTAMPTZ NOT NULL,
  "endedAt"            TIMESTAMPTZ,
  "provisionalEndedAt" TIMESTAMPTZ,
  "durationSec"        INTEGER,
  "clockSkewMs"        INTEGER,
  "endSource"          "MachineStopEndSource",
  "endCorrectedAt"     TIMESTAMPTZ,
  "beamSlot"           INTEGER,
  "signalKind"         "MachineSignalKind",
  "rawStopCode"        VARCHAR(32),
  "reasonCode"         VARCHAR(64),
  "lossClass"          "MachineStopLossClass",
  "reasonNote"         VARCHAR(300),
  "reasonSource"       "MachineDataSource",
  "classifiedById"     UUID,
  "classifiedAt"       TIMESTAMPTZ,
  "requiresReason"     BOOLEAN     NOT NULL DEFAULT false,
  "shiftInstanceId"    UUID,
  "factoryDay"         DATE        NOT NULL,
  "pickCounter"        NUMERIC(18,0),
  "source"             "MachineDataSource" NOT NULL,
  "collectorId"        UUID,
  "revokedAt"          TIMESTAMPTZ,
  "revokedById"        UUID,
  "revokeReason"       VARCHAR(300),
  "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ NOT NULL,
  CONSTRAINT "machine_stop_events_pkey" PRIMARY KEY ("id")
);

-- Kapanış açılıştan önce olamaz; süre negatif olamaz. Eşitliğe İZİN VAR:
-- anlık bir duruş (aç-kapa aynı damga) gerçek bir olaydır ve reddedilmesi ajanı
-- kuyruk kilidine sokardı — `shift_instances`taki sıkı yönle bilinçli fark.
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_time_order"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_durationSec_nonneg"
  CHECK ("durationSec" IS NULL OR "durationSec" >= 0);

CREATE INDEX "machine_stop_events_machineId_startedAt_idx"  ON "machine_stop_events"("machineId", "startedAt");
CREATE INDEX "machine_stop_events_factoryDay_machineId_idx" ON "machine_stop_events"("factoryDay", "machineId");
CREATE INDEX "machine_stop_events_reasonCode_startedAt_idx" ON "machine_stop_events"("reasonCode", "startedAt");
CREATE INDEX "machine_stop_events_shiftInstanceId_idx"      ON "machine_stop_events"("shiftInstanceId");
CREATE INDEX "machine_stop_events_runId_idx"                ON "machine_stop_events"("runId");
CREATE INDEX "machine_stop_events_collectorId_idx"          ON "machine_stop_events"("collectorId");

-- ⚠️ ÜÇ ŞEMA-DIŞI PARTIAL INDEX — `revokedAt IS NULL` yüklemi İKİ SEDDE DE ŞART:
--    geri alınmış duruş yer İŞGAL ETMEZ, yoksa aynı makinede yeni duruş açılamaz
--    ve yeniden gönderim sonsuza dek reddedilirdi.
--    ⛔ Bu yön, silme guard'larındaki TERS yönle çelişmez: sed "şu an açık mı"
--    diye sorar, guard "bu makinede iş yapıldı mı" diye — iki ayrı soru.
CREATE UNIQUE INDEX "machine_stops_one_open_per_machine_uq"
  ON "machine_stop_events"("machineId")
  WHERE "endedAt" IS NULL AND "revokedAt" IS NULL;

-- REPLAY SEDDİ. Anahtar AJAN ÜRETİMİ TOKEN'dır, SAAT DEĞİL: aynı duruş, saat ne
-- kadar kayarsa kaysın TEK satırdır.
CREATE UNIQUE INDEX "machine_stops_key_uq"
  ON "machine_stop_events"("machineId", "stopKey")
  WHERE "revokedAt" IS NULL;

-- SINIFLANDIRMA KUYRUĞU — "sebebi bekleyen duruşlar" taraması.
CREATE INDEX "machine_stops_duty_idx"
  ON "machine_stop_events"("startedAt")
  WHERE "requiresReason" AND "reasonCode" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "machine_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_shiftInstanceId_fkey"
  FOREIGN KEY ("shiftInstanceId") REFERENCES "shift_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_classifiedById_fkey"
  FOREIGN KEY ("classifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "machine_stop_events" ADD CONSTRAINT "machine_stop_events_collectorId_fkey"
  FOREIGN KEY ("collectorId") REFERENCES "machine_collectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── SEBEP DEĞİŞİM DEFTERİ (append-only) ─────────────────────────────────────
CREATE TABLE "machine_stop_reclasses" (
  "id"             UUID        NOT NULL,
  "stopEventId"    UUID        NOT NULL,
  "fromReasonCode" VARCHAR(64),
  "toReasonCode"   VARCHAR(64),
  "fromLossClass"  "MachineStopLossClass",
  "toLossClass"    "MachineStopLossClass",
  "reason"         VARCHAR(300),
  "actedById"      UUID,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "machine_stop_reclasses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "machine_stop_reclasses_stopEventId_createdAt_idx" ON "machine_stop_reclasses"("stopEventId", "createdAt");

ALTER TABLE "machine_stop_reclasses" ADD CONSTRAINT "machine_stop_reclasses_stopEventId_fkey"
  FOREIGN KEY ("stopEventId") REFERENCES "machine_stop_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_stop_reclasses" ADD CONSTRAINT "machine_stop_reclasses_actedById_fkey"
  FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
