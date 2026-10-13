// =============================================================================
// SAYAÇ SATIRLI SERİ — numara yazma tx'inden ÖNCE atomik rezervasyon (Perf-4 B-03)
// =============================================================================
// Tarama tabanlı üreteç (`nextSeriesNo`) "max + 1"i tx içinde, 8029 kilidi altında
// hesaplar; kilit COMMIT'e kadar tutulur ve aynı günün bütün kayıtları sıraya dizilir
// (doff-50: p95 484 ms, tek başına 12 ms). Burada sıra `number_series_counters`
// satırından TEK ifadeyle alınır ve ifade biter bitmez commit olur: kilit yalnız o
// UPDATE kadar sürer. Bedel: tx geri dönerse numara boşta kalır — boşluk serbesttir,
// tekillik hedef kolonun `@unique`indedir (`numaralandirma.md`, sayaç satırlı seri).
//
// ⚠️ TX İÇİNDE ÇAĞIRMA: tx'e bağlanırsa satır kilidi yine COMMIT'e kadar tutulur ve
// kazanç sıfırlanır (`test_perf_sayac_tx_disi` bu helper'ı da sayar).
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import {
  renderSeq,
  resolveSeriesFormat,
  seriesPrefix,
  scopedNextSeq,
  SKIP_LIMIT,
  type NumberSeriesFormat,
  type SeriesCodeRow,
} from "../number-series.service";
import { nextCounterSeq, seriesCounterReadsLastBorn } from "./series-counter.helper";

type Loader = (fullPrefix: string, fmt: NumberSeriesFormat) => Promise<Array<SeriesCodeRow>>;

/**
 * Sayaç satırının KAPSAMI — tam ön ek + biçim ve sayaç ayarlarının parmak izi.
 * Biçim (`formatChangedAt`, hane) ya da sayaç ayarı (başlangıç · adım · sınır · sarma)
 * değişince yeni satır doğar ve mevcut kodlardan yeniden tohumlanır; eski satırın
 * değeri yeni kurallara göre hizasız olurdu (adım 1 → 10: 13 + 10 = 23, dizinin dışı).
 */
export function counterScopeKey(fmt: NumberSeriesFormat, fullPrefix: string): string {
  return [
    fullPrefix,
    fmt.formatChangedAt?.getTime() ?? 0,
    fmt.digits,
    fmt.startValue ?? "",
    fmt.step ?? "",
    fmt.maxValue ?? "",
    seriesCounterReadsLastBorn(fmt) ? "w" : "",
  ].join("|");
}

function wraps(fmt: NumberSeriesFormat): boolean {
  return seriesCounterReadsLastBorn(fmt) && fmt.maxValue != null;
}

/** Tek ifade: satırı adım kadar ilerletir (sarmalı seride sınırda başa döner). Satır yoksa `null`. */
async function bump(key: string, scopeKey: string, fmt: NumberSeriesFormat): Promise<number | null> {
  const step = fmt.step ?? 1;
  const rows = wraps(fmt)
    ? await prisma.$queryRaw<Array<{ n: number }>>`
        UPDATE "number_series_counters"
           SET "n" = CASE WHEN "n" + ${step} > ${fmt.maxValue!} THEN ${fmt.startValue ?? 1} ELSE "n" + ${step} END,
               "updatedAt" = now()
         WHERE "seriesKey" = ${key} AND "scopeKey" = ${scopeKey}
     RETURNING "n"`
    : await prisma.$queryRaw<Array<{ n: number }>>`
        UPDATE "number_series_counters" SET "n" = "n" + ${step}, "updatedAt" = now()
         WHERE "seriesKey" = ${key} AND "scopeKey" = ${scopeKey}
     RETURNING "n"`;
  return rows.length ? Number(rows[0]!.n) : null;
}

/**
 * Sıradaki sıra. Hızlı yol tek UPDATE; satır yoksa (gün/kapsam başı) mevcut kodlar
 * taranır (bugünkü hesap: kapsam damgası + atlama) ve `ON CONFLICT DO NOTHING` ile
 * tohumlanır — eşzamanlı tohumlayanlardan biri kazanır, kalanlar onun üstünden ilerler.
 */
interface Scope { key: string; fmt: NumberSeriesFormat; fullPrefix: string; scopeKey: string }

async function takeSeq({ key, fmt, fullPrefix, scopeKey }: Scope, loadCodes: Loader): Promise<number> {
  let n = await bump(key, scopeKey, fmt);
  if (n === null) {
    const seed = scopedNextSeq(key, fmt, fullPrefix, await loadCodes(fullPrefix, fmt));
    const won = await prisma.$queryRaw<Array<{ n: number }>>`
      INSERT INTO "number_series_counters" ("id", "seriesKey", "scopeKey", "n", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${key}, ${scopeKey}, ${seed}, now(), now())
      ON CONFLICT ("seriesKey", "scopeKey") DO NOTHING
      RETURNING "n"`;
    if (won.length) return seed;
    n = await bump(key, scopeKey, fmt);
    if (n === null) throw new Error(`"${key}" sayaç satırı tohumlandıktan sonra bulunamadı`);
  }
  if (wraps(fmt)) return n;
  // Üst sınır ve hata metni TEK çekirdekten: hizalı `n` için `nextCounterSeq(n - adım)` = n.
  return nextCounterSeq(fmt, n - (fmt.step ?? 1), key);
}

/**
 * Sıradaki numarayı REZERVE eder — tx AÇILMADAN ÖNCE, taban `prisma` ile.
 * `exists` yalnız biçim değişmiş seride (`formatChangedAt`) koşar: kapsam daraltması
 * eski rejimin kodlarıyla çakışan bir sıra verebilir; tarama yolunun atlama
 * döngüsünün karşılığıdır (sarmalı seride atlama yok — `scopedNextSeq` ile aynı).
 */
export async function reserveSeriesNo(
  key: string,
  date: Date,
  loadCodes: Loader,
  exists: (code: string) => Promise<boolean>,
): Promise<string> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  const scopeKey = counterScopeKey(fmt, fullPrefix);
  const skip = fmt.formatChangedAt != null && !seriesCounterReadsLastBorn(fmt);
  for (let deneme = 0; ; deneme++) {
    const code = renderSeq(fmt, fullPrefix, await takeSeq({ key, fmt, fullPrefix, scopeKey }, loadCodes));
    if (!skip || !(await exists(code))) return code;
    if (deneme + 1 >= SKIP_LIMIT) {
      throw AppError.conflict(
        `"${key}" serisinde sıradaki numara bulunamadı: ${SKIP_LIMIT} ardışık kod dolu. Numara biçimi ayarını kontrol edin.`,
        { code: "NUMBER_SERIES_SEQUENCE_EXHAUSTED", key },
      );
    }
  }
}

/**
 * ÖNİZLEME — sayaç satırı varsa sıradaki kod (tüketmeden), yoksa `null` (çağıran
 * tarama hesabına düşer). Boşluk sonrası tarama sayacın gerisinde kalır; panelin
 * "sıradaki numara"sı üreteçle aynı kaynaktan okunmalı.
 */
export async function peekSeriesCounter(key: string, fmt: NumberSeriesFormat, date: Date): Promise<string | null> {
  const fullPrefix = seriesPrefix(fmt, date);
  const row = await prisma.numberSeriesCounter.findUnique({
    where: { seriesKey_scopeKey: { seriesKey: key, scopeKey: counterScopeKey(fmt, fullPrefix) } },
    select: { n: true },
  });
  if (!row) return null;
  const step = fmt.step ?? 1;
  const next = wraps(fmt) && row.n + step > fmt.maxValue! ? (fmt.startValue ?? 1) : row.n + step;
  if (!wraps(fmt) && fmt.maxValue != null && next > fmt.maxValue) return null;
  return renderSeq(fmt, fullPrefix, next);
}
