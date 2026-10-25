// =============================================================================
// Sabit biçimli serilerin ÜRETECE bağlı parçaları: "bu yıl numara üretildi mi" yükleyicisi
// ve üretim kilidi. Başlangıç değeri yazımı üretimle AYNI kilitte serileşir (E5, uzay 8041);
// kilit altında kök istemciden okuma doğrudur (üretenler ya commit etti ya beklemede).
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { eIrsaliyeYearHasNumbers, lockEIrsaliyeSeriesTx } from "../e-irsaliye/e-irsaliye-number";

/**
 * Sabit biçimli serinin "bu yıl numara üretildi mi" sorusu — üretecin yükleyicisi.
 * Eksik anahtar kilidi AÇMAZ (fail-closed, bekçi `test_number_series §15`).
 */
export const FIXED_SHAPE_YEAR_USAGE: Readonly<Record<string, (at: Date) => Promise<boolean>>> = {
  eIrsaliye: (at) => eIrsaliyeYearHasNumbers(at),
};

const FIXED_SHAPE_SERIES_LOCK: Readonly<Record<string, (tx: Prisma.TransactionClient) => Promise<void>>> = {
  eIrsaliye: lockEIrsaliyeSeriesTx,
};

/** Sayaç yazımı tx'i; sabit biçimli seride İLK ifade üretim kilididir. */
export function withSeriesStartLock<T>(key: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const lock = FIXED_SHAPE_SERIES_LOCK[key];
    if (lock) await lock(tx);
    return fn(tx);
  });
}
