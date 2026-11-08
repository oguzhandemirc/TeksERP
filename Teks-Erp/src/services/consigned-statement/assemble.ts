// =============================================================================
// EMANET EKSTRESİ — saf montaj: açılış bakiyeleri + dönem olayları → konu/toplam/satır
// =============================================================================
// As-of: açılış = `fromAt` öncesi defter toplamı (okuyucu DB'de toplar); satırlar [fromAt, toAt] olaylarıdır.
// Storno kendi anında ayrı satırdır; geçmiş dönem yeni kayıtla değişmez (defter-öncelikli).
// =============================================================================
import { Prisma } from "@prisma/client";
import { factoryYmd } from "../../constants/time";
import type {
  LedgerEvent, OpeningBalance, StatementColumn, StatementKind, StatementLine, StatementSection, StatementSubject, StatementTotals, SubjectLabel,
} from "./types";

const ZERO = new Prisma.Decimal(0);
const num = (d: Prisma.Decimal): number => Number(d.toFixed(3));

interface Acc {
  opening: Prisma.Decimal;
  in: Prisma.Decimal;
  out: Prisma.Decimal;
  dsk: Prisma.Decimal;
  scrap: Prisma.Decimal;
}
const emptyAcc = (): Acc => ({ opening: ZERO, in: ZERO, out: ZERO, dsk: ZERO, scrap: ZERO });
const COLUMN_KEY: Record<StatementColumn, "in" | "out" | "dsk" | "scrap"> = { IN: "in", OUT: "out", DSK: "dsk", SCRAP: "scrap" };

/** Satırın kolon katkısı: giren kolonu kalana etkinin kendisi, çıkış kolonları etkinin tersi (çıkan pozitif yazılır). */
export function columnQty(column: StatementColumn, effect: Prisma.Decimal): Prisma.Decimal {
  return column === "IN" ? effect : effect.negated();
}

const closingOf = (a: Acc): Prisma.Decimal => a.opening.plus(a.in).minus(a.out).minus(a.dsk).minus(a.scrap);
const totalsOf = (a: Acc): StatementTotals => ({
  opening: num(a.opening), in: num(a.in), out: num(a.out), dsk: num(a.dsk), scrap: num(a.scrap), closing: num(closingOf(a)),
});

/** Olay sırası — an, eşitlikte kimlik (belirlenimli; defter okuyucularının ortak kuralı). */
export function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  const t = a.at.getTime() - b.at.getTime();
  return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface SectionMeta {
  kind: StatementKind;
  unit: "m" | "kg";
  scope: string;
  columnLabels: Record<StatementColumn, string>;
}

export interface SectionInput {
  /** `fromAt` öncesi konu bakiyeleri (sıfırlar dahil olabilir — süzülür). */
  opening: readonly OpeningBalance[];
  /** Yalnız [fromAt, toAt] olayları. */
  events: readonly LedgerEvent[];
  /** Açılışı olup dönemde olayı olmayan konuların etiketleri. */
  labels: ReadonlyMap<string, SubjectLabel>;
}

export function assembleSection(meta: SectionMeta, input: SectionInput): StatementSection {
  const bySubject = new Map<string, { acc: Acc; label: string | null; itemName: string | null }>();
  const total = emptyAcc();
  const subjectOf = (id: string, fallback?: SubjectLabel) => {
    let s = bySubject.get(id);
    if (!s) {
      const l = input.labels.get(id) ?? fallback ?? { label: null, itemName: null };
      s = { acc: emptyAcc(), label: l.label, itemName: l.itemName };
      bySubject.set(id, s);
    }
    return s;
  };
  for (const o of input.opening) {
    if (o.qty.isZero()) continue;
    const s = subjectOf(o.subjectId);
    s.acc.opening = s.acc.opening.plus(o.qty);
    total.opening = total.opening.plus(o.qty);
  }
  const lines: StatementLine[] = [];
  for (const e of [...input.events].sort(compareEvents)) {
    const s = subjectOf(e.subjectId, { label: e.subjectLabel, itemName: e.itemName });
    const key = COLUMN_KEY[e.column];
    const q = columnQty(e.column, e.effect);
    s.acc[key] = s.acc[key].plus(q);
    total[key] = total[key].plus(q);
    lines.push({
      at: e.at.toISOString(),
      day: factoryYmd(e.at),
      subjectId: e.subjectId,
      subjectLabel: e.subjectLabel,
      column: e.column,
      qty: num(q),
      effect: num(e.effect),
      reversal: e.reversal,
      code: e.code,
      document: e.document,
    });
  }
  // Konu: açılışı sıfırdan farklı ya da dönemde hareketi olan (geçmişte gelip gitmiş top ekstreye girmez).
  const subjects: StatementSubject[] = [...bySubject].map(([id, s]) => ({ id, label: s.label, itemName: s.itemName, ...totalsOf(s.acc) }));
  subjects.sort((a, b) => (a.label ?? "￿").localeCompare(b.label ?? "￿", "tr") || (a.id < b.id ? -1 : 1));
  return { ...meta, totals: totalsOf(total), subjects, lines };
}

/** Konu başına işaretli toplamları birleştirir (aynı konu birden çok gruptan gelebilir). */
export function mergeOpening(parts: ReadonlyArray<{ subjectId: string; qty: Prisma.Decimal }>): OpeningBalance[] {
  const m = new Map<string, Prisma.Decimal>();
  for (const p of parts) m.set(p.subjectId, (m.get(p.subjectId) ?? ZERO).plus(p.qty));
  return [...m].map(([subjectId, qty]) => ({ subjectId, qty }));
}
