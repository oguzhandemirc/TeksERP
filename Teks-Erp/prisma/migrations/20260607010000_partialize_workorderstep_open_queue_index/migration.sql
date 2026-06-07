-- Açık-kart kuyruğu indeksini PARTIAL'a çevir (WHERE status <> 'COMPLETED').
--
-- Kurşun+KK2 ve Tambur "Açık Kartlar" sorguları tek fiziksel istasyon altında
-- `station.kind = X AND status <> COMPLETED AND currentRolls.some()` arar (her
-- 15sn'de bir poll edilir). Tek istasyon altında COMPLETED step'ler iş emri
-- başına BİR tane sonsuza dek birikir; tam B-tree'de `status <> COMPLETED` bir
-- seek değil FİLTRE olduğundan, sorgu o istasyonun TÜM (büyüyen) index dilimini
-- her pollda baştan sona tarardı.
--
-- Partial: indeks YALNIZ açık step'leri tutar (anlık WIP — sınırlı). COMPLETED
-- yığını indekste hiç yer almaz → sorgu plan-bağımsız O(açık step). Kapsama
-- korunur çünkü her iki açık-kart sorgusu da zaten `status <> COMPLETED` arar.
-- Tek collateral: station hard-delete'in `deleteMany({ stationId })`'ı (tüm
-- statüler, COMPLETED dahil) bu indeksi kullanamaz → seq scan. Nadir bir admin
-- işlemi (istasyon silme) olduğundan kabul edilebilir.
--
-- (Prisma 7 partial predicate'i şemada native desteklemez → raw SQL. Şemadaki
--  @@index aynı kolonlarla DURUYOR; Prisma predicate'i drift saymaz.)
-- ⚠️ statement_timeout=30s aktif → büyük tabloda CREATE INDEX iptal olabilir.
SET statement_timeout = 0;

DROP INDEX IF EXISTS "work_order_steps_stationId_status_isUrgent_priority_started_idx";
CREATE INDEX "work_order_steps_stationId_status_isUrgent_priority_started_idx"
  ON "work_order_steps" ("stationId", "status", "isUrgent", "priority", "startedAt")
  WHERE status <> 'COMPLETED';
