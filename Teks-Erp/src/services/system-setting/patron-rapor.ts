// =============================================================================
// Patron uygulaması rapor koşumu ayarları (V5a, 2026-11-13) — işletme ayarı, davranış bayrağı değil
// =============================================================================
// Ham `PUT /api/admin/settings/:key` ile yazılır (ayar şifreli). Aralık dışı ya da sayı olmayan değer
// VARSAYILANA düşer: sıfır tavan raporu kapatır, sınırsız tavan tek süreci yorar.
// Varsayılanlar ajan seçimidir (kullanıcıya sorulacak — arşiv 2026-11 "V5a").
// =============================================================================
import prisma from "../../lib/prisma";
import { asNumber } from "./core";
import { SETTING_KEYS } from "./keys";

export interface PatronReportLimits {
  /** Kullanıcı başına son 60 dakikadaki koşum tavanı. */
  readonly hourlyMax: number;
  /** Kullanıcı başına rapor başına saklanan görünür koşum sayısı. */
  readonly keepCount: number;
  /** Bu günden eski koşum budanır. */
  readonly keepDays: number;
}

const BOUNDS = {
  hourlyMax: { key: SETTING_KEYS.PATRON_REPORT_HOURLY_MAX, min: 1, max: 1000, def: 60 },
  keepCount: { key: SETTING_KEYS.PATRON_REPORT_KEEP_COUNT, min: 1, max: 200, def: 20 },
  keepDays: { key: SETTING_KEYS.PATRON_REPORT_KEEP_DAYS, min: 1, max: 3650, def: 90 },
} as const;

export const DEFAULT_PATRON_REPORT_LIMITS: PatronReportLimits = {
  hourlyMax: BOUNDS.hourlyMax.def, keepCount: BOUNDS.keepCount.def, keepDays: BOUNDS.keepDays.def,
};

/** Üç ayarı tek sorguda okur; her biri kendi aralığında doğrulanır. */
export async function readPatronReportLimits(): Promise<PatronReportLimits> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(BOUNDS).map((b) => b.key) } },
    select: { key: true, value: true },
  });
  const pick = (b: (typeof BOUNDS)[keyof typeof BOUNDS]): number => {
    const v = asNumber(rows.find((r) => r.key === b.key)?.value);
    return v !== null && Number.isInteger(v) && v >= b.min && v <= b.max ? v : b.def;
  };
  return { hourlyMax: pick(BOUNDS.hourlyMax), keepCount: pick(BOUNDS.keepCount), keepDays: pick(BOUNDS.keepDays) };
}
