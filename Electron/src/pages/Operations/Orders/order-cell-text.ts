// Sipariş listesi hücrelerinin METNİ — ekran hücresi ile Excel/PDF/CSV dışa aktarımı
// AYNI fonksiyondan okur. Ayrı yazıldıklarında dışa aktarım boş kalmıştı (Kumaş/Renk
// kolonları yalnız `cell` taşıyordu → `original.items` undefined → boş hücre).
import { isMeasuredUnit } from "@/lib/item-unit";
import { fmtNum } from "./order-where-text";
import type { Order, OrderLine } from "./types";

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
 * farklı adla görünüyordu. Müşterideki ad detay panelinde "Müşteride:" rozetiyle
 * etiketli gösterilir. Renksiz kalemler renk listesine girmez. İPTAL kalem
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

// ── Metre ilerlemesi — TEK kaynak (liste "Metre" sütunu, Excel, yan panel "Sevk İlerlemesi") ──
// Yalnız ölçülü (MT) kalemler: kg/adet satırın sevki metre defterine yazılmaz, paydaya
// girse yüzde hiç dolmazdı. Sevk BRÜT (`order.shippedQty`, iade düşülmez). İstenen =
// aktif kalem miktarı + iptal kalemin sevk edilmiş kısmı ("Sevk durumu" cümlesiyle aynı payda).

export interface OrderMetreProgress {
  shipped: number;
  requested: number;
  /** 0–100, tam sayı; aşırı sevkte 100'de durur. */
  pct: number;
}

type MetreLine = Pick<OrderLine, "quantity" | "unit" | "cancelledAt" | "shippedQty">;
type MetreOrder = { shippedQty?: number | string | null; lines?: MetreLine[] };

/** Ölçülü kalemi yoksa ya da istenen 0 ise null (ekranda "—"). */
export function orderMetreProgress(o: MetreOrder): OrderMetreProgress | null {
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
export function orderMetreParts(o: MetreOrder): { qty: string; pct: string } | null {
  const p = orderMetreProgress(o);
  if (!p) return null;
  return { qty: `${fmtNum(p.shipped)} / ${fmtNum(p.requested)} m`, pct: `%${p.pct}` };
}

/** "1.200 / 2.400 m (%50)"; ölçülemiyorsa "—". Hücre ve Excel aynı parçalardan yazar. */
export function orderMetreText(o: MetreOrder): string {
  const p = orderMetreParts(o);
  return p ? `${p.qty} (${p.pct})` : "—";
}
