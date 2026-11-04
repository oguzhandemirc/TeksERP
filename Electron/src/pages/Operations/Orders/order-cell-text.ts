// Sipariş listesi hücrelerinin METNİ — ekran hücresi ile Excel/PDF/CSV dışa aktarımı
// AYNI fonksiyondan okur. Ayrı yazıldıklarında dışa aktarım boş kalmıştı (Kumaş/Renk
// kolonları yalnız `cell` taşıyordu → `original.items` undefined → boş hücre).
import { isMeasuredUnit } from "@/lib/item-unit";
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

const fmtQty = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * "Sevk" hücresi: sevk/istenen m (yüzde). Yalnız METRE satırları toplanır: kg/adet
 * satırın karşılaması ölçülmez, paydaya girseydi sipariş asla %100 görünmezdi.
 * İstenen 0 ise null (ekranda "—").
 */
export function shippedProgress(o: Order): { text: string; pctText: string } | null {
  const requested = (o.lines ?? [])
    .filter((l) => isMeasuredUnit(l.unit))
    .reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  if (requested === 0) return null;
  const shipped = Number(o.shippedQty ?? 0);
  const pct = Math.min(100, Math.round((shipped / requested) * 100));
  return { text: `${fmtQty(shipped)}/${fmtQty(requested)} m`, pctText: `(${pct}%)` };
}

/** "Tutar" hücresi: "1234,50 TRY"; tutarsız sipariş null. */
export function totalAmountText(o: Order): string | null {
  if (!o.totalAmount) return null;
  const n = Number(o.totalAmount).toLocaleString("tr-TR", { useGrouping: false, minimumFractionDigits: 2 });
  return `${n} ${o.currency}`;
}
