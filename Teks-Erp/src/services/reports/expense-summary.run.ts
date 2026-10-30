// Masraf özeti koşucusu (D4-H1) — varyant/dönem sarmalı (`runCoreWithExtras`) bunu çağırır.
// Ayrı dosya: `core-runs.ts` finans dışı router'larca da yüklenir (rejim kapısı bekçisi).
import type { Currency } from "@prisma/client";
import { getExpenseSummary, type ExpenseSummary } from "../helpers/expense-summary.helper";
import { buildExpenseSummarySunumu, currencyName } from "./expense-summary.sunum";
import { dayWindowOf } from "./temel/core-runs";
import type { ResolvedDayRange } from "./temel/_day-range";
import type { CoreRunner } from "./temel/_variant";

/**
 * Masraf özeti: hücre = masrafın ASIL para birimiyle süzülmüş özet (tutar yine TL karşılığı). Havuz ana koşunun
 * para birimi kırılımından (TL azalan). `onMain` ilk (ana) koşunun özetini verir — uç `detay`ı ondan basar.
 */
export function expenseSummaryRunner(main: ResolvedDayRange, currency: Currency[] | undefined, onMain: (s: ExpenseSummary) => void): CoreRunner {
  let first = true;
  return async (range, compareRange, cell) => {
    const cur = cell?.boyut === "paraBirimi" ? [cell.deger as Currency] : currency;
    const summary = await getExpenseSummary({ range, currency: cur });
    const previous = compareRange ? await getExpenseSummary({ range: compareRange, currency: cur }) : null;
    if (first) { first = false; onMain(summary); }
    const window = range === main.range && compareRange === main.compareRange ? main : dayWindowOf(range, compareRange, main.mode);
    return {
      sunum: buildExpenseSummarySunumu(summary, window, previous, cur),
      kirilimlar: { paraBirimi: summary.currencies.map((c) => ({ deger: c.currency, etiket: currencyName(c.currency) })) },
    };
  };
}
