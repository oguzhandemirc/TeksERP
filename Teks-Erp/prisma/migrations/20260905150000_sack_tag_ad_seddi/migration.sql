-- =============================================================================
-- ÇUVAL İZİ (SackTag) AD SEDDİ — `sack_tags_name_key` UNIQUE · 2026-09-05
-- =============================================================================
-- ADDITIVE: yalnız `CREATE UNIQUE INDEX IF NOT EXISTS`, yumuşak kapı içinde.
-- Kolon/veri/kısıt değişmiyor.
--
-- NEDEN: `sack-tag.service.ts` katalog yazımlarında ad tekilliğini CHECK-THEN-ACT
-- ile koruyor (`createTag` findFirst→409→create · `updateTag` findFirst→409→
-- update). DB seddi YOKTU — tabloda yalnız `code @unique` vardı. Kapattığı üç
-- delik (nameFold emsalinin birebir aynısı):
--   1) YARIŞ — iki istemci aynı anda aynı adı yazar, iki SELECT de boş döner,
--      ikisi de INSERT eder (tx yok, kilit yok).
--   2) SERVİSİ ATLAYAN YOLLAR — script, elle SQL, geri yükleme.
--   3) İLERİDE EKLENECEK ikinci bir yazma ucu guard'ı unutursa sessiz kalır.
-- Uygulama guard'ı KALDIRILMAZ: kullanıcıya Türkçe 409'u o verir; bu index
-- sessiz son hattır (P2002 → error.middleware).
--
-- ⚠️ DÜZ (partial DEĞİL) ve HARF-DUYARLI — bilinçli: sed uygulama guard'ının
-- BİREBİR ikizi olmalıdır. Guard `findFirst({ where: { name } })` yazıyor:
-- `isActive` süzmüyor (pasif etiketin adı yeniden kullanılamaz) ve katlama
-- yapmıyor. Predicate ya da `lower()`/`tr_fold()` eklemek seddi guard'dan
-- AYIRIR — biri "var" derken diğeri "yok" der. Katlamalı sed istenirse o AYRI
-- bir karardır: önce guard değişir, sonra sed.
--
-- YUMUŞAK KAPI ([DB-24]): canlıda mükerrer ad DURUYORSA sert index deploy'u
-- kilitlerdi. Bu dosya önce sayar → varsa `RAISE NOTICE` + ATLAR (deploy geçer),
-- yoksa kurar. Temizlik bitince AYNI dosya yeniden koşulur (idempotent):
--   npx prisma db execute --file prisma/migrations/20260905150000_sack_tag_ad_seddi/migration.sql
-- Index eksik kaldığı sürece `scripts/test_schema_drift.ts` "sed bekliyor"
-- uyarısını (TOLERATED_DRIFT) basar — sinyal unutulmaz.
--
-- AD: Prisma varsayılanı `sack_tags_name_key`; şemadaki `@unique` aynı adı üretir
-- (drift yok) ve error.middleware'in `_<kolon>_key` regex'i kolonu doğru çıkarır.
-- ÖLÇÜM: dev DB'de `sack_tags` 0 satır — kurulum anlık. Canlıda katalog tablosu
-- (onlarca satır) olduğu için maliyet ihmal edilebilir; yine de [DB-25] gereği
-- süre sınırı kaldırılıyor.
-- =============================================================================

SET statement_timeout = 0;

DO $sed$
DECLARE
  n_dup integer;
  dups  text;
BEGIN
  SELECT count(*), string_agg(k, ' ; ' ORDER BY k)
    INTO n_dup, dups
    FROM (SELECT "name" AS k FROM "sack_tags" GROUP BY 1 HAVING count(*) > 1) s;

  IF n_dup > 0 THEN
    RAISE NOTICE '[sack_tag_ad_seddi] ATLANDI — % mükerrer ad (%). Panelden (Tanımlar → Çuval İzleri) adları farklılaştır, sonra bu dosyayı yeniden koş.',
      n_dup, dups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "sack_tags_name_key" ON "sack_tags" ("name");
    RAISE NOTICE '[sack_tag_ad_seddi] sack_tags_name_key kuruldu/zaten vardı.';
  END IF;
END
$sed$;
