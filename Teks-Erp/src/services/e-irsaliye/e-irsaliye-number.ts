// =============================================================================
// e-İRSALİYE NUMARASI — üreteç giriş noktası (E2-SERI, 2026-10-24)
// =============================================================================
// GİB biçimi `EIR` + YYYY + 9 hane; biçim kapısı `series-fixed-shape.helper`.
// E5 motoru numarayı TASLAK→OLUSTURULDU claim tx'inde, belge tarihinin FABRİKA
// günüyle çağırır (yıl segmenti fabrika diliminden çözülür).
//
// ⚠️ BOŞLUKSUZLUK E5'İN İŞİ: üreteç max+1 verir; eşzamanlı iki üretim aynı
// numarayı görür ve `documentNo @unique` 409 verir. E5 seriyi kilitlemeli.
//
// ⚠️ YÜKLEYİCİ TEK: üretim ve başlangıç kilidi ("bu yıl numara üretildi mi")
// AYNI yükleyiciden okur: `e_irsaliyeler.documentNo` (E1-SEMA). E5 claim tx'inde
// `eIrsaliyeCodeLoader(tx)` ile çağırır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { seriesPrefix, type NumberSeriesFormat } from "../helpers/series-format.helper";
import {
  nextSeriesNo,
  resolveSeriesFormat,
  seriesUsedMaxFrom,
  type SeriesCodeRow,
} from "../number-series.service";

export const E_IRSALIYE_SERIES_KEY = "eIrsaliye";

export type EIrsaliyeCodeLoader = (fullPrefix: string, fmt: NumberSeriesFormat) => Promise<SeriesCodeRow[]>;

type EIrsaliyeReader = Pick<Prisma.TransactionClient, "eIrsaliye">;

/** Ön ekle başlayan numaralı kayıtlar — gte (index seek) + startsWith (collation-bağımsız). */
export function eIrsaliyeCodeLoader(db: EIrsaliyeReader): EIrsaliyeCodeLoader {
  return async (fullPrefix) => {
    const rows = await db.eIrsaliye.findMany({
      where: { documentNo: { gte: fullPrefix, startsWith: fullPrefix } },
      select: { documentNo: true, createdAt: true },
    });
    return rows.map((r) => ({ code: r.documentNo, createdAt: r.createdAt }));
  };
}

export const loadEIrsaliyeCodes: EIrsaliyeCodeLoader = eIrsaliyeCodeLoader(prisma);

/** Sıradaki GİB numarası — `issueDate` belge tarihi; yıl fabrika gününden. */
export async function nextEIrsaliyeDocumentNo(
  issueDate: Date,
  loadCodes: EIrsaliyeCodeLoader = loadEIrsaliyeCodes,
): Promise<string> {
  return nextSeriesNo(E_IRSALIYE_SERIES_KEY, loadCodes, issueDate);
}

/** Başlangıç kilidinin sorusu: `at`ın fabrika yılında bu seriden numara üretildi mi? */
export async function eIrsaliyeYearHasNumbers(
  at: Date,
  loadCodes: EIrsaliyeCodeLoader = loadEIrsaliyeCodes,
): Promise<boolean> {
  const fmt = resolveSeriesFormat(E_IRSALIYE_SERIES_KEY);
  const fullPrefix = seriesPrefix(fmt, at);
  return seriesUsedMaxFrom(fmt, await loadCodes(fullPrefix, fmt), fullPrefix) > 0;
}
