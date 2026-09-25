-- =============================================================================
-- TOP DURUM DEFTERİ — roll_status_events (K-A3, 2026-09-25)
-- =============================================================================
-- "Top ne zaman hangi durumdan hangisine geçti, iptali kim yaptı" sorusunun
-- KALICI cevabı. Audit (system_logs) yalnız ayak izidir, iş kaynağı olarak okunmaz
-- (kök CLAUDE.md, test_audit_okuma_kaynagi); operatör aktivitesindeki iptal satırları
-- buradan okunur.
--
-- YAZAN DB TRIGGER'I: `rolls`a yapılan HER durum yazımı (INSERT ve status değişen
-- UPDATE) bir satır doğurur. Ölçüldü: topu CANCELLED yapan 11 yol var ve audit
-- sorgusu yalnız 4'ünü görüyordu; servis içi yazım aynı eksikliği tekrar üretirdi.
-- Emsal: `rolls_stamp_production_timestamps` (statusChangedAt/finalizedAt).
--
-- actorId (v1): yalnız CANCELLED/SCRAP satırında, `NEW."cancelledById"`den. Kolonu
-- yazmayan yollar (arşiv, tambur geri alma ×3, fason ×2) aktörsüz satır doğurur;
-- bekçi bu sayıyı basar, kapanışı ayrı dilim.
--
-- MÜHÜR (ortak kalıp, `defter_block_tamper`): UPDATE her zaman reddedilir; DELETE
-- yalnız DOĞRUDAN geldiğinde (pg_trigger_depth() = 1) reddedilir — üst kayıt silinince
-- FK kaskadıyla gelen silme (RI trigger'ı içinden, derinlik ≥ 2) geçer. Üretimde top
-- silen yol yoktur; kaskad yalnız bekçi temizliklerinde koşar (283 dosya).
-- Fonksiyon tablo adından bağımsızdır; iş emri defteri de aynısını kullanır.
--
-- ADDITIVE: yalnız yeni tablo + iki fonksiyon + iki trigger; mevcut kolon/satır
-- değişmez. İDEMPOTENT (IF NOT EXISTS · OR REPLACE · DROP TRIGGER IF EXISTS).
-- Geçmiş iptaller migration'da DOLDURULMAZ: ayrı yayın günü adımı
-- `scripts/backfill_roll_status_events.ts` (dry-run varsayılan, --apply kullanıcıda).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "roll_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rollId" UUID NOT NULL,
    "fromStatus" "RollStatus",
    "toStatus" "RollStatus" NOT NULL,
    "actorId" UUID,
    "preEpoch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "roll_status_events_rollId_createdAt_idx" ON "roll_status_events"("rollId", "createdAt");
CREATE INDEX IF NOT EXISTS "roll_status_events_actorId_createdAt_idx" ON "roll_status_events"("actorId", "createdAt");

-- `actorId` FK'SIZ (SystemLogArchive emsali): kullanıcı silinse de iz kalır; FK'nın
-- SET NULL eylemi bir UPDATE olup mühürle çarpışırdı (42 bekçi kullanıcı siler).
DO $$ BEGIN
  ALTER TABLE "roll_status_events" ADD CONSTRAINT "roll_status_events_rollId_fkey"
    FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ORTAK MÜHÜR — tablo adından bağımsız, satır düzeyi (iş emri defteri de kullanır).
-- UPDATE her zaman RED. DELETE: derinlik 1 = doğrudan ifade → RED; üst kaydın FK
-- kaskadı RI trigger'ı içinden gelir (derinlik ≥ 2) ve geçer.
CREATE OR REPLACE FUNCTION "defter_block_tamper"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Defter satırı değiştirilemez (tablo: %).', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Defter append-only: düzeltme ters kayıtla yazılır.';
  END IF;
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Defter satırı silinemez (tablo: %).', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Defter append-only: satır yalnız üst kaydıyla birlikte (FK kaskadı) gider.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "roll_status_events_block_tamper" ON "roll_status_events";
CREATE TRIGGER "roll_status_events_block_tamper"
  BEFORE UPDATE OR DELETE ON "roll_status_events"
  FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"();

-- YAZAR: doğuş (INSERT) ve status'un GERÇEKTEN değiştiği UPDATE → bir satır.
-- ⚠️ DÜZ `now()` (DEFAULT CURRENT_TIMESTAMP): kolon timestamptz.
CREATE OR REPLACE FUNCTION "roll_write_status_event"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NULL;
  END IF;
  INSERT INTO "roll_status_events" ("rollId", "fromStatus", "toStatus", "actorId")
  VALUES (
    NEW."id",
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."status" ELSE NULL END,
    NEW."status",
    CASE WHEN NEW."status" IN ('CANCELLED', 'SCRAP') THEN NEW."cancelledById" ELSE NULL END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "rolls_write_status_event" ON "rolls";
CREATE TRIGGER "rolls_write_status_event"
  AFTER INSERT OR UPDATE OF "status" ON "rolls"
  FOR EACH ROW EXECUTE FUNCTION "roll_write_status_event"();
