// =============================================================================
// Temel raporlar — fabrika GÜNÜ aralıklı uçların ortak sorgu teli (katalog `tarih:"aralik-gun"`)
// =============================================================================
// Dokuma kaynakları (`efficiencyReport`, `durusParetoReport`, levent/kapasite) `YYYY-MM-DD` fabrika
// günü alır; panel bu sözleşmede `from`/`to` yollar (`rangeDayParams`). Kıyas kipi `coreRangeQuerySchema`
// ile AYNI kümeden (K-TEL: tel anahtarı `kiyas`); kıyas günleri ana aralığın anlarından türetilir.

import { z } from "zod";
import { factoryYmd, resolveRangeEnd, resolveRangeStart } from "../../../constants/time";
import { AppError } from "../../../utils/app-error";
import { resolveCompareRange, type CompareMode, type DateRange } from "../_shared";
import { coreRangeQuerySchema } from "./_common";
import type { ParametreBeyani } from "../sunum/sunum.types";

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Geçersiz gün (YYYY-MM-DD)");
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

/** `from`/`to` fabrika günü + `kiyas` (kip kümesi ISO telinden — iki tel ayrışamaz). */
export const coreDayRangeQuerySchema = z
  .object({ from: YMD.optional(), to: YMD.optional(), kiyas: coreRangeQuerySchema.shape.kiyas })
  .strict();
export type CoreDayRangeQuery = z.infer<typeof coreDayRangeQuerySchema>;

export interface DayWindow {
  from: string;
  to: string;
}

export interface ResolvedDayRange {
  days: DayWindow;
  range: DateRange;
  mode: CompareMode;
  compareDays: DayWindow | null;
  compareRange: DateRange | null;
}

const windowOf = (days: DayWindow): DateRange => ({ from: resolveRangeStart(days.from), to: resolveRangeEnd(days.to) });

/**
 * Gün aralığı + kıyas (K-KIYAS: `kiyas` yoksa önceki dönem). Tek uç verilirse 400 — eksik ucu
 * sessizce doldurmak kullanıcının seçmediği pencereyi kurardı. Hiçbiri yoksa son `defaultDays` gün.
 */
export function resolveCoreDayRange(input: CoreDayRangeQuery, defaultDays: number, now: Date = new Date()): ResolvedDayRange {
  if (Boolean(input.from) !== Boolean(input.to)) throw AppError.badRequest("Gün aralığı için from ve to birlikte gönderilmelidir");
  const days: DayWindow = input.from && input.to
    ? { from: input.from, to: input.to }
    : { from: factoryYmd(new Date(now.getTime() - (defaultDays - 1) * DAY_MS)), to: factoryYmd(now) };
  if (days.to < days.from) throw AppError.badRequest("Bitiş günü başlangıçtan önce olamaz");
  const range = windowOf(days);
  if (range.to.getTime() - range.from.getTime() > MAX_DAYS * DAY_MS) throw AppError.badRequest(`Tarih aralığı en fazla ${MAX_DAYS} gün olabilir`);
  const mode: CompareMode = input.kiyas ?? "prev";
  const cmp = resolveCompareRange({ compare: mode }, range);
  const compareDays = cmp ? { from: factoryYmd(cmp.from), to: factoryYmd(cmp.to) } : null;
  return { days, range, mode, compareDays, compareRange: compareDays ? windowOf(compareDays) : null };
}

const COMPARE_OPTIONS = [
  { deger: "none", etiket: "Kıyas yok" },
  { deger: "prev", etiket: "Önceki dönem" },
  { deger: "prevYear", etiket: "Geçen yıl aynı dönem" },
];

/** Gün aralığı + kıyas beyanı (K-KIYAS: `deger` UYGULANAN kip, `secenekler` hepsi). */
export function dayRangeParameters(days: DayWindow, mode: CompareMode): ParametreBeyani[] {
  return [
    { ad: "from", etiket: "Başlangıç", tur: "tarih", deger: days.from },
    { ad: "to", etiket: "Bitiş", tur: "tarih", deger: days.to },
    { ad: "kiyas", etiket: "Kıyas", tur: "secim", deger: mode, secenekler: COMPARE_OPTIONS },
  ];
}
