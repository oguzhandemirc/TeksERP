-- =============================================================================
-- OrderStatus enum'una READY + SHORT eklenir
-- =============================================================================
-- READY: allocatedQty >= requestedQty (sevke hazır envanter var)
-- SHORT: önce READY'di, ama allocation azaldı (depocu başka siparişe transfer)
--        → planlamacı ek üretim/temin kararı vermesi gerek
--
-- ALTER TYPE ADD VALUE transaction-dışı çalışır; psql ile uygulanır.
-- =============================================================================

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SHORT';
