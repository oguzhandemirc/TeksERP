-- Kartelalık partial index: yalnızca markedForKartela = true satırları indeksler.
-- Toplam rolls'un ~%1-2'si → micro-index, geri kalan satırlarda bakım sıfır.
-- statement_timeout=0 zorunlu: canlı DB'de 30s app timeout migration'ı keser.
SET statement_timeout = 0;

DROP INDEX IF EXISTS "rolls_markedForKartela_idx";
CREATE INDEX "rolls_markedForKartela_idx" ON "rolls" ("markedForKartela") WHERE "markedForKartela" = true;
