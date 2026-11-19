// Patron bulutu — `sevkiyat-icerigi` OLGU girdisi (catalog-facts.ts boyut sınırı için ayrı dosya; katalogda yeri değişmez).
import { col, derived, lookup, self, via, type RecordProjection } from "./projection-types";

// Sevkiyat içeriği top satırında ürün/renk adı taşır: canlı top (shipmentId) + iptal edilmemiş iade (fromShipmentId).
const SHIPMENTS_OF_ITEMS = 'SELECT r."shipmentId" AS root_id FROM "rolls" r WHERE r."itemId" = ANY($1::uuid[]) AND r."shipmentId" IS NOT NULL UNION SELECT rr."fromShipmentId" AS root_id FROM "roll_returns" rr WHERE rr."itemId" = ANY($1::uuid[]) AND rr."cancelledAt" IS NULL';
const SHIPMENTS_OF_COLORS = 'SELECT r."shipmentId" AS root_id FROM "rolls" r WHERE r."colorId" = ANY($1::uuid[]) AND r."shipmentId" IS NOT NULL UNION SELECT rr."fromShipmentId" AS root_id FROM "roll_returns" rr WHERE rr."colorId" = ANY($1::uuid[]) AND rr."cancelledAt" IS NULL';

export const SHIPMENT_CONTENT_FACT: RecordProjection = {
  // Patron sevkiyat dökümü (2026-11-20): çuval → top kırılımı, panel ayrıntısıyla aynı (`getShipmentById`, BRÜT).
  // `sevkiyat` satırına GÖMÜLMEDİ (liste sayfası yüzlerce top taşırdı); uygulama tek kaydı `GET /veri/sevkiyat-icerigi/:id` okur.
  // Satır ağır ⇒ birim başına 100 kök. Migration yok: `sevkiyat` ile aynı kaynaklar + `*_sync_parent_moved` işaretleri.
  name: "sevkiyat-icerigi", kind: "KAYIT", role: "OLGU", root: { table: "shipments", model: "Shipment" },
  columns: [col("id", "id"), col("sevkNo", "shipmentNo"), col("durum", "status"), col("cikisTarihi", "dispatchedAt"),
    col("olusturulma", "createdAt")],
  derived: [
    derived("ozet", "cloud-sync/shipment-content: ShippingService.getShipmentById summary (BRÜT) + tartiliCuval (kg'si dolu çuval)", ["sacks", "rolls", "roll_returns"]),
    derived("cuvallar", "cloud-sync/shipment-content: getShipmentById sacks[] (canlı + prevSackId iadeleri, hayalet `yok`)", ["sacks", "rolls", "roll_returns", "items", "colors"]),
    derived("cuvalsizToplar", "cloud-sync/shipment-content: getShipmentById rolls[] sackId boş", ["rolls", "roll_returns", "items", "colors"]),
  ],
  sources: [self("shipments"),
    via("sacks", "shipmentId", "ESKİ sevkiyat ayrılmada görünmez → sacks_sync_parent_moved tetikleyicisi"),
    via("rolls", "shipmentId", "ESKİ sevkiyat ayrılmada görünmez → rolls_sync_parent_moved tetikleyicisi"),
    via("roll_returns", "fromShipmentId"),
    lookup("items", "id", SHIPMENTS_OF_ITEMS, "ürün adı değişince o ürünlü sevkiyat içerikleri yeniden gider"),
    lookup("colors", "id", SHIPMENTS_OF_COLORS, "renk adı değişince o renkli sevkiyat içerikleri yeniden gider")],
  deletion: "YOK", permission: "bulut:sevkiyat:oku", unitRoots: 100,
  retention: { wireFields: ["cikisTarihi", "olusturulma"], sql: 'COALESCE(t."dispatchedAt", t."createdAt")' }, catalogVersion: 1,
};
