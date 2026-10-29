-- H1b: kurşun çıkış metresinin stok kipi (okuma satırına kopya; mevcut satırlar RECORD = bugünkü davranış).
CREATE TYPE "MeterStockMode" AS ENUM ('RECORD', 'APPLY');

ALTER TABLE "roll_meter_readings" ADD COLUMN "stockMode" "MeterStockMode" NOT NULL DEFAULT 'RECORD';

-- H1b: sapma satırının Roll.initialQty'yi ne kadar yükselttiği (APPLY artı yön); tersinde aynı miktar geri iner.
ALTER TABLE "roll_variances" ADD COLUMN "initialQtyRaise" DECIMAL(12,3);

-- Çift yüklem: yükseltme yalnız pozitif ve yalnız aşım (OVERAGE) satırında olur.
ALTER TABLE "roll_variances" ADD CONSTRAINT "roll_variances_initial_qty_raise_ck"
  CHECK ("initialQtyRaise" IS NULL OR ("initialQtyRaise" > 0 AND "kind" = 'OVERAGE'));
