-- =============================================================================
-- KALİTE KATALOĞU — ÜRETİM ROLÜ (`QualityGrade.role`) · 2026-09-13 · karar ①
-- =============================================================================
-- NE YAPAR (ADDITIVE — hiçbir kolon/kısıt DÜŞMEZ, hiçbir top satırına
-- DOKUNULMAZ): yeni `QualityGradeRole` enum'u + `quality_grades.role` kolonu +
-- rol başına tek AKTİF satır seddi (partial unique) + bugünkü davranışı birebir
-- koruyan rol damgası.
--
-- NEDEN: "1. kalite / 2. kalite / fire YAZ" soruları kodda string literalle
-- cevaplanıyordu (`"1.KALITE"` / `"A1"` / `"FIRE"`; ölçüm 2026-09-13: üretim
-- kodunda 24 site, üç ağaç). Kataloğu `1K/2K/HURDA` olan bir fabrikada bu
-- literaller SESSİZCE tutmaz: fire kesimi `qualityGradeId=null` ile doğar,
-- `resolveCutStatus` WAREHOUSE'a düşer ve fire SATILABİLİR STOK + iyi üretim
-- metrajı sayılır (`schema.prisma` QualityGrade notu tam bu kırılganlığı
-- yasaklıyordu).
--
-- ⚠️ NEDEN `targetStatus` YETMEDİ — bu migration'ın varlık sebebi:
--   `targetStatus` "hangi RAFA iner" sorusunu cevaplar, "bu 2. kalite mi"
--   sorusunu DEĞİL. Bu fabrikada `A1`in `targetStatus`u WAREHOUSE'tur
--   (A1_STOCK değil) ⇒ `loadProducedBuckets().a1Codes` BOŞ döner. "Literal
--   yerine a1Codes kullan" naif düzeltmesi iki uyarıyı (çuval içerik uyuşmazlığı
--   + çuval araması) bu fabrikada SESSİZCE KAPATIRDI. İki soru, iki alan.
--   ÜÇÜNCÜ soru (rozet rengi/sırası) role KATLANMAZ — `color`/`sortOrder`dan
--   okunur, yoksa dört kademeli katalogda dördüncü kademe rozetini kaybeder.
--
-- BUGÜN BİREBİR KORUNUR (ölçüldü 2026-09-13, `tekserp_fabrika_dev`):
--   Katalog 3 satır, kodlu top 5.454/5.454 bu üç kodda, yetim kod 0.
--   Damga MEVCUT KODLA yazılır (`1.KALITE→FIRST`, `A1→SECOND`, `FIRE→SCRAP`) —
--   bu dosyada kod literali MEŞRUDUR ve SON KULLANIMDIR: geçiş verisidir, karar
--   noktası değil. `A1`in `targetStatus=WAREHOUSE` tuhaflığı DÜZELTİLMEZ; rol ve
--   kova ayrı alanlar olduğu için o tuhaflık da birebir korunur.
--
-- ⚠️ SEED AYRICA YAZAR — migration TEK BAŞINA YETMEZ. Aşağıdaki UPDATE boş
-- tabloda hiçbir şey damgalamaz ve `prisma/seed.ts` ham `createMany` ile
-- migration'dan SONRA koşar ⇒ rol seed'e AÇIKÇA yazılmazsa TAZE KURULUM rolsüz
-- katalogla doğar ve her tambur kesimi 400 verir. (2026-08-10 `appliesColor`
-- tuzağının aynısı.) Seed ve bu dosya AYNI COMMIT'tedir; bekçi ikisini de ölçer.
--
-- İDEMPOTENT: her ifade IF NOT EXISTS / koşullu; ikinci koşum no-op.
-- `CREATE TYPE` + aynı tx'te değer kullanımı GÜVENLİDİR (PG kısıtı yalnız
-- `ALTER TYPE ... ADD VALUE` içindir; aynı tx'te YARATILAN enum'un değerleri
-- kullanılabilir). `statement_timeout` GEREKMEZ: katalog tablosu onlarca satır.
-- =============================================================================

-- ── 1) Enum tipi ─────────────────────────────────────────────────────────────
DO $rol_tipi$
BEGIN
  CREATE TYPE "QualityGradeRole" AS ENUM ('FIRST', 'SECOND', 'SCRAP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$rol_tipi$;

-- ── 2) Kolon ─────────────────────────────────────────────────────────────────
ALTER TABLE "quality_grades" ADD COLUMN IF NOT EXISTS "role" "QualityGradeRole";

-- ── 3) Rol damgası — BUGÜNKÜ DAVRANIŞIN taşıyıcısı ───────────────────────────
-- Yalnız rolsüz satıra yazar (ikinci koşumda ve elle rol atanmış kurulumda
-- no-op). Kod literali burada GEÇİŞ VERİSİDİR; karar noktası değildir ve
-- `test_quality_code_literal.ts` bu dosyayı gerekçeli MUAF sayar.
UPDATE "quality_grades" SET "role" = 'FIRST'  WHERE "code" = '1.KALITE' AND "role" IS NULL;
UPDATE "quality_grades" SET "role" = 'SECOND' WHERE "code" = 'A1'       AND "role" IS NULL;
UPDATE "quality_grades" SET "role" = 'SCRAP'  WHERE "code" = 'FIRE'     AND "role" IS NULL;

-- ── 4) Rol seddi — PARTIAL UNIQUE, YUMUŞAK KAPI ──────────────────────────────
-- PREDICATE'te `isActive` VAR (kullanıcı kararı K1, 2026-09-13): pasif satır
-- rolünü TARİH olarak taşır. `1.KALITE`yi pasifleştirip yerine `1K` koyan
-- fabrika, yenisini işaretlemeden önce eskinin rolünü null'lamak zorunda
-- kalmaz; çözücü zaten `role + isActive` okur.
--
-- YUMUŞAK: mükerrer aktif rol varsa index KURULMAZ, `RAISE NOTICE` ile geçilir
-- ve deploy DÜŞMEZ (sert `RAISE EXCEPTION` prod'da SONRAKİ HER deploy'u
-- bloklardı — `name_fold_unique_live` dersi). Temizlik sonrası AYNI dosya
-- yeniden koşulur ve eksik index'i kurar. O güne dek `test_db_invariants` §1
-- KIRMIZI verir — bilerek: "sed bekliyor" sinyali kaybolmasın.
-- Bu fabrikada mükerrer İMKANSIZ: damga `code`tan gelir, `code` zaten UNIQUE.
DO $rol_sed$
DECLARE
  n_dup integer;
  dups  text;
BEGIN
  SELECT count(*), coalesce(string_agg(t.rol::text, ', '), '')
    INTO n_dup, dups
    FROM (
      SELECT "role" AS rol
        FROM "quality_grades"
       WHERE "role" IS NOT NULL AND "isActive"
       GROUP BY "role"
      HAVING count(*) > 1
    ) t;

  IF n_dup > 0 THEN
    RAISE NOTICE 'quality_grades: % rolde birden çok AKTİF satır var (%) — partial unique ATLANDI. Katalogda rolü tekilleştirip bu dosyayı yeniden koşun.', n_dup, dups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "quality_grades_role_key"
      ON "quality_grades" ("role")
      WHERE "role" IS NOT NULL AND "isActive";
  END IF;
END
$rol_sed$;
