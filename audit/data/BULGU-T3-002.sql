-- BULGU-T3-002 (= S-2-01) — sipariş defteri yazmadan DISPATCHED olan sevkiyatlar
-- Tur 2'de sql-saha.sh (prod kopyası, tekserp_saha_0825) üzerinde koşturulmuş ve
-- audit/01-find/tur2-BIRLESIK.md içinde BULGU-T2-001 olarak kayda geçmiş sorgu ile
-- BİREBİR AYNI zemin. Bu turda (2026-08-29) aynı ortam engeli nedeniyle YENİDEN
-- KOŞTURULAMADI — bkz. BULGU-T3-002.md "Ortam engeli" bölümü.

SELECT s.id, s."shipmentNo", s.status, s."dispatchedAt"
FROM shipments s
WHERE s.status = 'DISPATCHED'
  AND EXISTS (SELECT 1 FROM sacks k2 WHERE k2."shipmentId" = s.id)
  AND NOT EXISTS (
    SELECT 1 FROM sack_allocations a
    JOIN sacks k ON k.id = a."sackId"
    WHERE k."shipmentId" = s.id
  );
