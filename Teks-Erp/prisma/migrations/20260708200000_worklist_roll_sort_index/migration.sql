-- Worklist Faz 12 — F123 (rolls sıralama) . F249 NO-OP.
-- F123: status-filtreli rolls listesinde en olası sort (currentQty = depo miktar) için composite.
--   initialQty/width/qualityGrade İÇİN EKLENMEDİ — rolls zaten çok-index'li (kendi D-8 bulgum:
--   yazma amplifikasyonu). Bu sortlar seyrek ve tiny-dev'de EXPLAIN doğrulanamıyor. Sort
--   whitelist DARALTILMADI (UI hâlâ sıralar; ölçekte gerçek EXPLAIN ihtiyaç gösterirse eklenir).
-- F249: subcontractor_dispatches.dispatchedAt ZATEN 4 index'li (dispatchedAt + workOrderId/
--   subcontractorId/stepId composite'leri) → subcontract raporunun date-range sorgusu karşılanıyor,
--   YENİ INDEX GEREKMEZ. (shipments.dispatchedAt yalnız SET/SELECT, range-sorgu yok.)
SET statement_timeout = 0;

CREATE INDEX "rolls_status_currentQty_idx" ON "rolls" ("status", "currentQty");
