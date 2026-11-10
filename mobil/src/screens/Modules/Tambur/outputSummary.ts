// "Çıkan etiketler" özeti (2026-11-10): "N top · X m · Y kg". Metre BASILAN (initialQty) — kalan değil; kg yalnız
// tartılmış toplardan, hiç yoksa "—".
import type { Roll } from '../../../types/models';

export interface OutputTotals {
  count: number;
  meters: number;
  kg: number | null;
}

export function outputTotals(rolls: Pick<Roll, 'initialQty' | 'weightKg'>[]): OutputTotals {
  let meters = 0;
  let kg: number | null = null;
  for (const r of rolls) {
    meters += Number(r.initialQty ?? 0);
    const w = r.weightKg == null ? NaN : Number(r.weightKg);
    if (Number.isFinite(w) && w > 0) kg = (kg ?? 0) + w;
  }
  return { count: rolls.length, meters, kg };
}

export function kgCellText(weightKg: number | string | null | undefined): string {
  const w = weightKg == null ? NaN : Number(weightKg);
  return Number.isFinite(w) && w > 0 ? `${w.toFixed(1)} kg` : '—';
}

export function outputSummaryText(t: OutputTotals): string {
  return `${t.count} top · ${t.meters.toFixed(1)} m · ${t.kg == null ? '—' : t.kg.toFixed(1)} kg`;
}
