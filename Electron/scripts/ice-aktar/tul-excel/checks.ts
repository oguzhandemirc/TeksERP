// Altı hata sınıfının denetimleri (tasarım §9.5). Her bulgu sayfa + hücre + Excel değeri + öneri taşır.
import { nominalDenier, normalizeName, round, type NumberRead } from "./cells.ts";
import type { ReportRow, YarnRow } from "./types.ts";

export class ReportSink {
  readonly rows: ReportRow[] = [];
  add(row: ReportRow) {
    this.rows.push(row);
  }
}

const DENIER_DIVISOR = 9000;
/** ÷1000 tex için meşrudur; adında denye işareti olan iplikte ÷1000 birim hatasıdır. */
export const DENIER_MARK = /\b(DEN|DNY|DENYE|DNYE|DENİER)\b/i;

export function checkTextNumber(
  sink: ReportSink,
  p: { file: string; sheet: string; cell: string; read: NumberRead; inUse: boolean; field: string },
) {
  if (p.read.textual === null) return;
  sink.add({
    errorClass: "METIN_SAYI", file: p.file, sheet: p.sheet, cell: p.cell, inUse: p.inUse,
    excelValue: p.read.textual, suggested: p.read.value === null ? "" : String(p.read.value),
    note: `${p.field} sayı yerine metin`,
  });
}

/** Gramaj formülündeki bölen: ÷8000 her zaman, ÷1000 denyeli iplikte hatadır; öneri ÷9000 ile gramaj. */
export function checkUnitDivisor(sink: ReportSink, y: YarnRow, quantity: number | null) {
  const f = y.formula;
  if (!f) return;
  const isEight = f.divisor === 8000;
  const isThousand = f.divisor === 1000 && DENIER_MARK.test(y.yarnName);
  if (!isEight && !isThousand) return;
  const grams = quantity === null ? null : (quantity * (f.width ?? 1) * f.denier) / DENIER_DIVISOR;
  sink.add({
    errorClass: isEight ? "BIRIM_8000" : "BIRIM_1000", file: y.file, sheet: y.sheet, cell: y.gramCell, inUse: y.inUse,
    excelValue: `${f.denier}/${f.divisor}`,
    suggested: `${f.denier}/${DENIER_DIVISOR}` + (grams === null ? "" : ` → ${round(grams, 4)} g/m`),
    note: `${y.yarnName || "(adsız satır)"}: denye ${DENIER_DIVISOR}'e bölünür`,
  });
}

function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best ? best[0] : null;
}

/** Sayfa adındaki en ("350 CM" → 3,5 m); yoksa null. */
export function widthFromSheetName(name: string): number | null {
  const m = /(\d{3})\s*CM/i.exec(name);
  return m ? Number(m[1]) / 100 : null;
}

/** EN_TUTARSIZ: sayfa içinde en (m) referanstan (sayfa adı, yoksa çoğunluk) farklı satırlar. */
export function checkWidths(sink: ReportSink, sheet: string, rows: YarnRow[]) {
  const widths = rows.map((r) => r.formula?.width).filter((w): w is number => typeof w === "number");
  const reference = widthFromSheetName(sheet) ?? mode(widths);
  if (reference === null) return;
  for (const r of rows) {
    const w = r.formula?.width;
    if (typeof w !== "number" || w === reference) continue;
    sink.add({
      errorClass: "EN_TUTARSIZ", file: r.file, sheet: r.sheet, cell: r.gramCell, inUse: r.inUse,
      excelValue: String(w), suggested: String(reference),
      note: `${r.yarnName || "(adsız satır)"}: sayfanın eni ${reference} m, satır ${w} m`,
    });
  }
}

/**
 * SISIRME_FARKLI: aynı iplik (ad) farklı satırlarda farklı denyeyle hesaplanmış.
 * Öneri: nominal denye + fire yüzdesi f = 1 − d_nominal / d_excel (tasarım §4.5).
 */
export function checkInflation(sink: ReportSink, rows: YarnRow[]) {
  const groups = new Map<string, YarnRow[]>();
  for (const r of rows) {
    if (!r.formula || r.yarnName === "") continue;
    const key = normalizeName(r.yarnName);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const list of groups.values()) {
    const deniers = new Set(list.map((r) => (r.formula as { denier: number }).denier));
    if (deniers.size < 2) continue;
    const nominal = nominalDenier((list[0] as YarnRow).yarnName);
    const fallback = mode(list.map((r) => (r.formula as { denier: number }).denier));
    for (const r of list) {
      const d = (r.formula as { denier: number }).denier;
      const suggested = nominal !== null && d >= nominal
        ? `nominal ${nominal} den + fire %${round((1 - nominal / d) * 100, 2)}`
        : `${fallback} den (çoğunluk)`;
      sink.add({
        errorClass: "SISIRME_FARKLI", file: r.file, sheet: r.sheet, cell: r.gramCell, inUse: r.inUse,
        excelValue: `${d} den`, suggested,
        note: `${r.yarnName}: aynı iplik ${[...deniers].sort((a, b) => a - b).join("/")} den ile hesaplanmış`,
      });
    }
  }
}
