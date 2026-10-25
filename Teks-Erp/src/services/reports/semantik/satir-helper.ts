// =============================================================================
// SEMANTİK KATMAN — kaynak servis SATIRLARINDAN helper ölçü (R1-SEMKUP)
// =============================================================================
// Karmaşık ölçü (randıman, levent dengesi, ortalama dönüş, vade kovası) mevcut servisin satırını
// okur; grup değeri satırların TOPLAMINDAN yeniden hesaplanır (`aggregate`) — oran/ortalama
// ortalanmaz. Süzgeç ve "Diğer" kovası `bellek-kirilim.ts` ile SQL yoluyla aynı anlamdadır.
// =============================================================================
import { applyMemoryFilters, capMemoryGroups, type KeyFn } from "./bellek-kirilim";
import type { HelperInput, HelperResult, HelperRow } from "./tipler";

export interface RowHelperSpec<R> {
  key: KeyFn<R>;
  label: (dimensionId: string, row: R) => string | null;
  /** "Diğer" sıralaması (en büyük N); oran ölçüsünde paydanın büyüklüğü. */
  weight: (row: R) => number;
  aggregate: (rows: readonly R[]) => number | null;
  /** Para ölçüsü: para birimi başına ayrı grup ve ayrı toplam (çevrim yok). */
  currency?: (row: R) => string;
}

function groupRows<R>(rows: readonly R[], spec: RowHelperSpec<R>): Array<{ currency?: string; rows: R[] }> {
  if (!spec.currency) return [{ rows: [...rows] }];
  const by = new Map<string, R[]>();
  for (const r of rows) {
    const c = spec.currency(r);
    by.set(c, [...(by.get(c) ?? []), r]);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, rs]) => ({ currency, rows: rs }));
}

export function helperFromRows<R>(input: HelperInput, all: readonly R[], spec: RowHelperSpec<R>, notes: string[] = []): HelperResult {
  const rows = applyMemoryFilters(all, input.filters, spec.key);
  const out: HelperRow[] = [];
  const totals: HelperResult["totals"] = [];
  for (const part of groupRows(rows, spec)) {
    const groups = capMemoryGroups(part.rows, { dimensions: input.dimensions, key: spec.key, weight: spec.weight, cap: input.cap });
    for (const g of groups) {
      const keys: HelperRow["keys"] = {};
      for (const d of input.dimensions) {
        const k = g.keys[d.id]!;
        keys[d.id] = k.other ? { value: null, label: "Diğer", other: true } : { value: k.value, label: spec.label(d.id, g.rows[0]!) };
      }
      out.push({ keys, ...(part.currency !== undefined ? { currency: part.currency } : {}), value: spec.aggregate(g.rows) });
    }
    totals.push({ ...(part.currency !== undefined ? { currency: part.currency } : {}), value: spec.aggregate(part.rows) });
  }
  // Para ölçüsünde boş küme para birimi bilmez: toplam listesi boş kalır (0 uydurulmaz).
  return { rows: out, totals, notes };
}

/** Boyutsuz helper (yalnız toplam): kaynak servisin tek sayısı aynen taşınır. */
export function totalOnly(value: number | null, notes: string[] = []): HelperResult {
  return { rows: [{ keys: {}, value }], totals: [{ value }], notes };
}
