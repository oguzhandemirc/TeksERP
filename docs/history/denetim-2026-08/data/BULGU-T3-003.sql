-- BULGU-T3-003 doğrulama sorguları (K2) — DENENDİ, DB ERİŞİLEMEDİ (ortam engeli, aşağıya bak).
-- Amaç: iptal edilmiş sipariş/kaleme yazılmış sevk tahsisi var mı?

-- 1) Sipariş BAŞLIĞI iptal edilmişken shippedQty > 0 olan kalemler
--    (order_lines.cancelledAt kolonu olmayan eski DB kopyalarında da koşar).
SELECT o."orderNumber", ol.id, ol."shippedQty"
FROM order_lines ol
JOIN orders o ON o.id = ol."orderId"
WHERE o.status = 'CANCELLED' AND ol."shippedQty" > 0;

-- 2) Kalem SEVİYESİNDE iptal edilmiş ama iptalden SONRA dispatch edilmiş sevkiyata
--    tahsis yazılmış satırlar (order_lines.cancelledAt kolonu şart — migration 20260827100000).
SELECT ol.id AS order_line_id, o."orderNumber", ol."cancelledAt", s."shipmentNo", s."dispatchedAt", a.qty
FROM order_lines ol
JOIN orders o ON o.id = ol."orderId"
JOIN sack_allocations a ON a."orderLineId" = ol.id
JOIN sacks k ON k.id = a."sackId"
JOIN shipments s ON s.id = k."shipmentId"
WHERE ol."cancelledAt" IS NOT NULL
  AND s."dispatchedAt" > ol."cancelledAt";
