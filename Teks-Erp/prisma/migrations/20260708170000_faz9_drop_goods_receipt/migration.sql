-- Faz 9 — Y-1 (GoodsReceipt) İPTAL / geri alma.
-- DOMAIN doğrulaması (backend + kullanıcı teyidi): ham kumaş SATIN ALINMIYOR — fabrika-içi
-- kayıtsız (kapsam-dışı) bir süreçten geliyor. Dolayısıyla tedarikçi/mal-kabul/lot kavramı
-- YOK; Faz 7'de kurulan GoodsReceipt foundation ÖLÜ. ('SUPPLIER_RECEIPT' enum adı yanıltıcıymış.)
-- Güvenli: goods_receipts satır=0, rolls.goodsReceiptId/supplierLotNo hepsi NULL, app-code
-- hiç referans vermiyor (grep=0). O-19 (operatör izi) ve CompanyType enum'u KORUNUR.
SET statement_timeout = 0;

-- DROP COLUMN, kolonun FK'sını (rolls_goodsReceiptId_fkey) ve index'lerini otomatik düşürür.
ALTER TABLE "rolls" DROP COLUMN "goodsReceiptId";
ALTER TABLE "rolls" DROP COLUMN "supplierLotNo";

-- goods_receipts + kendi FK'ları (supplierId->customers, receivedById->users) tabloyla gider.
DROP TABLE "goods_receipts";
