// Sipariş listesi hücrelerinin METNİ — ekran hücresi ile Excel/PDF/CSV dışa aktarımı
// AYNI fonksiyondan okur. Ayrı yazıldıklarında dışa aktarım boş kalmıştı (Kumaş/Renk/Sevk
// kolonları yalnız `cell` taşıyordu → `original.items` undefined → boş hücre).
import { safeFormat } from "@/lib/format";
import { orderStatusLabels } from "@/types/enums";
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

/** Gün metni — ekrandaki biçim (panel fabrika saat dilimindedir, `toFactoryYmd` ile aynı varsayım). */
export function dayText(iso: string | null | undefined): string {
  return safeFormat(iso, "dd.MM.yyyy", "");
}

export function orderStatusText(o: Order): string {
  return orderStatusLabels[o.status] ?? o.status;
}
