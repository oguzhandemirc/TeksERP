-- Drift düzeltme: work_orders.dyehouseNote şemada VAR ama hiçbir migration onu
-- OLUŞTURMUYORDU (20260604234200_add_workorder_dyehouse_note boş/eksik). Taze
-- `migrate deploy`'da kolon yok → work_orders'ı sorgulayan TÜM testler CI'da
-- `ColumnNotFound` ile çöküyordu (wholesale backend suite kırmızısının kök nedeni).
-- Bu migration eksik kolonu ekler.
--
-- NOT: roll_errors/sacks index'leri + bir index adı için de küçük tanım-drifti var
-- ama o index'ler taze DB'de zaten MEVCUT (sadece tanım/ad nüansı) → testleri
-- bozmuyor, bu yüzden bilerek dokunulmadı (yanlış DROP/CREATE veri riskli olurdu).
ALTER TABLE "work_orders" ADD COLUMN "dyehouseNote" TEXT;
