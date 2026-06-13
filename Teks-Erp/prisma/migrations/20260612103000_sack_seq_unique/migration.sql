-- M-17 (BACKEND-CODE-REVIEW-2.md): Sack.seq _count tabanlıydı — çuval silme
-- sonrası eklenen çuval mevcut seq'i alabiliyordu (deterministik çakışma) ve
-- donmuş irsaliye snapshot'ında iki ayrı "Çuval N" kalıcılaşıyordu. Servis
-- artık max(seq)+1 hesaplıyor; bu unique constraint eşzamanlı çift addSack'in
-- kaybedenine P2002 verdirir (withBarcodeRetry taze max ile yeniden dener).
SET statement_timeout = 0;

-- Mevcut çift seq'leri benzersizleştir (en eski kayıt seq'ini korur; sonrakiler
-- sevkiyatın o anki max'ının üstüne taşınır).
WITH dups AS (
  SELECT id, "shipmentId", seq,
         ROW_NUMBER() OVER (PARTITION BY "shipmentId", seq ORDER BY "createdAt", id) AS rn
  FROM "sacks"
),
maxes AS (
  SELECT "shipmentId", MAX(seq) AS max_seq FROM "sacks" GROUP BY "shipmentId"
),
renumber AS (
  SELECT d.id,
         m.max_seq + ROW_NUMBER() OVER (PARTITION BY d."shipmentId" ORDER BY d.id) AS new_seq
  FROM dups d
  JOIN maxes m ON m."shipmentId" = d."shipmentId"
  WHERE d.rn > 1
)
UPDATE "sacks" s
SET seq = r.new_seq
FROM renumber r
WHERE s.id = r.id;

CREATE UNIQUE INDEX "sacks_shipmentId_seq_key" ON "sacks" ("shipmentId", "seq");
