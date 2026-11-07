-- ADDITIVE: WorkOrderType'a "Fason (müşteri malı)" değeri (müşterinin emanet malına hizmet; giden fason DEĞİL).
-- Tek ifade: değer aynı dosyada kullanılmaz (PG 55P04). Geri alınamaz (PG enum değeri düşürmez).
ALTER TYPE "WorkOrderType" ADD VALUE IF NOT EXISTS 'CUSTOMER_GOODS_SERVICE';
