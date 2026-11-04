// "Kalem bazında Excel" — süzgece uyan siparişlerin HER (iptal olmayan) KALEMİ bir satır.
// Veri kaynağı liste ucunun kendisidir (`useDataTable.fetchAll` aynı where/sıralama):
// kalem, kumaş, renk, istenen özellik ve iş emri bağı liste yanıtında zaten geliyor.
import type { ExportColumn } from "@/lib/list-export";
import { isMeasuredUnit, unitLabel } from "@/lib/item-unit";
import { workOrderStatusLabels } from "@/types/enums";
import { dayText, orderSevkText } from "./order-cell-text";
import type { Order, OrderLine } from "./types";

export interface OrderLineExportRow {
  order: Order;
  line: OrderLine;
}

/** Sipariş sırası korunur; İPTAL kalem (`cancelledAt`) dosyaya girmez — listedeki Kumaş/Renk ile aynı. */
export function flattenOrderLines(orders: Order[]): OrderLineExportRow[] {
  return orders.flatMap((order) =>
    (order.lines ?? []).filter((line) => !line.cancelledAt).map((line) => ({ order, line })),
  );
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const optNum = (v: unknown): number | "" => (v == null || v === "" ? "" : num(v));

/** Sevki yalnız METRE kalemde ölçülür (kg/adet karşılaması metre defterinden ölçülmez) → diğerinde boş. */
const measured = (l: OrderLine) => isMeasuredUnit(l.unit);

export function lineShippedQty({ line }: OrderLineExportRow): number | "" {
  return measured(line) ? num(line.shippedQty) : "";
}

/** Kalan = miktar − sevk (eksiye düşmez); ölçülmeyen birimde boş. */
export function lineOpenQty({ line }: OrderLineExportRow): number | "" {
  if (!measured(line)) return "";
  return Math.max(0, num(line.quantity) - num(line.shippedQty));
}

const requiredPropsText = (l: OrderLine) => (l.requiredProperties ?? []).map((p) => p.property.name).join(", ");
const workOrdersText = (l: OrderLine) =>
  (l.workOrderLinks ?? [])
    .map((w) => `${w.workOrder.workOrderNumber} (${workOrderStatusLabels[w.workOrder.status] ?? w.workOrder.status})`)
    .join(", ");

/**
 * Kolonlar. Miktar/Sevk/Kalan yalnız TEK birimli dosyada toplanır (m + kg toplanmaz).
 * Fiyat kolonları `pricingEnabled` ile — listedeki "Tutar" kolonunun kapısıyla aynı.
 * İş emri kolonu üretim modülüyle düşer (listedeki "İş Emri" kolonu gibi).
 */
export function orderLineExportColumns(
  rows: OrderLineExportRow[],
  opts: { pricingEnabled: boolean; productionEnabled: boolean },
): ExportColumn<OrderLineExportRow>[] {
  const singleUnit = new Set(rows.map((r) => r.line.unit ?? "MT")).size <= 1;
  const C = (label: string, value: (r: OrderLineExportRow) => unknown, summable = false) => ({
    label,
    value,
    summable,
  });
  return [
    C("Sipariş No", (r) => r.order.orderNumber),
    C("Müşteri", (r) => r.order.customer?.name ?? ""),
    C("Şube", (r) => r.order.branch?.name ?? ""),
    C("Kumaş", (r) => r.line.item?.name ?? ""),
    C("Renk", (r) => r.line.color?.name ?? ""),
    C("Özellikler", (r) => requiredPropsText(r.line)),
    C("En (cm)", (r) => optNum(r.line.width)),
    C("Miktar", (r) => num(r.line.quantity), singleUnit),
    C("Birim", (r) => unitLabel(r.line.unit ?? "MT")),
    ...(opts.pricingEnabled
      ? [C("Birim Fiyat", (r) => optNum(r.line.unitPrice)), C("Para Birimi", (r) => r.order.currency)]
      : []),
    C("Sevk Edilen", lineShippedQty, singleUnit),
    C("Kalan", lineOpenQty, singleUnit),
    C("Termin", (r) => dayText(r.order.deadline)),
    C("Sevk durumu", (r) => orderSevkText(r.order)),
    ...(opts.productionEnabled ? [C("İş Emri", (r) => workOrdersText(r.line))] : []),
    C("Kalem Notu", (r) => r.line.cutNote ?? ""),
  ];
}
