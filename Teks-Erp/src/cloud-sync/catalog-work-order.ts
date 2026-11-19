// Patron bulutu — `is-emri` v3 katalog ekleri (patron İE ekranı: nerede · kimin · hangi sipariş). `catalog-facts.ts`
// satır tavanı yüzünden ayrı dosya; okunan tablo listeleri ve kök eşleme SQL'i burada, türetici `cloud-sync/work-order-facts`.
import { derived, lookup, type ChangeSource, type DerivedSpec } from "./projection-types";

// İE v3 görünen ad / aşama / fason kaynakları: değişen satırın bağlı iş emirleri yeniden gider.
const WOS_OF_CUSTOMERS =
  'SELECT DISTINCT l."workOrderId" AS root_id FROM "work_order_to_order_lines" l JOIN "order_lines" ol ON ol."id" = l."orderLineId" JOIN "orders" o ON o."id" = ol."orderId" WHERE o."customerId" = ANY($1::uuid[]) AND l."unlinkedAt" IS NULL';
const WOS_OF_ITEMS = 'SELECT w."id" AS root_id FROM "work_orders" w WHERE w."targetItemId" = ANY($1::uuid[])';
const WOS_OF_COLORS = 'SELECT w."id" AS root_id FROM "work_orders" w WHERE w."targetColorId" = ANY($1::uuid[])';
const WO_OF_STATIONS = 'SELECT DISTINCT s."workOrderId" AS root_id FROM "work_order_steps" s WHERE s."stationId" = ANY($1::uuid[])';
const wosOfRolls = (rolls: string): string =>
  `SELECT s."workOrderId" AS root_id FROM "rolls" r JOIN "work_order_steps" s ON s."id" IN (r."producedInStepId", r."currentStepId") WHERE r."id" IN (${rolls}) ` +
  `UNION SELECT b."workOrderId" AS root_id FROM "rolls" r JOIN "batches" b ON b."id" = r."batchId" WHERE r."id" IN (${rolls}) AND b."workOrderId" IS NOT NULL`;
const WOS_OF_SUBCONTRACTORS = wosOfRolls(
  'SELECT i."rollId" FROM "subcontractor_dispatch_items" i JOIN "subcontractor_dispatches" d ON d."id" = i."dispatchId" WHERE d."subcontractorId" = ANY($1::uuid[]) AND d."cancelledAt" IS NULL AND i."rollId" IS NOT NULL',
);
// Açık kalem yüklemi (`outstandingItemOfOpenDispatch`) sevkin iptal/doğrudan sevk damgasını ve TAM makbuzu okur;
// kalem tablolarında `updatedAt` yok — kapsamaları `READ_COVERAGE`te (top durumu + başlık satırı).
const WO_OF_DISPATCHES = wosOfRolls('SELECT i."rollId" FROM "subcontractor_dispatch_items" i WHERE i."dispatchId" = ANY($1::uuid[]) AND i."rollId" IS NOT NULL');
const WO_OF_RECEIPTS = wosOfRolls(
  'SELECT i."rollId" FROM "subcontractor_receipt_items" ri JOIN "subcontractor_dispatch_items" i ON i."id" = ri."sourceDispatchItemId" WHERE ri."receiptId" = ANY($1::uuid[]) AND i."rollId" IS NOT NULL',
);
const NAME_OF = (model: string): string => `cloud-sync/derived displayNames: ${model}.name (BOYUT \`ad\` ile aynı kolon)`;

export const WORK_ORDER_V3_DERIVED: readonly DerivedSpec[] = [
  // 3 (patron İE ekranı): aşağıdakiler YALNIZ EKLENDİ — nerede · kimin · hangi sipariş (`cloud-sync/work-order-facts`).
  derived("acik", "helpers/live-ref-where.helper isOpenWorkOrderStatus (OPEN_WORK_ORDER ikizi)", ["work_orders"]),
  derived("musteriAdi", "cariKartIdleri ile AYNI çözüm (withProductionMeters.customers) — ilkinin adı", ["work_order_to_order_lines", "order_lines", "orders", "customers", "rolls"]),
  derived("musteriAdlari", "cariKartIdleri ile AYNI çözüm — sırasıyla adlar", ["work_order_to_order_lines", "order_lines", "orders", "customers", "rolls"]),
  derived("siparisIdleri", "cloud-sync/work-order-facts loadWorkOrderOrders (ACTIVE_ORDER_LINK, bağlanma sırası; süzgeç ikizi workOrderOrderWhere)", ["work_order_to_order_lines", "order_lines", "orders"]),
  derived("siparisNolari", "cloud-sync/work-order-facts loadWorkOrderOrders: siparisIdleri sırasıyla Order.orderNumber", ["work_order_to_order_lines", "order_lines", "orders"]),
  derived("urunAdi", NAME_OF("Item"), ["items"]),
  derived("renkAdi", NAME_OF("Color"), ["colors"]),
  derived("asamaTop", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: ROLL_STAGE_WHERE (Kurşun/Tambur = production-flow-where.helper akış kuyruğu) × whereRollsOfWorkOrders − K18 ölü", ["rolls", "batches", "work_order_steps", "stations"]),
  derived("asamalar", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: asamaTop anahtarları (diger hariç; süzgeç ikizi workOrderStageWhere)", ["rolls", "batches", "work_order_steps", "stations"]),
  derived("topSayisi", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: asamaTop toplamı", ["rolls", "batches", "work_order_steps"]),
  derived("metre", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: asamaTop toplamı (currentQty)", ["rolls", "batches", "work_order_steps"]),
  derived("fasonFirmaIdleri", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: fasondaki topların açık kalem firmaları (outstandingItemOfOpenDispatch; süzgeç ikizi workOrderFirmWhere)", ["rolls", "subcontractor_dispatch_items", "subcontractor_dispatches", "subcontractor_receipt_items", "subcontractor_receipts"]),
  derived("fasonFirmalari", "cloud-sync/work-order-facts loadWorkOrderWhereabouts: fason topları × en son açık kalemin firması (ad, top, metre, en eski gönderim); kalemsiz top firmasız satırda", ["rolls", "subcontractor_dispatch_items", "subcontractor_dispatches", "subcontractor_receipt_items", "subcontractor_receipts", "subcontractors"]),
];

export const WORK_ORDER_V3_SOURCES: readonly ChangeSource[] = [
  lookup("customers", "id", WOS_OF_CUSTOMERS, "cari adı değişince açık bağlı kökler yeniden gider"),
  lookup("items", "id", WOS_OF_ITEMS, "ürün adı değişince kökler yeniden gider"),
  lookup("colors", "id", WOS_OF_COLORS, "renk adı değişince kökler yeniden gider"),
  lookup("stations", "id", WO_OF_STATIONS, "istasyon türü/kalite yeteneği değişince aşama yeniden sınıflanır"),
  lookup("subcontractors", "id", WOS_OF_SUBCONTRACTORS, "fason firma adı değişince açık kalemli kökler yeniden gider"),
  lookup("subcontractor_dispatches", "id", WO_OF_DISPATCHES, "sevk iptali / doğrudan sevk kalemi kapatır"),
  lookup("subcontractor_receipts", "id", WO_OF_RECEIPTS, "makbuz iptali kaynak kalemi yeniden açar"),
];
