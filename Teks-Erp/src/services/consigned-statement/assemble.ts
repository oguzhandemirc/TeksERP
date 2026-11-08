// =============================================================================
// EMANET EKSTRESİ — saf montaj: olaylar → açılış / dönem satırları / kapanış
// =============================================================================
// As-of: açılış = `fromAt` öncesi olayların toplamı; satırlar [fromAt, toAt] (sorgu zaten ≤ toAt getirir).
// Storno kendi anında ayrı satırdır; geçmiş dönem yeni kayıtla değişmez (defter-öncelikli).
// =============================================================================
import { Prisma } from "@prisma/client";
import { factoryYmd } from "../../constants/time";
import type { LedgerEvent, StatementColumn, StatementKind, StatementLine, StatementSection, StatementSubject, StatementTotals } from "./types";

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

export function assembleSection(
  meta: { kind: StatementKind; unit: "m" | "kg"; scope: string },
  events: readonly LedgerEvent[],
  fromAt: Date,
): StatementSection {
  const { kind, unit, scope } = meta;
  const sorted = [...events].sort(compareEvents);
  const bySubject = new Map<string, { acc: Acc; label: string | null; itemName: string | null; touched: boolean }>();
  const total = emptyAcc();
  const lines: StatementLine[] = [];
  for (const e of sorted) {
    let s = bySubject.get(e.subjectId);
    if (!s) {
      s = { acc: emptyAcc(), label: e.subjectLabel, itemName: e.itemName, touched: false };
      bySubject.set(e.subjectId, s);
    }
    if (e.at < fromAt) {
      s.acc.opening = s.acc.opening.plus(e.effect);
      total.opening = total.opening.plus(e.effect);
      continue;
    }
    const key = COLUMN_KEY[e.column];
    const q = columnQty(e.column, e.effect);
    s.acc[key] = s.acc[key].plus(q);
    total[key] = total[key].plus(q);
    s.touched = true;
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
  const subjects: StatementSubject[] = [];
  for (const [id, s] of bySubject) {
    // Dönemde hareketi olmayan ve açılışı sıfır konu ekstreye girmez (geçmişte gelip gitmiş top).
    if (!s.touched && s.acc.opening.isZero()) continue;
    subjects.push({ id, label: s.label, itemName: s.itemName, ...totalsOf(s.acc) });
  }
  subjects.sort((a, b) => (a.label ?? "￿").localeCompare(b.label ?? "￿", "tr") || (a.id < b.id ? -1 : 1));
  return { kind, unit, scope, totals: totalsOf(total), subjects, lines };
}
