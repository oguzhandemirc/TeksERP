-- =============================================================================
-- rolls: kapsamsız createdAt sıralaması + Tambur "son çıkan toplar" (perf 2026-11-07)
-- =============================================================================
-- NE YAPIYOR: rolls'a iki YENİ index kurar; mevcut hiçbir nesneye dokunmaz.
-- ADDITIVE Mİ: EVET (yalnız CREATE INDEX IF NOT EXISTS).
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: `prisma migrate diff`in iki DropForeignKey satırı
-- (DEFERRABLE `*_sackId_shipmentId_consistency_fkey`, bilinen yanlış diff); dosya elle yazıldı.
-- [DB-26] gereği CONCURRENTLY YAZILMAZ (emsal 20260905171000); rolls 100 bin satırın altında,
-- kurulum saniyeler. [DB-25] gereği statement_timeout=0. Canlıda vardiya dışında uygulanır.
-- [DB-14]: şemada ikisi de düz `@@index([createdAt(sort: Desc), id(sort: Desc)])`; ikincinin
-- predicate'i yalnız burada — envanteri `scripts/test_db_invariants.ts`.
--
-- ÖLÇÜM (Adnan verisi kopyası, PG 16, rolls 22.591 satır; EXPLAIN ANALYZE):
--   Envanter "Tümü" ilk sayfa (ORDER BY "createdAt" DESC, id DESC LIMIT 101)
--     ÖNCE : Seq Scan + top-N heapsort
--     SONRA: Index Scan using rolls_createdAt_id_idx (LIMIT'te durur)
--   Tambur Çıkanlar ilk sayfa (entrySource IN tambur ∧ status NOT IN K18, LIMIT 51) + sayım
--     ÖNCE : Seq Scan (14.270 satır süzülür) + top-N · sayım da Seq Scan
--     SONRA: Index Scan using rolls_tambur_createdAt_idx · sayım index üzerinden
--   Ayrıntılı ms tablosu PR gövdesinde.
--
-- ⚠️ PREDICATE KÜMELERİ KOD KOPYASIDIR: `src/constants/tambur-entry-sources.ts`
-- (TAMBUR_ENTRY_SOURCES) ve `src/services/batch.service.ts` (K18_DEAD_STATUSES).
-- Küme değişirse sonuç YANLIŞ OLMAZ (sorgu index'i tutmaz, Seq Scan'e döner) ama kazanç
-- kaybolur; `test_db_invariants` predicate'i bu iki sabitten kurduğu için kırmızıya düşer
-- ve yeni bir migration ister.
-- =============================================================================
SET statement_timeout = 0;

-- Envanter "Tümü" (status=ALL) ve kapsamsız her createdAt listesi: ORDER BY ile birebir
-- (id ikinci anahtar = keyset cursor'ın ikinci alanı).
CREATE INDEX IF NOT EXISTS "rolls_createdAt_id_idx"
  ON "rolls" ("createdAt" DESC, "id" DESC);

-- Tambur "son çıkan toplar" (tambur.service recent-output-rolls): sorgunun sabit where'i
-- predicate'e taşınır → sıralı tarama LIMIT'te durur, sayım da yalnız bu alt kümeyi gezer.
CREATE INDEX IF NOT EXISTS "rolls_tambur_createdAt_idx"
  ON "rolls" ("createdAt" DESC, "id" DESC)
  WHERE "entrySource" IN ('TAMBUR_SPLIT', 'TAMBUR_MANUAL')
    AND "status" NOT IN ('SUBCONTRACTOR_CONSUMED', 'TAMBUR_CONSUMED', 'KARTELA_CONSUMED', 'CANCELLED');
