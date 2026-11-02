// Gözden geçirme yüzeyinin tel tipleri — backend `gelen-belge-kontrol.service.ts` aynası (detay yanıtı).
export type LineProblem = "FAILED" | "ITEM_UNRESOLVED" | "NEEDS_REVIEW";

/** Onay toplam kapısının (`totalsCheck`) hükmü — backend hesaplar, panel yalnız gösterir. */
export interface TotalDiff {
  field: "count" | "m" | "kg";
  declared: number | null;
  actual: number;
  diff: number | null;
}
export interface BlockCheck {
  blockNo: number;
  lines: { count: number; m: number; kg: number };
  declared: { count: number | null; m: number | null; kg: number | null } | null;
  diffs: TotalDiff[];
  ok: boolean | null;
}
export interface TotalsCheck {
  ok: boolean | null;
  tolerance: number;
  blocks: BlockCheck[];
  mismatches: string[];
  warnings: string[];
}
