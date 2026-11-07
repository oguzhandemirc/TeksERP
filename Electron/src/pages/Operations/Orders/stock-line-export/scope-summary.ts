// Dosya başlığındaki "uygulanan süzgeç" özeti — ekrandaki liste kapsamının (useDataTable `listScope`)
// okunur cümlesi. Ad çözümü çekilen siparişlerden yapılır (süzgece uyan her sipariş seçilen müşteriyi/
// kumaşı zaten taşır); ek istek atılmaz. Tanınmayan anahtar ham "anahtar: değer" yazılır, düşmez.
import { formatCalendarDay } from "@/lib/factory-time";
import type { Order } from "../types";
import { ORDER_SHIP_FILTER_OPTIONS, WHERE_TABS } from "../order-where-text";

export interface OrderListScope {
  filters: Record<string, string | string[] | undefined>;
  search?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
}

const WO_STATE_LABELS: Record<string, string> = {
  NONE: "İş emri yok",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Üretimde",
  COMPLETED: "Üretildi",
};

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);

function nameMaps(orders: Order[]) {
  const customer = new Map<string, string>();
  const branch = new Map<string, string>();
  const item = new Map<string, string>();
  const color = new Map<string, string>();
  for (const o of orders) {
    if (o.customer) customer.set(o.customer.id, o.customer.name);
    if (o.branch) branch.set(o.branch.id, o.branch.name);
    for (const l of o.lines ?? []) {
      if (l.item) item.set(l.item.id, l.item.name);
      if (l.color) color.set(l.color.id, l.color.name);
    }
  }
  return { customer, branch, item, color };
}

export function describeOrderScope(scope: OrderListScope, orders: Order[]): string[] {
  const maps = nameMaps(orders);
  const names = (ids: string[], m: Map<string, string>) => ids.map((id) => m.get(id) ?? id).join(", ");
  const out: string[] = [];
  for (const [key, raw] of Object.entries(scope.filters)) {
    const ids = list(raw);
    if (ids.length === 0) continue;
    switch (key) {
      case "hideCancelled":
        if (ids[0] === "true") out.push("İptal siparişler gizli");
        break;
      case "status":
        out.push(`Sevk durumu: ${ids.map((v) => ORDER_SHIP_FILTER_OPTIONS.find((x) => x.value === v)?.label ?? v).join(", ")}`);
        break;
      case "woState":
        out.push(`Üretim: ${ids.map((v) => WO_STATE_LABELS[v] ?? v).join(", ")}`);
        break;
      case "customerId":
        out.push(`Müşteri: ${names(ids, maps.customer)}`);
        break;
      case "branchId":
        out.push(`Şube: ${names(ids, maps.branch)}`);
        break;
      case "itemId":
        out.push(`Kumaş: ${names(ids, maps.item)}`);
        break;
      case "colorId":
        out.push(`Renk: ${names(ids, maps.color)}`);
        break;
      case "nerede":
        out.push(`Nerede?: ${ids.map((v) => WHERE_TABS.find((t) => t.value === v)?.label ?? v).join(", ")}`);
        break;
      case "fasondaGunden":
        out.push(`Fasonda ${ids[0]} günden uzun`);
        break;
      case "fasonFirmaId":
        out.push(`Fason firma süzgeci (${ids.length})`);
        break;
      default:
        out.push(`${key}: ${ids.join(", ")}`);
    }
  }
  if (scope.dateFrom || scope.dateTo) {
    const field = scope.dateField === "deadline" ? "Termin" : "Sipariş Tarihi";
    const f = scope.dateFrom ? formatCalendarDay(scope.dateFrom) : "…";
    const t = scope.dateTo ? formatCalendarDay(scope.dateTo) : "…";
    out.push(`${field}: ${f} – ${t}`);
  }
  if (scope.search) out.push(`Arama: "${scope.search}"`);
  return out;
}
