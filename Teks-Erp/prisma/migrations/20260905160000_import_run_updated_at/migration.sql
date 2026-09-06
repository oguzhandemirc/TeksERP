-- =============================================================================
-- `import_runs.updatedAt` — [DB-04] boşluğunun TEK gerçek örneği · 2026-09-05
-- =============================================================================
-- ADDITIVE: kolon EKLENİR, mevcut satırlar backfill edilir, sonra NOT NULL.
-- Hiçbir satır silinmez, hiçbir kolon düşmez.
--
-- NEDEN YALNIZ BU MODEL: denetim "updatedAt taşımayan ama kodda update edilen"
-- 10 model saydı. Dokuzu ölçüldü ve DEFTER ya da PİVOT çıktı — onlarda
-- `updatedAt` yokluğu KONVANSİYONDUR, eksiklik değil (şemadaki `///`
-- gerekçeleri aynı commit'te yazıldı). `ImportRun` tek istisna: DURUM TAŞIYAN
-- bir master-data kaydıdır — token'lı koşumun satırı BAŞTA yazılır, koşum
-- bitince `status`/`finishedAt`/`durationMs`/`stoppedAtRowNo`/`errorReport`
-- alanlarıyla GÜNCELLENİR (`import.service.ts` upsert). "Bu koşum en son ne
-- zaman değişti" sorusunun cevabı yoktu; `createdAt` başlangıcı,
-- `finishedAt` NULL kalabiliyor (= hâlâ koşuyor).
--
-- BACKFILL: geçmiş satırlar için en doğru yaklaşık değer `finishedAt`, o da
-- NULL ise `createdAt`. Uydurma bir "şimdi" damgası bütün eski koşumları bugün
-- değişmiş gibi gösterirdi.
--
-- ⚠️ DB DEFAULT YOK (bilinçli): Prisma `@updatedAt` değeri UYGULAMA tarafında
-- yazar; kolona `DEFAULT` bırakmak `test_schema_drift`te belgesiz fark üretir
-- (Prisma her diff'te `DROP DEFAULT` isterdi). Bu yüzden sıra: nullable ekle →
-- doldur → `SET NOT NULL`.
--
-- İdempotent ([DB-23]): `ADD COLUMN IF NOT EXISTS` + `WHERE ... IS NULL`
-- backfill + `SET NOT NULL` (zaten NOT NULL ise no-op).
-- ÖLÇÜM: dev DB'de `import_runs` 60 satır → anlık. Canlıda tablo koşum başına
-- bir satır büyür (yüzler mertebesi); yine de [DB-25] gereği süre sınırı yok.
-- =============================================================================

SET statement_timeout = 0;

ALTER TABLE "import_runs" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ;

UPDATE "import_runs"
   SET "updatedAt" = COALESCE("finishedAt", "createdAt")
 WHERE "updatedAt" IS NULL;

ALTER TABLE "import_runs" ALTER COLUMN "updatedAt" SET NOT NULL;
