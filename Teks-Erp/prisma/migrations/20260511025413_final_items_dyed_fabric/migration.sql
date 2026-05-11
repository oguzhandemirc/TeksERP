-- Final ürün (isDerived = true) ham kumaştan + renkten oluşur → tanım gereği
-- boyalı kumaş. Önceden itemType baseItem'dan kopyalandığı için final'ler de
-- RAW_FABRIC olarak işaretliydi; bu raporlamada ham stok ile boyalı mamulü
-- aynı bucket'a düşürüyordu. Backfill ile düzeltiliyor.
UPDATE "items"
SET "itemType" = 'DYED_FABRIC'
WHERE "isDerived" = true
  AND "itemType" = 'RAW_FABRIC';
