// =============================================================================
// SEMANTİK KATMAN — sonuç zarfı ve satır biçimleme (R1-SEMCEK)
// =============================================================================
// Tel anahtarları Türkçe (`satirlar`, `toplam`, `kiyas`); oran ölçüsü kümelenmiş pay/paydadan
// YENİDEN hesaplanır ve payda 0 ise "ölçülemedi" (null) döner, 0'a çökmez.
// =============================================================================
import { REPORT_MAX_ROWS } from "../_shared";
import { sumColumns } from "./derleyici";
import type { CompiledQuery, HelperResult } from "./tipler";

export interface SemanticCell { deger: string | null; etiket: string | null; diger?: true }
export interface SemanticRow {
  anahtarlar: Record<string, SemanticCell>;
  donem?: string | null;
  paraBirimi?: string;
  degerler: Record<string, number | null>;
}
export interface CurrencyValue { paraBirimi: string; deger: number | null }
export interface SemanticTotals {
  degerler: Record<string, number | null>;
  paraBirimleri?: CurrencyValue[];
  donemler?: Array<{ donem: string | null; degerler: Record<string, number | null> }>;
}
export interface SemanticResult {
  kosuId: string | null;
  kup: { kimlik: string; ad: string };
  olculer: Array<{ kimlik: string; ad: string; aciklama: string; birim: string; iyiYon: string }>;
  boyutlar: Array<{ kimlik: string; ad: string; kisiAdi?: true }>;
  aralik: { dateFrom: string; dateTo: string };
  donemler: { birim: string; adet: number; anahtarlar: Array<string | null> } | null;
  satirlar: SemanticRow[];
  toplam: SemanticTotals;
  kiyas: { aralik: { dateFrom: string; dateTo: string }; toplam: SemanticTotals } | null;
  tavan: number;
  uyarilar: string[];
  notlar: string[];
  /** K-KISI: kişi adı taşıyan boyut varsa buluta gitmez. */
  kisiAdi: boolean;
  onbellek: { isabet: boolean };
}

export interface RawRow { kind: "row" | "total"; per: string | null; [col: string]: unknown }

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function measureValues(q: CompiledQuery, raw: RawRow): Record<string, number | null> {
  const sums = sumColumns(q.cube, q.measures);
  const col = (id: string | undefined): number | null => {
    const j = sums.findIndex((m) => m.id === id);
    return j >= 0 ? numberOrNull(raw[`s${j}`]) : null;
  };
  const out: Record<string, number | null> = {};
  for (const m of q.measures) {
    if (m.kind === "sum") out[m.id] = col(m.id);
    else if (m.kind === "ratio") {
      const num = col(m.numerator);
      const den = col(m.denominator);
      // Oran YENİDEN hesaplanır; payda 0/yoksa "ölçülemedi" (null), 0'a çökmez.
      out[m.id] = num === null || den === null || den === 0 ? null : (num / den) * (m.percent ? 100 : 1);
    }
  }
  return out;
}

/** Boş küme: toplam ölçü 0'dır (hiç sevk yok = 0 metre), oran ölçülemez (null). */
function emptySetTotals(q: CompiledQuery): Record<string, number | null> {
  return Object.fromEntries(q.measures.map((m) => [m.id, m.kind === "sum" ? 0 : null]));
}

export function shapeSqlRows(q: CompiledQuery, rawRows: RawRow[]): { satirlar: SemanticRow[]; toplam: SemanticTotals; truncated: boolean } {
  const shaped: SemanticRow[] = [];
  const totals: RawRow[] = [];
  for (const r of rawRows) {
    if (r.kind === "total") {
      totals.push(r);
      continue;
    }
    const anahtarlar: Record<string, SemanticCell> = {};
    q.dimensions.forEach((d, i) => {
      const other = r[`o${i}`] === true;
      anahtarlar[d.id] = other
        ? { deger: null, etiket: "Diğer", diger: true }
        : { deger: (r[`k${i}`] as string | null) ?? null, etiket: (r[`l${i}`] as string | null) ?? null };
    });
    shaped.push({ anahtarlar, ...(q.period ? { donem: r.per } : {}), degerler: measureValues(q, r) });
  }
  const truncated = shaped.length > REPORT_MAX_ROWS;
  const empty = Object.fromEntries(q.measures.map((m) => [m.id, null]));
  const totalsOut: SemanticTotals = q.period
    ? {
        degerler: empty,
        donemler: totals.map((t) => ({ donem: t.per, degerler: measureValues(q, t) })),
      }
    : { degerler: totals[0] ? measureValues(q, totals[0]) : emptySetTotals(q) };
  return { satirlar: truncated ? shaped.slice(0, REPORT_MAX_ROWS) : shaped, toplam: totalsOut, truncated };
}

export function shapeHelper(q: CompiledQuery, h: HelperResult): { satirlar: SemanticRow[]; toplam: SemanticTotals } {
  const id = q.measures[0]!.id;
  const shapedRows = h.rows.map((r) => ({
    anahtarlar: Object.fromEntries(
      Object.entries(r.keys).map(([k, v]) => [k, v.other ? { deger: null, etiket: "Diğer", diger: true as const } : { deger: v.value, etiket: v.label }]),
    ),
    ...(r.currency ? { paraBirimi: r.currency } : {}),
    degerler: { [id]: r.value },
  }));
  const perCurrency = q.measures[0]!.helper!.perCurrency;
  return {
    satirlar: shapedRows,
    toplam: perCurrency
      ? { degerler: { [id]: null }, paraBirimleri: h.totals.map((t) => ({ paraBirimi: t.currency ?? "", deger: t.value })) }
      : { degerler: { [id]: h.totals[0]?.value ?? null } },
  };
}

