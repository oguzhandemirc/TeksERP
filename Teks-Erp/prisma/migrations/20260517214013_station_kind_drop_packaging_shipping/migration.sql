-- StationKind enum'undan PACKAGING ve SHIPPING değerlerini kaldır.
-- Paketleme ve sevkiyat WO üretim akışının değil, fulfillment domain'in
-- parçaları (PackagingQueue + ayrı sevkiyat). Hiçbir servis bu istasyon
-- türlerini kullanmıyordu — enum + bağlı satırlar ölü koddu.
--
-- Çalıştırılmadan önce doğrulandı: bu kind'a sahip Station satırlarına
-- WorkOrderStep / Machine / RouteStep / TravelerCardScan / StationColor /
-- StationProperty tablolarından FK referansı yok (0 satır).

-- 1) Bu kind'a sahip orphan Station satırlarını fiziksel sil.
DELETE FROM "stations" WHERE "kind" IN ('PACKAGING', 'SHIPPING');

-- 2) Enum tipini yeniden oluştur (Postgres ENUM değer silmeye doğrudan izin vermez).
ALTER TABLE "stations" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TYPE "StationKind" RENAME TO "StationKind_old";
CREATE TYPE "StationKind" AS ENUM ('RAW_QC', 'PROCESS_QC', 'TAMBUR', 'SUBCONTRACTOR', 'OTHER');
ALTER TABLE "stations"
  ALTER COLUMN "kind" TYPE "StationKind"
  USING ("kind"::text::"StationKind");
ALTER TABLE "stations" ALTER COLUMN "kind" SET DEFAULT 'OTHER'::"StationKind";
DROP TYPE "StationKind_old";
