-- KASA BAKİYESİ TEK YAZAR (2026-09-18) — 3/3: tür↔yön CHECK'i yeni türleri tanır (COLLECTION → IN · PAYMENT → OUT).
-- AYRI migration: PostgreSQL yeni enum etiketini eklendiği transaction içinde KULLANDIRMAZ ("unsafe use of new value");
-- Prisma her migration'ı tek tx'te koşar → etiketler 20260918150000'de eklendi, kolon 150050'de, burada kullanılır.
-- İDEMPOTENT: DROP IF EXISTS + ADD. Mevcut satırların hepsi eski kümededir, yeni ifade üst kümedir → doğrulama geçer.
-- Beyan: scripts/test_db_invariants.ts (ad ile, mevcut satır).

ALTER TABLE "cash_transactions" DROP CONSTRAINT IF EXISTS "cash_txn_kind_matches_direction";
ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_txn_kind_matches_direction"
  CHECK (
    ("kind" IN ('EXPENSE', 'TRANSFER_OUT', 'PAYMENT') AND "direction" = 'OUT') OR
    ("kind" IN ('INCOME', 'TRANSFER_IN', 'OPENING', 'COLLECTION') AND "direction" = 'IN')
  );
