-- =============================================================================
-- Envanter "Bitmiş Depo" + "Üretimde" sekmeleri için İKİ PARTIAL index
-- (perf turu 2026-09-05, BULGU 1)
-- =============================================================================
-- NE YAPIYOR: iki YENİ partial index kurar. Mevcut hiçbir index'e dokunmaz.
-- ADDITIVE Mİ: EVET (yalnız CREATE INDEX IF NOT EXISTS).
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya tamamen elle yazıldı).
-- [DB-26] gereği CONCURRENTLY YAZILMAZ; [DB-25] gereği statement_timeout=0.
-- [DB-14]: şemada predicate YOK — `@@index([updatedAt(sort: Desc), id(sort: Desc)],
-- map: "rolls_depo_updatedAt_idx")` ve `@@index([updatedAt(sort: Desc)],
-- map: "rolls_uretim_updatedAt_idx")`; envanter satırları `test_db_invariants.ts`.
-- Emsal: `orders_active_createdAt_idx` (migration 20260826120000) — aynı desen.
--
-- ⚠️ PREDICATE'LERDEKİ STATÜ KÜMELERİ KOD KOPYASIDIR. Tek kaynak
-- `src/services/inventory.service.ts` → `buildRollWhere` içindeki
-- `rollScope === "FINISHED_STOCK"` (satır ~1520) ve `rollScope === "PRODUCTION_ACTIVE"`
-- (satır ~1502) dalları. Adlandırılmış bir sabit YOK (küme orada dizi literali olarak
-- duruyor); o dallar değişirse bu index'ler SESSİZCE yanlış alt kümeyi tutar —
-- sonuç yanlış OLMAZ (predicate tutmayan sorgu index'i kullanmaz, seq scan'e döner)
-- ama kazanç kaybolur. Kümeyi değiştiren commit yeni bir migration yazmalıdır.
--
-- ÖLÇÜM (tekserp_demo, PG 16.15, rolls 832 satır / 134 sayfa; sorgu = panelin
-- gerçek liste sorgusu: `buildRollWhere` çıktısı + ORDER BY "updatedAt" DESC,
-- id DESC LIMIT 51 — Electron `rollTabDefaultSortBy` bu sekmelerde updatedAt der):
--
--   "Bitmiş Depo" (FINISHED_STOCK, 93 satır)
--     ÖNCE : Seq Scan on rolls + Sort · Rows Removed by Filter 739
--            Buffers shared hit=140 · Execution 0,386 ms
--     SONRA: Bitmap Index Scan on rolls_depo_updatedAt_idx + Sort
--            Buffers shared hit=15 · Execution 0,073 ms   (buffer −%89)
--     Index boyutu 16 kB.
--     ⚠️ ÖLÇEK NOTU: bugün planlayıcı BITMAP+Sort seçiyor (93 satır 14 heap
--     sayfasına sığıyor). SIRALI yol da mevcut ve ÖLÇÜLDÜ (enable_bitmapscan=off:
--     "Index Scan Backward using rolls_depo_updatedAt_idx", 29 buffer / 0,033 ms,
--     LIMIT'te duruyor). Depo büyüdükçe bitmap+sort maliyeti sıralı yolu geçer ve
--     planlayıcı kendiliğinden ona döner — bu index bir ÖLÇEK yatırımıdır.
--
--   "Üretimde" (PRODUCTION_ACTIVE, 273 satır)
--     ÖNCE : Seq Scan on rolls + top-N heapsort · Rows Removed by Filter 559
--            Buffers shared hit=134 · Execution 0,169 ms
--     SONRA: Index Scan Backward using rolls_uretim_updatedAt_idx + Incremental Sort
--            Buffers shared hit=46 · Execution 0,042 ms   (buffer −%66)
--     Index boyutu 16 kB. Bu sekmede plan ŞİMDİDEN sıralı ve LIMIT'te duruyor —
--     ölçekte lineer değil logaritmik büyür.
--
-- YAZMA BEDELİ (BULGU 0 ile birlikte okunmalı): rolls'ta HOT-update oranı %0,8'dir
-- (n_tup_upd=54.625 / n_tup_hot_upd=450), yani her güncelleme tüm index'lere girdi
-- yazar. Bu iki index rolls'un index sayısını 28 → 30 yapar; PARTIAL oldukları için
-- ek yazım yalnız predicate'i tutan satırlarda doğar: bugün %11 (depo) ve %33
-- (üretimde). Karşılığında iki sekmenin tam tablo taraması kalkıyor.
-- =============================================================================
SET statement_timeout = 0;

-- Envanter → "Bitmiş Depo": status IN (WAREHOUSE, A1_STOCK), sıralama updatedAt DESC.
-- (status, updatedAt) bileşiği bu sekmeye ordering VEREMEZ — iki değerli ScalarArrayOp
-- btree'de sıralı sayılmaz. `id` ikinci anahtar: ORDER BY'ın ikinci kolonu ve keyset
-- cursor'ın da ikinci alanı odur.
CREATE INDEX IF NOT EXISTS "rolls_depo_updatedAt_idx"
  ON "rolls" ("updatedAt" DESC, "id" DESC)
  WHERE "status" IN ('WAREHOUSE', 'A1_STOCK');

-- Envanter → "Üretimde": WO akışındaki toplar. Kapsam bir NEGASYONDUR
-- (currentStepId dolu + status yedi ölü/depo değerinin dışında) ve hiçbir düz btree
-- negasyonu karşılayamaz; predicate'e taşınınca sıralı tarama mümkün oluyor.
CREATE INDEX IF NOT EXISTS "rolls_uretim_updatedAt_idx"
  ON "rolls" ("updatedAt" DESC)
  WHERE "currentStepId" IS NOT NULL
    AND "status" NOT IN (
      'WAREHOUSE', 'A1_STOCK', 'SCRAP', 'CANCELLED',
      'TAMBUR_CONSUMED', 'SUBCONTRACTOR_CONSUMED', 'RETURNED_FROM_SUBCONTRACTOR'
    );
