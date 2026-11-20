-- Gevşetme: tel×metre birim fiyatı 4 ondalığa sığmaz; ölçek 8'e, tam kısım 8 hane korunur (12,4 → 16,8). Mevcut değerler aynen kalır.
-- AlterTable
ALTER TABLE "warping_orders" ALTER COLUMN "feeUnitPrice" SET DATA TYPE DECIMAL(16,8);
