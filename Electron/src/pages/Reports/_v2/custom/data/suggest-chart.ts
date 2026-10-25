// =============================================================================
// Önerilen grafik — kuyulardaki ölçü sayısı ve boyut TÜRÜNDEN (plan §4.5; R2-VERI)
// =============================================================================
// Öneri yalnız başlangıçtır: kullanıcı "Grafik türü"nden değiştirir; elle seçilmiş tür ezilmez
// (`chartAfterChange` yalnız önceki öneride kalmış grafiği günceller).
// =============================================================================

export type SuggestedChart = "cizgi" | "cubuk" | "isiHaritasi" | "sacilim" | "anaSayi";

export interface ChartShape {
  measureCount: number;
  dimensionKinds: ReadonlyArray<"zaman" | "kategori">;
}

export interface ChartSuggestion {
  kind: SuggestedChart;
  label: string;
  reason: string;
}

/** Öncelik sırası tablodur; vitest her satırı ölçer. */
export function suggestChart({ measureCount, dimensionKinds }: ChartShape): ChartSuggestion {
  const categories = dimensionKinds.filter((k) => k === "kategori").length;
  if (dimensionKinds.includes("zaman")) return { kind: "cizgi", label: "Çizgi", reason: "Zamana göre değişim çizgiyle okunur." };
  if (measureCount >= 2) return { kind: "sacilim", label: "Saçılım", reason: "İki ölçünün birlikte nasıl değiştiği saçılımla görünür." };
  if (categories >= 2) return { kind: "isiHaritasi", label: "Isı haritası", reason: "İki kırılımın kesişimi ısı haritasında renkle görünür." };
  if (categories === 1) return { kind: "cubuk", label: "Çubuk", reason: "Tek kırılımın değerleri çubuklarla kıyaslanır." };
  return { kind: "anaSayi", label: "Ana sayı", reason: "Tek değer büyük sayıyla gösterilir; grafik yerine “Ana sayı” bölümü kullanın." };
}

/**
 * Kuyu değişince grafik türü: mevcut tür eski öneriyle aynıysa (ya da boşsa) yeni öneriye geçer;
 * kullanıcı elle başka tür seçtiyse dokunulmaz. Öneri "anaSayi" ise grafik türü değişmez.
 */
export function chartAfterChange(current: string | undefined, before: ChartShape, after: ChartShape): string | undefined {
  const next = suggestChart(after).kind;
  if (next === "anaSayi") return current;
  if (current === undefined || current === suggestChart(before).kind) return next;
  return current;
}
