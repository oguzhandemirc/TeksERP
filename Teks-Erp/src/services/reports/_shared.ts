// =============================================================================
// TeksERP - Reports / Shared Helpers
// =============================================================================
// Rapor servisleri için ortak: tarih aralığı parse + guard, response zarf
// formatı, küçük yardımcılar. Sorgu kuralları: tarih indeksli kolonlar
// üzerinden filtreleme, JS-tarafı groupBy yok (her zaman Prisma aggregate /
// raw SQL), liste detayları için cursor pagination.
// =============================================================================

import { z } from "zod";
import { AppError } from "../../utils/app-error";

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_MS = 366 * DAY_MS;

export const dateRangeSchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

export interface DateRange {
  from: Date;
  to: Date;
}

/** Boş gelirse son 30 gün uygula; aralık > 366 gün ise 400. */
export function resolveDateRange(input: DateRangeInput): DateRange {
  const now = new Date();
  const from = input.dateFrom
    ? new Date(input.dateFrom)
    : new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  const to = input.dateTo ? new Date(input.dateTo) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppError.badRequest("Geçersiz tarih formatı");
  }
  if (from > to) {
    throw AppError.badRequest("Başlangıç tarihi bitiş tarihinden büyük olamaz");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw AppError.badRequest("Tarih aralığı en fazla 366 gün olabilir");
  }
  return { from, to };
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: { from: string; to: string };
}

export function reportEnvelope<T>(data: T, range: DateRange): ReportResponse<T> {
  return {
    success: true,
    data,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}

/** Bucketed seri için günleri tek tek dolduran yardımcı. */
export function* eachDay(range: DateRange): Generator<Date> {
  const start = new Date(range.from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setHours(0, 0, 0, 0);
  const cur = new Date(start);
  while (cur <= end) {
    yield new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
}

/** YYYY-MM-DD (local). Chart kategorisi olarak kullanılır. */
export function ymdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
