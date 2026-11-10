// El terminali sevkiyatı — sayı biçimi ve özet metinleri (saf). Rakamlar sunucunun `state`inden; burada hesap yok,
// yalnız gösterim kararı (çuvalda elle kg yoksa topların kg toplamı gri "toplam" olarak).
import type { HandheldLoadState, HandheldSack } from '../../../../services/handheldShipment.service';

export const fmtM = (n: number): string => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
export const fmtKg = (n: number): string => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
export const fmtInt = (n: number): string => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

export interface Metric {
  key: string;
  value: string;
  unit: string;
}

/** Üst özet şerit: N çuval · M top · X m · Y kg (kg yoksa "—"). */
export function summaryMetrics(s: HandheldLoadState['summary']): Metric[] {
  return [
    { key: 'sack', value: fmtInt(s.nonEmptySackCount), unit: 'çuval' },
    { key: 'roll', value: fmtInt(s.rollCount), unit: 'top' },
    { key: 'm', value: fmtM(s.meters), unit: 'm' },
    { key: 'kg', value: s.kg != null && s.kg > 0 ? fmtKg(s.kg) : '—', unit: 'kg' },
  ];
}

export type SackKgKind = 'manual' | 'sum' | 'none';

/** Çuval kartındaki kg: elle girilen (koyu) · topların toplamı (gri, "toplam") · hiçbiri. */
export function sackKgDisplay(sack: Pick<HandheldSack, 'weightKg' | 'rollKgSum'>): { kind: SackKgKind; text: string | null } {
  if (sack.weightKg != null && sack.weightKg > 0) return { kind: 'manual', text: `${fmtKg(sack.weightKg)} kg` };
  if (sack.rollKgSum != null && sack.rollKgSum > 0) return { kind: 'sum', text: `${fmtKg(sack.rollKgSum)} kg` };
  return { kind: 'none', text: null };
}

export function sackMeta(sack: Pick<HandheldSack, 'rolls' | 'meters'>): string {
  if (sack.rolls.length === 0) return 'Boş';
  return `${fmtInt(sack.rolls.length)} top · ${fmtM(sack.meters)} m`;
}

export interface DispatchSummary {
  sacks: { id: string; sackNo: string; rollCount: number }[];
  emptySackNos: string[];
  looseRollCount: number;
  rollCount: number;
  meters: number;
  kg: number | null;
  kgMissing: number;
}

/** Sevk onayı özeti — boş çuvallar ayrı (sevkte düşer, K8). */
export function dispatchSummary(state: HandheldLoadState): DispatchSummary {
  const full = state.sacks.filter((s) => s.rolls.length > 0);
  return {
    sacks: full.map((s) => ({ id: s.id, sackNo: s.sackNo, rollCount: s.rolls.length })),
    emptySackNos: state.sacks.filter((s) => s.rolls.length === 0).map((s) => s.sackNo),
    looseRollCount: state.loose.rolls.length,
    rollCount: state.summary.rollCount,
    meters: state.summary.meters,
    kg: state.summary.kg,
    kgMissing: state.summary.kgMissing,
  };
}

/** "2 çuval (8 top) + 3 top dökme" — irsaliyedeki yük özetinin ekran karşılığı. */
export function loadSummaryLine(d: Pick<DispatchSummary, 'sacks' | 'looseRollCount'>): string {
  const parts: string[] = [];
  if (d.sacks.length > 0) {
    const inSacks = d.sacks.reduce((t, s) => t + s.rollCount, 0);
    parts.push(`${fmtInt(d.sacks.length)} çuval (${fmtInt(inSacks)} top)`);
  }
  if (d.looseRollCount > 0) parts.push(`${fmtInt(d.looseRollCount)} top dökme`);
  return parts.join(' + ') || 'Boş';
}

/** Sonuç satırı: "2 çuval + 3 dökme · 11 top" (sunucunun sevk cevabından). */
export function resultLine(r: { sackCount: number; looseRollCount: number; rollCount: number }): string {
  const parts: string[] = [];
  if (r.sackCount > 0) parts.push(`${fmtInt(r.sackCount)} çuval`);
  if (r.looseRollCount > 0) parts.push(`${fmtInt(r.looseRollCount)} dökme`);
  return `${parts.join(' + ') || 'Boş'} · ${fmtInt(r.rollCount)} top`;
}

export const KG_MAX = 9999.999;

/** Tuş takımı metni → kg (>0, ≤ 9999,999, en çok 3 ondalık); geçersizse null. */
export function parseKgInput(text: string): number | null {
  const t = text.replace(',', '.').trim();
  if (!/^\d{1,4}(\.\d{0,3})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= KG_MAX ? n : null;
}
