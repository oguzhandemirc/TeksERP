-- =============================================================================
-- Eksik FK index'leri (User → operatör/kimlik kolonları)
-- =============================================================================
-- CLAUDE.md Rule #1: "FK kolona index zorunlu — Prisma otomatik yapmaz."
-- Aşağıdaki 4 nullable User-FK indekssiz kalmıştı. Şu an UI'da operatör
-- filtresi yok ama dashboard / shift / verimlilik raporları yazılınca
-- seq scan'a düşer. Sigorta olarak şimdi ekliyoruz.
--
-- Uygulama:
--   npm run migrate:concurrent 20260507000200_missing_fk_indexes
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS "roll_operations_operatorId_idx"
  ON "roll_operations" ("operatorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "roll_movements_operatorId_idx"
  ON "roll_movements" ("operatorId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "traveler_card_scans_scannedById_idx"
  ON "traveler_card_scans" ("scannedById");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "subcontractor_dispatches_dispatchedById_idx"
  ON "subcontractor_dispatches" ("dispatchedById");
