-- =============================================================================
-- AUDIT PURGE KAPISI GÖVDEYE (2026-10-13) — süper olmayan sahip rolle koşulabilirlik
-- =============================================================================
-- `20261013120000_audit_hash_zinciri`nin ilk hâli `audit_arsivle` / `audit_arsiv_buda`
-- tanımına `SET "teks.audit_purge" = 'on'` koyuyordu. PG15+'da süper olmayan rol özel
-- parametreyi fonksiyon tanımında yazamaz (42501): Windows sahibi `tekserp` migrate
-- deploy'da, bakım rolü dökümden geri yüklemede düşer. O dosya beyanlı onarımla
-- düzeltildi (`prisma/migration-onarimlari.json`); bu migration, ESKİ hâlini zaten
-- uygulamış veritabanlarında iki fonksiyonu aynı gövdeyle yeniden yazar (CREATE OR
-- REPLACE fonksiyon ayarlarını — proconfig — da değiştirir; EXECUTE yetkileri korunur).
-- Yeni kurulumda no-op eşdeğeridir (aynı tanım). Davranış birebir: purge yalnız
-- fonksiyon gövdesi boyunca 'on', sonda önceki değer geri yazılır.
-- Bekçi: scripts/test_migration_super_olmayan.ts · test_audit_hash_zinciri.
-- =============================================================================

CREATE OR REPLACE FUNCTION "audit_arsivle"(p_cutoff timestamptz, p_limit integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
  v_onceki text := current_setting('teks.audit_purge', true);
BEGIN
  PERFORM set_config('teks.audit_purge', 'on', true);
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
  PERFORM set_config('teks.audit_purge', coalesce(v_onceki, ''), true);
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION "audit_arsiv_buda"(p_before timestamptz)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_s integer;
  v_hash text;
  v_n bigint;
  v_onceki text := current_setting('teks.audit_purge', true);
BEGIN
  PERFORM set_config('teks.audit_purge', 'on', true);
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
  PERFORM set_config('teks.audit_purge', coalesce(v_onceki, ''), true);
  RETURN v_n;
END;
$fn$;
