-- Faz 5 — Index temizliği (veritabani mimari denetimi bulgulari)
-- O-13/O-14 (roll_operations), D-5 (RollError sorgu yolu), D-6 (redundant sol-prefix),
-- D-7 (isProcessed full->partial). Saf yazma-maliyeti/performans; davranis degismez.
--
-- statement_timeout=0 (CLAUDE.md kural 14). Yeni CREATE INDEX'ler dolu uretim
-- tablosunda (roll_operations) yazma kilidi alir -> VARDIYA DISI deploy et.
-- Silinen 9 index'in HEPSININ FK'si baska bir composite/unique'in ilk kolonu
-- tarafindan kapsanir (FK's  indeksiz kalmaz) — pg_indexes ile dogrulandi.
SET statement_timeout = 0;

-- ============================================================================
-- O-13: roll_operations olu index'ler
--   rollId       -> roll_operations_rollId_workOrderStepId_operationType_key sol-prefix'i
--   operationType-> dusuk-secicilikli enum, tek basina hicbir sorguda surucu degil
-- ============================================================================
DROP INDEX "roll_operations_rollId_idx";
DROP INDEX "roll_operations_operationType_idx";

-- ============================================================================
-- O-14: rapor sorgulari (quality.report: operationType = ... AND createdAt aralik)
-- icin composite. operationType-only sorgulari da bu index'in sol-prefix'i kapsar.
-- ============================================================================
CREATE INDEX "roll_operations_operationType_createdAt_idx" ON "roll_operations" ("operationType", "createdAt");

-- ============================================================================
-- D-5: RollError.detectedByUserId sorgu yolu dogmus (Cihaz Islem Dokumu raporu,
-- work-session-activity.service:287). processedByUserId emsaliyle simetrik composite.
-- ============================================================================
CREATE INDEX "roll_errors_detectedByUserId_detectedAt_idx" ON "roll_errors" ("detectedByUserId", "detectedAt");

-- ============================================================================
-- D-6: sol-prefix redundant tekil index'ler (hepsi bir composite/unique'in ilk kolonu;
-- FK erisimi o composite'ten karsilanir). Her satir yaziminda gereksiz index bakimi.
-- ============================================================================
DROP INDEX "order_lines_itemId_idx";                  -- <= order_lines_itemId_createdAt_idx
DROP INDEX "user_permissions_userId_idx";             -- <= user_permissions_userId_permissionId_key
DROP INDEX "subcontractor_receipt_items_receiptId_idx"; -- <= ..._receiptId_newRollId_key
DROP INDEX "kartela_receipt_items_receiptId_idx";     -- <= ..._receiptId_consumedRollId_key
DROP INDEX "customer_item_aliases_customerId_idx";    -- <= ..._customerId_itemId_key
DROP INDEX "customer_color_aliases_customerId_idx";   -- <= ..._customerId_colorId_key
DROP INDEX "sacks_shipmentId_idx";                    -- <= sacks_shipmentId_seq_key

-- ============================================================================
-- D-7: roll_errors.isProcessed FULL boolean index -> PARTIAL (yalniz acik hatalar).
-- Kayitlarin cogu zamanla isProcessed=true olur (Tambur kapanisi); dashboard sayaci
-- yalniz false'lari sorgular. Prisma adi (_idx) korunur -> drift-free desen (O-7 gibi).
-- ============================================================================
DROP INDEX "roll_errors_isProcessed_idx";
CREATE INDEX "roll_errors_isProcessed_idx" ON "roll_errors" ("isProcessed") WHERE "isProcessed" = false;
