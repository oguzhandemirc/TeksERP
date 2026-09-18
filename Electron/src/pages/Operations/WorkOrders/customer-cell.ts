// =============================================================================
// İş emri listesi — "Müşteri" hücresi (saf): 0 → "—" · 1 → ad · 2+ → ilk ad + "+N" (tooltip: hepsi)
// =============================================================================
// Kaynak liste satırındaki `customers` (DISTINCT, BAĞLANMA sıralı — ilk bağlanan = birincil, ≤5) + `customerCount` (toplam).
// Önizleme 5'i aşan toplam için `+N` toplamdan hesaplanır, önizleme uzunluğundan değil.
// Export (Excel/CSV) aynı metni virgülle birleştirir; 5'ten fazlası "… (+N)" ile beyan edilir.
// =============================================================================
import type { WorkOrder } from "./types";

export interface CustomerCellView {
  /** Birincil müşteri = ilk bağlanan (sunucu sırası); yoksa null → "—". */
  first: string | null;
  /** İlk dışında kalan müşteri sayısı (toplamdan); 0 → rozet yok. */
  extra: number;
  /** Tooltip / export metni: önizlemedeki adlar; toplam önizlemeyi aşıyorsa "… (+N)". */
  all: string;
}

export function customerCellView(wo: Pick<WorkOrder, "customers" | "customerCount">): CustomerCellView {
  const shown = wo.customers ?? [];
  const first = shown[0];
  if (!first) return { first: null, extra: 0, all: "" };
  const total = Math.max(wo.customerCount ?? shown.length, shown.length);
  const hidden = total - shown.length;
  const names = shown.map((c) => c.name).join(", ");
  return { first: first.name, extra: total - 1, all: hidden > 0 ? `${names} … (+${hidden})` : names };
}
