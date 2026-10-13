-- =============================================================================
-- AUDIT HASH ZİNCİRİ + YETKİLİ ARŞİV/BUDAMA YOLU (G4/B, 2026-10-13) — ADDITIVE
-- =============================================================================
-- Ne yapar:
--   1. `system_logs` + `system_log_archives`e iki nullable kolon: `chainSeq`
--      (ardışık sıra) ve `chainHash` (sha256 hex). MEVCUT SATIRLARA DOKUNULMAZ —
--      onlar zincir-öncesidir (NULL); zincir bu migration'ın çapa satırıyla BAŞLAR.
--   2. `audit_zincir_ozet(...)` — özetin TEK kaynağı (trigger + doğrulayıcı).
--   3. BEFORE INSERT trigger: önceki satırın özetini (canlı ∪ arşiv en büyük sıra)
--      advisory kilit altında okur, NEW'e sıra + özet yazar. Kilit uzayı 8039
--      (`AUDIT_CHAIN_LOCK_NS`, envanter `helpers/period-guard.helper.ts`).
--      NEDEN TRIGGER: audit'e yazan HER yol (uygulama, betik, psql) aynı boğazdan
--      geçer; uygulama tarafı kilit ayrı tx ister ve best-effort yazımı uzatırdı.
--      Kilit yalnız INSERT ifadesi boyunca tutulur (audit tx DIŞINDA, autocommit).
--   4. `audit_arsivle` / `audit_arsiv_buda` — SECURITY DEFINER: uygulama rolü
--      `system_logs`ta DELETE yetkisini kaybettiğinde (G4/A) arşivleme ve budama
--      yalnız bu iki fonksiyondan, sahip rolüyle ve TABAN KURALIYLA yürür
--      (arşiv ≥ 1 ay, budama ≥ 1 yıl). Budama sıra-öneki siler ve zincire
--      "kesit çapası" (`AUDIT_CHAIN_CUT`) bırakır: doğrulayıcı kesik başı buradan bağlar.
-- Geri alınamaz değil ama geri alma gerekmez: kolonlar nullable, trigger yalnız ekler.
-- Bekçi: scripts/test_audit_hash_zinciri.ts · test_db_invariants §6/§8.
-- =============================================================================

ALTER TABLE "system_logs" ADD COLUMN IF NOT EXISTS "chainSeq" INTEGER;
ALTER TABLE "system_logs" ADD COLUMN IF NOT EXISTS "chainHash" TEXT;
ALTER TABLE "system_log_archives" ADD COLUMN IF NOT EXISTS "chainSeq" INTEGER;
ALTER TABLE "system_log_archives" ADD COLUMN IF NOT EXISTS "chainHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "system_logs_chainSeq_key" ON "system_logs"("chainSeq");
CREATE UNIQUE INDEX IF NOT EXISTS "system_log_archives_chainSeq_key" ON "system_log_archives"("chainSeq");

-- Özet: jsonb dizisinin metni (NULL ↔ '' ayrımı korunur, anahtar sırası jsonb'de
-- kanonik) + oturum saat diliminden BAĞIMSIZ mikro-saniye damgası.
CREATE OR REPLACE FUNCTION "audit_zincir_ozet"(
  p_prev text, p_seq integer, p_id uuid, p_user uuid, p_category text, p_action text,
  p_table text, p_record text, p_ip text, p_device text, p_request uuid,
  p_created timestamptz, p_old jsonb, p_new jsonb, p_changes jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    'TEKSERP-AUDIT-v1', p_prev, p_seq, p_id::text, p_user::text, p_category, p_action,
    p_table, p_record, p_ip, p_device, p_request::text,
    (extract(epoch FROM p_created) * 1000000)::bigint,
    p_old, p_new, p_changes
  )::text, 'UTF8')), 'hex')
$fn$;

CREATE OR REPLACE FUNCTION "audit_zincir_bagla"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_seq integer;
  v_hash text;
  a_seq integer;
  a_hash text;
BEGIN
  -- 8039 = AUDIT_CHAIN_LOCK_NS; zincir sırası deterministik (tek yazar anı).
  PERFORM pg_advisory_xact_lock(8039, 0);
  SELECT "chainSeq", "chainHash" INTO v_seq, v_hash
    FROM "system_logs" WHERE "chainSeq" IS NOT NULL ORDER BY "chainSeq" DESC LIMIT 1;
  SELECT "chainSeq", "chainHash" INTO a_seq, a_hash
    FROM "system_log_archives" WHERE "chainSeq" IS NOT NULL ORDER BY "chainSeq" DESC LIMIT 1;
  IF a_seq IS NOT NULL AND (v_seq IS NULL OR a_seq > v_seq) THEN
    v_seq := a_seq; v_hash := a_hash;
  END IF;
  NEW."chainSeq" := coalesce(v_seq, 0) + 1;
  NEW."chainHash" := "audit_zincir_ozet"(
    coalesce(v_hash, repeat('0', 64)), NEW."chainSeq", NEW."id", NEW."userId",
    NEW."category"::text, NEW."action", NEW."tableName", NEW."recordId",
    NEW."ipAddress", NEW."deviceId", NEW."requestId", NEW."createdAt",
    NEW."oldData", NEW."newData", NEW."changes");
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS "system_logs_hash_chain" ON "system_logs";
CREATE TRIGGER "system_logs_hash_chain"
  BEFORE INSERT ON "system_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_zincir_bagla"();

-- Canlı → arşiv taşıma (6 aylık arşivleyici + elle uç). Zinciri BOZMAZ: satır
-- sırası/özeti arşivde aynen yaşar, doğrulayıcı canlı ∪ arşivi okur.
CREATE OR REPLACE FUNCTION "audit_arsivle"(p_cutoff timestamptz, p_limit integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET "teks.audit_purge" = 'on'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- tz-ok: iki timestamptz karşılaştırılıyor; taban kuralı yaşa bağlı.
  IF p_cutoff IS NULL OR p_cutoff > now() - interval '1 month' THEN
    RAISE EXCEPTION 'Audit arşiv kesimi en az 1 ay önce olmalı (verilen: %).', p_cutoff
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'Audit arşiv parti boyu 1..50000 olmalı (verilen: %).', p_limit
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH parti AS (
    SELECT "id" FROM "system_logs" WHERE "createdAt" < p_cutoff
    ORDER BY "createdAt", "id" LIMIT p_limit
  ), tasinan AS (
    DELETE FROM "system_logs" l USING parti p WHERE l."id" = p."id" RETURNING l.*
  ), yazilan AS (
    INSERT INTO "system_log_archives" (
      "id", "userId", "category", "action", "tableName", "recordId", "ipAddress",
      "deviceId", "changes", "requestId", "oldData", "newData", "createdAt", "updatedAt",
      "chainSeq", "chainHash")
    SELECT "id", "userId", "category", "action", "tableName", "recordId", "ipAddress",
      "deviceId", "changes", "requestId", "oldData", "newData", "createdAt", "createdAt",
      "chainSeq", "chainHash"
    FROM tasinan
    ON CONFLICT ("id") DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM tasinan;
  RETURN v_n;
END;
$fn$;

-- Arşiv budaması (saklama süresi). Zincirli satırda YALNIZ sıra-öneki silinir:
-- S = min(canlıdaki en küçük sıra, arşivde `before`dan genç en küçük sıra) - 1.
-- S ilerlediyse ÖNCE kesit çapası yazılır (S'nin özetini taşır), sonra silinir.
CREATE OR REPLACE FUNCTION "audit_arsiv_buda"(p_before timestamptz)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET "teks.audit_purge" = 'on'
AS $fn$
DECLARE
  v_s integer;
  v_hash text;
  v_n bigint;
BEGIN
  -- tz-ok: iki timestamptz karşılaştırılıyor; taban kuralı yaşa bağlı.
  IF p_before IS NULL OR p_before > now() - interval '1 year' THEN
    RAISE EXCEPTION 'Audit arşiv budama kesimi en az 1 yıl önce olmalı (verilen: %).', p_before
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT least(
    (SELECT min("chainSeq") FROM "system_logs"),
    (SELECT min("chainSeq") FROM "system_log_archives" WHERE "createdAt" >= p_before)
  ) - 1 INTO v_s;
  IF v_s IS NULL THEN
    -- Canlıda ve genç arşivde zincirli satır yok: zincirli satıra dokunma.
    v_s := 0;
  END IF;
  SELECT "chainHash" INTO v_hash FROM "system_log_archives"
    WHERE "chainSeq" = v_s AND "createdAt" < p_before;
  IF v_hash IS NOT NULL THEN
    INSERT INTO "system_logs" ("id", "category", "action", "tableName", "recordId", "newData", "createdAt")
    VALUES (gen_random_uuid(), 'SYSTEM', 'AUDIT_CHAIN_CUT', 'SYSTEM', '-',
            jsonb_build_object('throughSeq', v_s, 'throughHash', v_hash, 'before', p_before),
            now()); -- tz-ok: timestamptz kolonuna an yazılıyor
  ELSE
    v_s := 0;
  END IF;
  DELETE FROM "system_log_archives"
   WHERE "createdAt" < p_before AND ("chainSeq" IS NULL OR "chainSeq" <= v_s);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- Zincir başlangıç çapası: zincir-öncesi satırların varlığı ve son damgası.
-- İdempotent: zincirli satır varsa yazılmaz.
INSERT INTO "system_logs" ("id", "category", "action", "tableName", "recordId", "newData", "createdAt")
SELECT gen_random_uuid(), 'SYSTEM', 'AUDIT_CHAIN_START', 'SYSTEM', '-',
       jsonb_build_object(
         'oncekiSatirVar', EXISTS (SELECT 1 FROM "system_logs" WHERE "chainSeq" IS NULL),
         'oncekiSonDamga', (SELECT max("createdAt") FROM "system_logs" WHERE "chainSeq" IS NULL)),
       now() -- tz-ok: timestamptz kolonuna an yazılıyor
WHERE NOT EXISTS (SELECT 1 FROM "system_logs" WHERE "chainSeq" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "system_log_archives" WHERE "chainSeq" IS NOT NULL);
