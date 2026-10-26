-- MAL-8: patron bulutu yeni kök tabloları (teklif · teklif-kalemi · standart-maliyet) için silme işareti.
-- Desen `20260929152815_patron_bulut_esitleme` ⑤ ile birebir; fonksiyon o migration'da kurulu (sync_mark_deleted).
-- Kalem silinince üst teklif KIRLI olur (taslak kapsam dışıdır ama işaret kapsam kararından bağımsız yazılır).
DROP TRIGGER IF EXISTS "sales_quotes_sync_deleted" ON "sales_quotes";
CREATE TRIGGER "sales_quotes_sync_deleted" AFTER DELETE ON "sales_quotes" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
DROP TRIGGER IF EXISTS "sales_quote_lines_sync_deleted" ON "sales_quote_lines";
CREATE TRIGGER "sales_quote_lines_sync_deleted" AFTER DELETE ON "sales_quote_lines" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted('sales_quotes', 'quoteId');
DROP TRIGGER IF EXISTS "standard_cost_versions_sync_deleted" ON "standard_cost_versions";
CREATE TRIGGER "standard_cost_versions_sync_deleted" AFTER DELETE ON "standard_cost_versions" FOR EACH ROW EXECUTE FUNCTION sync_mark_deleted();
