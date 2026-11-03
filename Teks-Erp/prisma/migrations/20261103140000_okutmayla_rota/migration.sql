-- K29 (Gülkesim 2026-11-03) okutmayla (esnek) rota — fabrika ayarı `production.routeMode` (varsayılan SEQUENTIAL = bugünkü).
-- Hepsi nullable/varsayılanlı: mevcut satırların davranışı değişmez. Geri alınamaz (yalnız ekleme).

-- İstasyon: okutunca adım eklenebilir (istasyon bazlı izin) + atlanamaz.
ALTER TABLE "stations" ADD COLUMN     "scanAddAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scanNotSkippable" BOOLEAN NOT NULL DEFAULT false;

-- Adım kökeni: NULL = plan; 'SCAN' = sahada (okutmayla) eklendi.
ALTER TABLE "work_order_steps" ADD COLUMN     "addedById" UUID,
ADD COLUMN     "addedDeviceId" VARCHAR(128),
ADD COLUMN     "addedVia" VARCHAR(16),
ADD COLUMN     "clientToken" UUID;

ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_addedVia_check" CHECK ("addedVia" IS NULL OR "addedVia" = 'SCAN');

-- İE: rota sahada belirlenir (okutmayla rota kipinde adımsız açılan İE).
ALTER TABLE "work_orders" ADD COLUMN     "scanRouted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "work_order_steps_clientToken_key" ON "work_order_steps"("clientToken");
