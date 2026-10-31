// ANLIK `ozet-masraf` (D4-H2; DALGA4 §9.8, kullanıcı kararı S15 a): son 12 fabrika ayı × ilk 15 kategori + "Diğer".
// TOPLAMA FABRİKADA: tek kaynak `getExpenseSummary` (kasa defterinin EXPENSE evreni); "Diğer", ay toplamları,
// geçen aya göre fark ve bu ayki pay burada hesaplanır — bulut ve uygulama aritmetik yapmaz (`test_bulut_masraf_ozeti`).
// Tel yalnız kategori METNİ + tutar taşır: kasa satırı, açıklama, belge no, kişi buluta GİTMEZ (katı şema).
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getExpenseSummary, type ExpenseSummaryCategory } from "../services/helpers/expense-summary.helper";
import { factoryYmd } from "../constants/time";
import { factoryMonthStart } from "./periods";

export const EXPENSE_SNAPSHOT = "ozet-masraf";
/** Adıyla gösterilen kategori sayısı; kalanlar tek "Diğer" satırında toplanır. */
export const EXPENSE_TOP_CATEGORIES = 15;
export const EXPENSE_MONTHS = 12;
export const EXPENSE_OTHER_LABEL = "Diğer";

const NumStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const Month = z.string().regex(/^\d{4}-\d{2}$/);
const MonthCell = z.strictObject({ ay: Month, tutar: NumStr });

/** Katı tel şeması — tanımadığı anahtar (ör. ham satır, açıklama) varsa kurucu FIRLATIR. */
export const EXPENSE_SNAPSHOT_SCHEMA = z.strictObject({
  aylar: z.array(Month),
  buAy: Month,
  gecenAy: Month,
  toplam: NumStr,
  buAyToplam: NumStr,
  gecenAyToplam: NumStr,
  fark: NumStr,
  aylikToplam: z.array(MonthCell),
  kategoriler: z.array(z.strictObject({
    etiket: z.string(),
    digerMi: z.boolean(),
    /** "Diğer" satırında içindeki kategori sayısı; adıyla gelen satırda 1. */
    kategoriSayisi: z.number().int(),
    toplam: NumStr,
    buAy: NumStr,
    gecenAy: NumStr,
    fark: NumStr,
    /** Bu ayki masraf içindeki pay, yüzde (0–100, tek ondalık); çubuk genişliği bundan çizilir. */
    buAyPay: z.number(),
    aylik: z.array(MonthCell),
  })).max(EXPENSE_TOP_CATEGORIES + 1),
});

const D = (v: string | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = (): Prisma.Decimal => new Prisma.Decimal(0);

function monthAmount(c: ExpenseSummaryCategory, month: string): Prisma.Decimal {
  const cell = c.cells.find((x) => x.month === month);
  return cell ? D(cell.amountTry) : ZERO();
}

function share(part: Prisma.Decimal, whole: Prisma.Decimal): number {
  if (whole.lte(0) || part.lte(0)) return 0;
  const pct = part.div(whole).mul(100);
  return pct.gte(100) ? 100 : Number(pct.toFixed(1));
}

/** Ham (henüz mühürlenmemiş) veri — `snapshots.ts` `seal` ile katı şemadan geçirir. */
export async function buildExpenseSnapshotData(now: Date): Promise<z.input<typeof EXPENSE_SNAPSHOT_SCHEMA>> {
  const from = factoryMonthStart(now, -(EXPENSE_MONTHS - 1));
  const summary = await getExpenseSummary({ range: { from, to: now } });
  const months = summary.months;
  const thisMonth = factoryYmd(now).slice(0, 7);
  const lastMonth = factoryYmd(factoryMonthStart(now, -1)).slice(0, 7);
  const monthTotal = (m: string): Prisma.Decimal => D(summary.monthTotals.find((x) => x.month === m)?.amountTry ?? "0");
  const thisTotal = monthTotal(thisMonth);

  const row = (label: string, isOther: boolean, group: readonly ExpenseSummaryCategory[]) => {
    const perMonth = months.map((m) => ({ ay: m, tutar: group.reduce((s, c) => s.plus(monthAmount(c, m)), ZERO()) }));
    const cur = perMonth.find((x) => x.ay === thisMonth)?.tutar ?? ZERO();
    const prev = perMonth.find((x) => x.ay === lastMonth)?.tutar ?? ZERO();
    return {
      etiket: label,
      digerMi: isOther,
      kategoriSayisi: group.length,
      toplam: group.reduce((s, c) => s.plus(D(c.totalTry)), ZERO()).toFixed(2),
      buAy: cur.toFixed(2),
      gecenAy: prev.toFixed(2),
      fark: cur.minus(prev).toFixed(2),
      buAyPay: share(cur, thisTotal),
      aylik: perMonth.map((x) => ({ ay: x.ay, tutar: x.tutar.toFixed(2) })),
    };
  };

  // Sıra helper'ındır (12 aylık net TL azalan, eşitlikte anahtar); burada yeniden sıralanmaz.
  const named = summary.categories.slice(0, EXPENSE_TOP_CATEGORIES);
  const rest = summary.categories.slice(EXPENSE_TOP_CATEGORIES);
  const kategoriler = named.map((c) => row(c.label, false, [c]));
  if (rest.length > 0) kategoriler.push(row(EXPENSE_OTHER_LABEL, true, rest));

  return {
    aylar: months,
    buAy: thisMonth,
    gecenAy: lastMonth,
    toplam: summary.totalTry,
    buAyToplam: thisTotal.toFixed(2),
    gecenAyToplam: monthTotal(lastMonth).toFixed(2),
    fark: thisTotal.minus(monthTotal(lastMonth)).toFixed(2),
    aylikToplam: summary.monthTotals.map((m) => ({ ay: m.month, tutar: m.amountTry })),
    kategoriler,
  };
}
