-- Gülkesim K6: rota şablonu "iş emri kısayolu" işareti + sırası (varsayılan false/0 = bugünkü: kısayol yok).
-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "isWorkOrderShortcut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shortcutOrder" INTEGER NOT NULL DEFAULT 0;
