// Sipariş listesi hücrelerinin METNİ — ekran hücresi ile Excel/PDF/CSV dışa aktarımı
// AYNI fonksiyondan okur. Ayrı yazıldıklarında dışa aktarım boş kalmıştı (Kumaş/Renk/Sevk
// kolonları yalnız `cell` taşıyordu → `original.items` undefined → boş hücre).
import { safeFormat } from "@/lib/format";
import { orderStatusTones, type Tone } from "@/components/operations/StatusBadge";
import { orderStatusLabels, type OrderStatus } from "@/types/enums";
import type { Order, OrderLine, OrderSevk } from "./types";
import { isMeasuredUnit, unitLabel, type ItemUnitCode } from "@/lib/item-unit";

export interface LineLabel {
  key: string;
  label: string;
  hex?: string | null;
}

/**
 * Sipariş kalemlerindeki benzersiz kumaş/renk etiketleri — her zaman BİZDEKİ ad.
 * Satırdaki müşteri override'ı (customerItemName/customerColorName) burada
 * bilinçli basılmaz: override yalnız adın ilk girildiği siparişin satırında dolu
 * olduğundan (sonraki siparişlerde alan kilitli → NULL) aynı kumaş listede iki
 * farklı adla görünüyordu. Renksiz kalemler renk listesine girmez. İPTAL kalem
 * (`cancelledAt`) girmez: sipariş artık o kumaşı istemiyor (ekran + dosya aynı).
 */
export function distinctLineLabels(lines: OrderLine[] | undefined, kind: "item" | "color"): LineLabel[] {
  const map = new Map<string, { label: string; hex?: string | null }>();
  for (const l of lines ?? []) {
    if (l.cancelledAt) continue;
    if (kind === "item") {
      const label = l.item?.name;
      if (label && !map.has(l.itemId)) map.set(l.itemId, { label });
    } else {
      if (!l.colorId) continue;
      const label = l.color?.name;
      if (label && !map.has(l.colorId)) map.set(l.colorId, { label, hex: l.color?.hex });
    }
  }
  return [...map.entries()].map(([key, v]) => ({ key, ...v }));
}

/** Dışa aktarım metni: TÜM benzersiz etiketler "; " ile (ekran ilk 3'ü + "…" gösterir). */
export function lineLabelsText(lines: OrderLine[] | undefined, kind: "item" | "color"): string {
  return distinctLineLabels(lines, kind)
    .map((l) => l.label)
    .join("; ");
}

/** "Tutar" hücresi: "1234,50 TRY"; tutarsız sipariş null. */
export function totalAmountText(o: Order): string | null {
  if (!o.totalAmount) return null;
  const n = Number(o.totalAmount).toLocaleString("tr-TR", { useGrouping: false, minimumFractionDigits: 2 });
  return `${n} ${o.currency}`;
}

// ── Sipariş miktarı — TEK biçim (liste "Sevk" cümlesi, yan panel başlığı, kapsama, Nerede) ──
// Sunucu cümlesinin (`order-nerede.helper` fmtQty: tr-TR, binlik grup, en çok 2 hane)
// aynası; aynı miktar her yüzeyde aynı metni basar. Adet kesirsiz.
const ORDER_QTY_MAX_DECIMALS: Record<ItemUnitCode, number> = { MT: 2, KG: 2, ADET: 0 };
const qtyFormatters = new Map<number, Intl.NumberFormat>();

/** Birimin ondalık kuralıyla sayı ("668,3", "1.200"); birim yoksa metre. */
export function orderQtyNumber(n: number, unit?: string | null): string {
  const d = ORDER_QTY_MAX_DECIMALS[(unit ?? "MT") as ItemUnitCode] ?? 2;
  let f = qtyFormatters.get(d);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d });
    qtyFormatters.set(d, f);
  }
  return f.format(n);
}

/** Sayı + birim ("668,3 m"). */
export function orderQtyText(n: number, unit?: string | null): string {
  return `${orderQtyNumber(n, unit)} ${unitLabel(unit)}`;
}

// ── Metre ilerlemesi — TEK kaynak (liste "Metre" sütunu, Excel, yan panel "Sevk İlerlemesi") ──
// Yalnız ölçülü (MT) kalemler: kg/adet satırın sevki metre defterine yazılmaz, paydaya
// girse yüzde hiç dolmazdı. Sevk BRÜT (`order.shippedQty`, iade düşülmez). İstenen =
// aktif kalem miktarı + iptal kalemin sevk edilmiş kısmı (sunucu `deriveOrderSevk` ile aynı;
// yan yana duran "Sevk durumu" cümlesiyle aynı sayıyı söyler).

export interface OrderMetreProgress {
  shipped: number;
  requested: number;
  /** 0–100, tam sayı; aşırı sevkte 100'de durur. */
  pct: number;
}

type MetreLine = Pick<OrderLine, "quantity" | "unit" | "cancelledAt" | "shippedQty">;

/** Ölçülü kalemi yoksa ya da istenen 0 ise null (ekranda "—"). */
export function orderMetreProgress(o: { shippedQty?: number | string | null; lines?: MetreLine[] }): OrderMetreProgress | null {
  let requested = 0;
  for (const l of o.lines ?? []) {
    if (!isMeasuredUnit(l.unit)) continue;
    requested += Number(l.cancelledAt ? (l.shippedQty ?? 0) : (l.quantity ?? 0)) || 0;
  }
  if (!(requested > 0)) return null;
  const shipped = Number(o.shippedQty ?? 0) || 0;
  const pct = Math.min(100, Math.max(0, Math.round((shipped / requested) * 100)));
  return { shipped, requested, pct };
}

/** Hücre parçaları: miktar ("1.200 / 2.400 m") + yüzde ("%50"); ölçülemiyorsa null. */
export function orderMetreParts(o: Parameters<typeof orderMetreProgress>[0]): { qty: string; pct: string } | null {
  const p = orderMetreProgress(o);
  if (!p) return null;
  return { qty: `${orderQtyNumber(p.shipped, "MT")} / ${orderQtyText(p.requested, "MT")}`, pct: `%${p.pct}` };
}

/** "1.200 / 2.400 m (%50)"; ölçülemiyorsa "—". Hücre ve Excel aynı parçalardan yazar. */
export function orderMetreText(o: Parameters<typeof orderMetreProgress>[0]): string {
  const p = orderMetreParts(o);
  return p ? `${p.qty} (${p.pct})` : "—";
}

/** Gün metni — ekrandaki biçim (panel fabrika saat dilimindedir, `toFactoryYmd` ile aynı varsayım). */
export function dayText(iso: string | null | undefined): string {
  return safeFormat(iso, "dd.MM.yyyy", "");
}

// ── Sevk durumu — TEK kaynak (liste hücresi, süzgeç, yan panel, Excel, PDF) ──
// Sunucu cümlesi (backend 2.11.4+, BRÜT, miktar parantezde) varsa o; onaysız ve
// iptal siparişte sunucu "Henüz gönderilmedi" der → durum etiketi önce gelir.

/** Sunucu cümlesi bu durumlarda yanıltır; durum etiketi yazılır. */
const LABEL_FIRST: ReadonlySet<OrderStatus> = new Set(["PENDING", "CANCELLED"]);

export function orderSevkText(o: Pick<Order, "status" | "sevk">): string {
  if (!LABEL_FIRST.has(o.status) && o.sevk?.text) return o.sevk.text;
  return orderStatusLabels[o.status] ?? o.status;
}

const SEVK_KIND_TONES: Record<OrderSevk["kind"], Tone> = {
  NONE: "info",
  PARTIAL: "progress",
  ALL: "success",
  CLOSED: "muted",
};

export function orderSevkTone(o: Pick<Order, "status" | "sevk">): Tone {
  if (!LABEL_FIRST.has(o.status) && o.sevk) return SEVK_KIND_TONES[o.sevk.kind] ?? "neutral";
  return orderStatusTones[o.status] ?? "neutral";
}

/**
 * Sevk durumu KOVA etiketi (süzgeç seçeneği + özet şeridi rozeti) — listedekiyle aynı;
 * yalnız "Hepsi gönderildi" kovası elle kapatılanları da saydığı için bunu söyler.
 */
export function orderSevkBucketLabel(status: OrderStatus): string {
  const base = orderStatusLabels[status] ?? status;
  return status === "COMPLETED" ? `${base} ya da elle kapatıldı` : base;
}

/** Sevk durumu süzgeci seçenekleri — etiket `orderSevkBucketLabel`dan. */
export const ORDER_SEVK_FILTER_OPTIONS: ReadonlyArray<{ value: OrderStatus; label: string }> = (
  ["PENDING", "APPROVED", "PARTIAL_SHIPPED", "COMPLETED", "CANCELLED"] as const
).map((value) => ({ value, label: orderSevkBucketLabel(value) }));
