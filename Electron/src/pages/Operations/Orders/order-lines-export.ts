// "Kalem bazında Excel" — süzgece uyan siparişlerin HER KALEMİ bir satır.
// Veri kaynağı liste ucunun kendisidir (`useDataTable.fetchAll` imleci sonuna kadar döndürür,
// aynı where/sıralama): kalem, kumaş, renk, varyant, hedef değer ve iş emri bağı liste
// yanıtında zaten geliyor — ikinci bir uç ya da ayrı where kurulmaz.
import type { ExportColumn } from "@/lib/list-export";
import { isMeasuredUnit, unitLabel } from "@/lib/item-unit";
import { safeFormat } from "@/lib/format";
import { formatCalendarDay } from "@/lib/factory-time";
import { workOrderStatusLabels } from "@/types/enums";
import { TERIM } from "@/lib/terim";
import { orderShipText } from "./order-where-text";
import type { Order, OrderLine } from "./types";

export interface OrderLineExportRow {
  order: Order;
  line: OrderLine;
}

/** Sipariş sırası korunur; her siparişin kalemleri yanıttaki sırayla. */
export function flattenOrderLines(orders: Order[]): OrderLineExportRow[] {
  return orders.flatMap((order) => (order.lines ?? []).map((line) => ({ order, line })));
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Kalemin sevki ölçülür mü: yalnız METRE (kg/adet karşılaması metre defterinden ölçülmez). */
const measured = (l: OrderLine) => isMeasuredUnit(l.unit);

/** Sevk edilmeyi bekleyen miktar: iptal/kapanmış sipariş ve iptal kalemde 0; ölçülmeyen birimde boş. */
export function lineOpenQty({ order, line }: OrderLineExportRow): number | "" {
  if (!measured(line)) return "";
  if (line.cancelledAt || order.status === "CANCELLED" || order.status === "COMPLETED") return 0;
  return Math.max(0, num(line.quantity) - num(line.shippedQty));
}

export function lineStatusText({ order, line }: OrderLineExportRow): string {
  if (line.cancelledAt) return "Kalem iptal";
  if (order.status === "CANCELLED") return "Sipariş iptal";
  if (order.status === "COMPLETED") return "Kapandı";
  if (!measured(line)) return "Açık";
  const shipped = num(line.shippedQty);
  if (shipped >= num(line.quantity) && shipped > 0) return "Sevk tamam";
  return shipped > 0 ? "Kısmi sevk" : "Açık";
}

/** Kalem tutarı (miktar × birim fiyat, 2 hane); fiyatsız kalemde boş. */
export function lineAmount({ line }: OrderLineExportRow): number | "" {
  if (line.unitPrice == null || line.unitPrice === "") return "";
  return Math.round(num(line.quantity) * num(line.unitPrice) * 100) / 100;
}

const recipeText = (l: OrderLine) =>
  l.recipe ? `${l.recipe.name}${l.recipe.variantCode ? ` (${l.recipe.variantCode})` : ""}` : "";
const targetValuesText = (l: OrderLine) =>
  (l.targetValues ?? [])
    .map((t) => [t.property?.name, t.value?.name].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
const requiredPropsText = (l: OrderLine) => (l.requiredProperties ?? []).map((p) => p.property.name).join(", ");
const workOrdersText = (l: OrderLine) =>
  (l.workOrderLinks ?? [])
    .map((w) => `${w.workOrder.workOrderNumber} (${workOrderStatusLabels[w.workOrder.status] ?? w.workOrder.status})`)
    .join(", ");
const optNum = (v: unknown): number | "" => (v == null || v === "" ? "" : num(v));

/**
 * Kolonlar. Miktar/Sevk/Kalan yalnız TEK birimli dosyada toplanır (m + kg toplanmaz);
 * Tutar yalnız TEK para birimli dosyada. Fiyat kolonları `pricingEnabled` ile — liste
 * ekranındaki "Tutar" kolonunun kapısıyla aynı. İş emri kolonu üretim modülüyle düşer.
 */
export function orderLineExportColumns(
  rows: OrderLineExportRow[],
  opts: { pricingEnabled: boolean; productionEnabled: boolean },
): ExportColumn<OrderLineExportRow>[] {
  const singleUnit = new Set(rows.map((r) => r.line.unit ?? "MT")).size <= 1;
  const singleCurrency = new Set(rows.map((r) => r.order.currency)).size <= 1;
  const C = (label: string, value: (r: OrderLineExportRow) => unknown, summable = false) => ({ label, value, summable });
  return [
    C("Sipariş No", (r) => r.order.orderNumber),
    // Liste ekranının "Sevk durumu" cümlesi (sipariş geneli, BRÜT).
    C("Sevk durumu", (r) => orderShipText(r.order)),
    C("Müşteri", (r) => r.order.customer?.name ?? ""),
    C("Şube", (r) => r.order.branch?.name ?? ""),
    C("Sipariş Tarihi", (r) => safeFormat(r.order.orderDate, "dd.MM.yyyy", "")),
    C("Termin", (r) => (r.order.deadline ? formatCalendarDay(r.order.deadline, "dd.MM.yyyy") : "")),
    C("Kumaş Kodu", (r) => r.line.item?.code ?? ""),
    C("Kumaş", (r) => r.line.item?.name ?? ""),
    C("Müşteri Kumaş Adı (kalemde)", (r) => r.line.customerItemName ?? ""),
    C("Renk Kodu", (r) => r.line.color?.code ?? ""),
    C("Renk", (r) => r.line.color?.name ?? ""),
    C("Müşteri Renk Adı (kalemde)", (r) => r.line.customerColorName ?? ""),
    C("Varyant", (r) => recipeText(r.line)),
    C("Hedef Değerler", (r) => targetValuesText(r.line)),
    C("İstenen Özellikler", (r) => requiredPropsText(r.line)),
    C("En (cm)", (r) => optNum(r.line.width)),
    C("Top Boyu (m)", (r) => optNum(r.line.pieceLengthM)),
    C("Miktar", (r) => num(r.line.quantity), singleUnit),
    C("Birim", (r) => unitLabel(r.line.unit ?? "MT")),
    ...(opts.pricingEnabled
      ? [
          C("Birim Fiyat", (r) => optNum(r.line.unitPrice)),
          C("Para Birimi", (r) => r.order.currency),
          C("Tutar", lineAmount, singleCurrency),
        ]
      : []),
    C("Sevk Edilen", (r) => (measured(r.line) ? num(r.line.shippedQty) : ""), singleUnit),
    C("Kalan", lineOpenQty, singleUnit),
    C("Kalem Durumu", lineStatusText),
    ...(opts.productionEnabled ? [C(`Bağlı ${TERIM.terbiyeIsEmri.cogul}`, (r) => workOrdersText(r.line))] : []),
    C("Not", (r) => r.line.cutNote ?? ""),
    C("İptal Sebebi", (r) => r.line.cancelReason ?? ""),
  ];
}
