// =============================================================================
// SEMANTİK KATMAN — helper ölçünün bellek içi süzgeci ve kırılım tavanı
// =============================================================================
// Helper ölçü mevcut servisin satırlarını döndürür; süzgeç ve "Diğer" kovası SQL yoluyla AYNI
// anlamla burada uygulanır: `=`/`in` NULL'u tutmaz, `!=`/`notIn` NULL'u tutar (SQL tarafı
// `IS DISTINCT FROM`); tavan sıralaması tam kümeden, ağırlığa göre (eşitlikte değerle).
// =============================================================================
import type { CompiledFilter, SemanticDimension } from "./tipler";

export type KeyFn<R> = (dimensionId: string, row: R) => string | null;

export function applyMemoryFilters<R>(rows: readonly R[], filters: readonly CompiledFilter[], key: KeyFn<R>): R[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = key(f.dimension.id, r);
      switch (f.operator) {
        case "=":
          return v !== null && v === f.values[0];
        case "!=":
          return v === null || v !== f.values[0];
        case "in":
          return v !== null && f.values.includes(v);
        case "notIn":
          return v === null || !f.values.includes(v);
        default:
          // `contains` etiket üstünde çalışır; helper ölçüde derleyici zaten 400 verir.
          return false;
      }
    }),
  );
}

export interface MemoryGroup<R> {
  keys: Record<string, { value: string | null; other?: true }>;
  rows: R[];
}

export interface CapSpec<R> {
  dimensions: readonly SemanticDimension[];
  key: KeyFn<R>;
  /** Sıralama ağırlığı (ör. metre) — para birimlerini karıştırmadan "en büyük N". */
  weight: (r: R) => number;
  cap: number;
}

export function capMemoryGroups<R>(rows: readonly R[], spec: CapSpec<R>): MemoryGroup<R>[] {
  const { dimensions, key, weight, cap } = spec;
  const kept = new Map<string, Set<string | null>>();
  for (const d of dimensions) {
    const limit = Math.min(d.cardinalityCap || cap, cap);
    if (d.kind !== "category" || limit <= 0) continue;
    const totals = new Map<string | null, number>();
    for (const r of rows) {
      const v = key(d.id, r);
      totals.set(v, (totals.get(v) ?? 0) + weight(r));
    }
    if (totals.size <= limit) continue;
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    kept.set(d.id, new Set(ranked.slice(0, limit).map(([v]) => v)));
  }
  const groups = new Map<string, MemoryGroup<R>>();
  for (const r of rows) {
    const keys: MemoryGroup<R>["keys"] = {};
    for (const d of dimensions) {
      const v = key(d.id, r);
      const keep = kept.get(d.id);
      keys[d.id] = keep && !keep.has(v) ? { value: null, other: true } : { value: v };
    }
    const id = JSON.stringify(dimensions.map((d) => [keys[d.id]!.value, keys[d.id]!.other === true]));
    const g = groups.get(id);
    if (g) g.rows.push(r);
    else groups.set(id, { keys, rows: [r] });
  }
  return [...groups.values()];
}
