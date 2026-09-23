// =============================================================================
// NUMARA SERİSİ SERVİSİ — biçimin TEK sahibi (2026-09-22)
// =============================================================================
// Bu dosya `utils/code-format.ts`'teki saf biçimlendiricilerin TEK çağıranıdır
// (bekçi: `test_number_series_tek_kaynak`). Amaç iki cümlede:
//
//   ① Ön ek/tarih/hane artık VERİ — başka fabrika başka biçim ister ve müşteri
//      başına fork yasak.
//   ② Numara DOĞUŞTA materyalize edilir; sunum katmanı biçimi YENİDEN UYGULAMAZ.
//      "Programda P-2, çıktıda P20260202" ancak ② delinirse olur (kullanıcı
//      değişmezi 2026-09-22) — bu yüzden buradaki fonksiyonlar yalnız ÜRETİM
//      yolundan çağrılır, render'dan değil.
//
// Sayaç TÜRETİLMİŞTİR (bugünkü davranış, değişmedi): "aynı ön ek + tarih
// segmentiyle başlayan kodların SAYISAL max'ı + 1". Sıfırlama dönemi stringin
// İÇİNDE kodlu olduğu için `dateSegment` tek knob'tur — ayrı sayaç tablosu, yeni
// advisory uzayı ve "rollback'te boşluk kalır mı" sorusu YOKTUR.
// =============================================================================
import type { NumberSeries, Prisma } from "@prisma/client";

import {
  NUMBER_SERIES_CATALOG,
  numberSeriesCatalogEntry,
  type NumberSeriesCatalogEntry,
  type NumberSeriesKind,
} from "../constants/number-series-catalog";
import prisma from "../lib/prisma";
import { FAZ_B_ONCESI, scanningClientsCarryFazB } from "../config/client-version-policy";

export { formatSeriesCode, matchesSeries, previewSeriesCode, seriesPrefix };
export type { NumberSeriesFormat };
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import {
  formatSeriesCode,
  matchesSeries,
  previewSeriesCode,
  seriesPrefix,
  type NumberSeriesFormat,
} from "./helpers/series-format.helper";
import { nextDailySeq, normalizeScanCode } from "../utils/code-format";
import { nextCounterCandidate, nextCounterSeq } from "./helpers/series-counter.helper";

// ── ÖNBELLEK ────────────────────────────────────────────────────────────────
// `nextNumberTx` bir tx'in İÇİNDEN senkron okur: burada DB'ye gidilirse interaktif
// bir tx bağlantı tutarken ikinci bağlantı ödünç alınır (havuz kilitlenmesi) ve
// tx kendi commit edilmemiş satırını göremez. Bu yüzden okuma SENKRON'dur ve
// önbellek boot'ta doldurulur (`number-series-catalog.job`).
let cache: Map<string, NumberSeriesFormat> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;
let backgroundRefresh: Promise<void> | null = null;
let refreshBlockedUntil = 0;
const REFRESH_RETRY_MS = 5_000;

/** Katalog tohumu — DB satırı yoksa/okunamadıysa düşülen biçim (= bugünkü davranış). */
function seedFormat(entry: NumberSeriesCatalogEntry): NumberSeriesFormat {
  return {
    prefix: entry.seedPrefix,
    dateSegment: entry.seedDateSegment,
    digits: entry.seedDigits,
    separator: entry.seedSeparator,
    retiredPrefixes: [...(entry.seedRetiredPrefixes ?? [])],
    ...(entry.infix ? { infix: entry.infix.re } : {}),
  };
}

function rowFormat(row: NumberSeries): NumberSeriesFormat {
  // infix DB satırından değil katalogdan okunur — veri onu ne taşır ne ezer.
  const entry = numberSeriesCatalogEntry(row.key);
  return {
    prefix: row.prefix,
    dateSegment: row.dateSegment,
    digits: row.digits,
    separator: row.separator,
    retiredPrefixes: [...row.retiredPrefixes],
    ...(entry.infix ? { infix: entry.infix.re } : {}),
    formatChangedAt: row.formatChangedAt,
    numberSource: row.numberSource,
    // NULL = ayarlanmamış = bugünkü davranış (başlangıç 1, adım 1, sınır yok).
    startValue: row.startValue,
    step: row.step,
    maxValue: row.maxValue,
  };
}

export async function refreshNumberSeriesCache(): Promise<void> {
  const rows = await prisma.numberSeries.findMany();
  const next = new Map<string, NumberSeriesFormat>();
  // Katalogdan DÜŞMÜŞ bir DB satırı (eski sürümden kalan) tabloyu komple
  // düşürmesin: kataloğu kod sahiplenir, tanınmayan satır yok sayılır.
  for (const row of rows) {
    try {
      next.set(row.key, rowFormat(row));
    } catch {
      continue;
    }
  }
  cache = next;
  cachedAt = Date.now();
  refreshBlockedUntil = 0;
}

function scheduleBackgroundRefresh(): void {
  if (backgroundRefresh || Date.now() < refreshBlockedUntil) return;
  backgroundRefresh = refreshNumberSeriesCache()
    .catch(() => {
      refreshBlockedUntil = Date.now() + REFRESH_RETRY_MS;
    })
    .finally(() => {
      backgroundRefresh = null;
    });
}

/** Test/araç kaçışı — bir sonraki okuma DB'ye gider. */
export function invalidateNumberSeriesCache(): void {
  cache = null;
  cachedAt = 0;
  refreshBlockedUntil = 0;
}

/**
 * Serinin YÜRÜRLÜKTEKİ biçimi — senkron, tx içinden güvenle çağrılır.
 *
 * ⚠️ FAIL-SAFE, fail-closed DEĞİL ve bu BEYANLI bir istisnadır: önbellek hiç
 * dolmadıysa katalog tohumuna düşülür. Gerekçe — numara üretememek ÜRETİMİ
 * DURDURUR (çuval açılmaz, sevk kurulmaz), tohum ise bugünkü davranıştır; yani
 * "bilinmiyor" hâlinin en güvenli karşılığı reddetmek değil, eski biçimi sürdürmektir.
 * Bayat önbellek de döner ve arka planda tazelenir (TTL tazeliktir, geçerlilik değil).
 */
export function resolveSeriesFormat(key: string): NumberSeriesFormat {
  const entry = numberSeriesCatalogEntry(key);
  if (cache === null) {
    scheduleBackgroundRefresh();
    return seedFormat(entry);
  }
  if (Date.now() - cachedAt >= CACHE_TTL_MS) scheduleBackgroundRefresh();
  return cache.get(key) ?? seedFormat(entry);
}

// ── BİÇİMLENDİRME → `helpers/series-format.helper.ts` (saf çekirdek, boyut bölmesi)
// ── ÜRETİM ──────────────────────────────────────────────────────────────────

/**
 * Sıradaki numara. `loadCodes` çağıranın modelini/alanını bilen callback'tir ve
 * tx İÇİNDE koşar (bugünkü `findMany({ gte, startsWith })` gövdesi aynen taşınır).
 *
 * ⚠️ ÇAĞRIYI TX CALLBACK'İNİN DIŞINA TAŞIMA: `withBarcodeRetry` her denemede
 * fonksiyonu baştan çağırır; okuma içeride kaldığı sürece her denemede TAZE olur.
 * Dışarı hoist edilirse retry aynı numarayı sonsuza tekrarlar.
 */
/**
 * Sayaç adayı. İKİ BİÇİM bilinçli:
 *   · düz string  → bugünkü davranış, BİREBİR (kapsam daraltması ve atlama YOK)
 *   · `{ code, createdAt }` → kapsam daraltması + çakışma atlaması açılır
 * Çift biçim, 32 çağrı yerini tek seferde değiştirmemek içindir; hangi serinin
 * çağrı yerinin geçirildiği katalogda `scopedCounter` ile BEYANLIDIR ve
 * `updateSeriesFormat` beyansız seriyi düzenlemeye kapatır.
 */
export type SeriesCodeRow = string | null | undefined | { code: string | null; createdAt: Date };

function rowCode(r: SeriesCodeRow): string | null | undefined {
  return typeof r === "object" && r !== null ? r.code : r;
}

/**
 * Atlama tavanı — çakışan kod bulundukça sıra ilerletilir ama SONSUZA KADAR değil.
 *
 * 10.000: bir serinin tek kapsamında bu kadar çakışma, biçim ayarının değil
 * VERİNİN bozulduğu anlamına gelir (ör. aynı ön ek+tarihle iki farklı rejim).
 * Sessizce yanlış numara üretmektense açık hata: sahada "numara alamadım" bir
 * operatörü durdurur, sessiz mükerrer kod ise defteri bozar.
 */
const SKIP_LIMIT = 10_000;

export async function nextSeriesNo(
  key: string,
  loadCodes: (fullPrefix: string) => Promise<Array<SeriesCodeRow>>,
  date: Date = new Date(),
): Promise<string> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  const rows = await loadCodes(fullPrefix);

  // ── KAPSAM: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğanlara bakar ──
  // Tarih segmenti düşünce sabit baş kısalır (`CV220926` → `CV`) ve eski rejimin
  // kodları sayaca girer; ölçüldü: `CV2209260001` varken sıra 2.209.260.004 olur.
  const since = fmt.formatChangedAt ?? null;
  const hasCreatedAt = rows.some((r) => typeof r === "object" && r !== null);
  const scoped = since && hasCreatedAt
    ? rows.filter((r) => typeof r === "object" && r !== null && r.createdAt >= since)
    : rows;

  let seq = seriesSeqFrom(fmt, scoped.map(rowCode), fullPrefix);

  // ── ÇAKIŞMA ATLAMASI: kapsam daraltması sayacı 1'e döndürebilir ──────────────
  // Aynı gün biçim değiştirilip GERİ alınırsa kapsam boşalır ve sıra 1'den başlar;
  // o kod ZATEN VAR olabilir. `@unique` P2002 verir ve `withBarcodeRetry` bunu
  // DETERMİNİSTİK olarak tekrarlayıp 409'la biter (`shipping.service.ts:230` bu
  // davranışı yazılı beyan ediyor) — yani kendi kendine onarmaz.
  if (since && hasCreatedAt) {
    const taken = new Set(rows.map(rowCode).filter((c): c is string => typeof c === "string"));
    // ⚠️ SINIR **DENEME** SAYAR, sıra birimi değil (ölçüldü 2026-09-23: eski
    // `seq - startSeq >= SKIP_LIMIT` birim sayıyordu ⇒ adım 10'da sınır sessizce
    // 10 kat daralırdı). Atlama da ADIM kadar ilerler; 1'er ilerlemek serinin
    // kendi dizisinin DIŞINDA numara üretirdi.
    let deneme = 0;
    while (taken.has(`${fullPrefix}${String(seq).padStart(fmt.digits, "0")}`)) {
      seq = nextCounterCandidate(fmt, seq);
      deneme += 1;
      if (deneme >= SKIP_LIMIT) {
        throw AppError.conflict(
          `"${key}" serisinde sıradaki numara bulunamadı: ${SKIP_LIMIT} ardışık kod dolu. ` +
            "Numara biçimi ayarını kontrol edin.",
          { code: "NUMBER_SERIES_SEQUENCE_EXHAUSTED", key },
        );
      }
    }
  }
  return `${fullPrefix}${String(seq).padStart(fmt.digits, "0")}`;
}

// ⚠️ `seriesCodePrefix(key)` ve `buildSeriesCode(key)` KALDIRILDI (D2①): ikisi de
// anahtardan KENDİ okumasını yapıyordu, yani bir üreteç ön eki bir okumadan,
// kodu BAŞKA bir okumadan alıyordu. Arada bir önbellek tazelemesi olursa ön ek
// eski sürümden, hane/adım yeni sürümden gelirdi — "iki okuma" sınıfı. Doğru
// kalıp TEK okumadır ve üç adım o okumayı paylaşır:
//     const fmt = resolveSeriesFormat(key);
//     const prefix = seriesPrefix(fmt, date);
//     const seq = seriesSeqFrom(fmt, codes, prefix);
//     return formatSeriesCode(fmt, seq, date);
// Sarmalayıcıları bekçiyle YASAKLAMAK yerine SİLMEK bilinçli: var olmayan bir
// fonksiyon yanlış kullanılamaz (bekçi unutulabilir, imza unutulamaz).

/**
 * Sıradaki SIRA — listeden sayısal max, üstüne serinin SAYAÇ AYARI.
 *
 * ⚠️ İLK PARAMETRE BİÇİMİN KENDİSİ, anahtar DEĞİL: ön eki kuran okuma ile sayacı
 * kuran okuma AYNI olmak zorunda. Anahtar geçilseydi fonksiyon ikinci kez
 * önbelleği okurdu ve arada TTL tazelemesi olursa ön ek bir sürümden, adım
 * başka bir sürümden gelirdi — D1①'de kapatılan "iki okuma" sınıfının aynısı.
 *
 * ⚠️ `utils/code-format.ts`'i YALNIZ bu servis import eder (bekçi
 * `test_number_series §7`), yoksa yarın biri ön eki gene literal yazar ve seri
 * tablosu sessizce devre dışı kalır.
 */
export function seriesSeqFrom(
  fmt: NumberSeriesFormat,
  codes: Array<string | null | undefined>,
  fullPrefix: string,
): number {
  // `nextDailySeq` max+1 döner; sayaç çekirdeği MAKSİMUMU ister (başlangıç ve
  // adım "bir sonraki"yi kendisi kurar).
  return nextCounterSeq(fmt, nextDailySeq(codes, fullPrefix) - 1, fullPrefix);
}

/**
 * KULLANILMIŞ en büyük sıra — tükenme ölçümünün girdisi.
 *
 * ⚠️ `seriesSeqFrom` BURADA KULLANILAMAZ ve bu ölçülmüş bir tuzak: o fonksiyon
 * SIRADAKİNİ verir ve üst sınır dolmuşsa 409 FIRLATIR — yani tam %100'de
 * "tükenme durumu" sorusu cevap yerine HATA döndürürdü. Kullanılan sıra bir
 * GÖZLEMDİR, bir talep değil; ayarlardan ve sınırdan bağımsız okunur.
 */
export function seriesUsedMaxFrom(codes: Array<string | null | undefined>, fullPrefix: string): number {
  return Math.max(0, nextDailySeq(codes, fullPrefix) - 1);
}

/** Sıradaki SIRA numarası (kodu kendi kuran yollar için — top barkodu, kartela). */
export async function nextSeriesSeq(
  key: string,
  loadCodes: (fullPrefix: string) => Promise<Array<string | null | undefined>>,
  date: Date = new Date(),
): Promise<{ seq: number; fullPrefix: string; fmt: NumberSeriesFormat }> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  return { seq: seriesSeqFrom(fmt, await loadCodes(fullPrefix), fullPrefix), fullPrefix, fmt };
}

// ── SINIFLANDIRMA (Faz B'nin yemi) ──────────────────────────────────────────

export interface SeriesClassifierRow {
  key: string;
  kind: NumberSeriesKind;
  /** Yürürlükteki ön ek ÖNCE, emekliler sonra — eski etiket de çözülsün diye. */
  prefixes: string[];
  dateSegment: NumberSeries["dateSegment"];
  digits: number;
  separator: string;
  /** Tarih ile sıra arasındaki sabit parça (regex); istemci tam-format regex'ini bundan kurar. */
  infix?: string;
}

function classifierRow(entry: NumberSeriesCatalogEntry): SeriesClassifierRow {
  const fmt = resolveSeriesFormat(entry.key);
  return {
    key: entry.key,
    kind: entry.kind as NumberSeriesKind,
    prefixes: [fmt.prefix, ...fmt.retiredPrefixes],
    dateSegment: fmt.dateSegment,
    digits: fmt.digits,
    separator: fmt.separator,
    ...(fmt.infix ? { infix: fmt.infix } : {}),
  };
}

/** İstemcilerin barkod sınıflandırması için okuduğu tablo. */
export function seriesClassifierTable(): SeriesClassifierRow[] {
  return NUMBER_SERIES_CATALOG.filter((e) => e.kind !== undefined).map(classifierRow);
}

/**
 * Okutulan kodun HANGİ seriye ait olduğu — emekli ön ekler dahil; tanınmazsa null.
 *
 * Sunucudaki TEK sınıflandırıcıdır: `/api/scan/resolve` de `search.service`in
 * tam-format hızlı yolu da bunu çağırır (boğaz ikiz). Ön ek bir gün değişirse
 * ikisi birden değişir; elle yazılmış ikinci bir regex tablosu geride kalmaz.
 *
 * Sıra sonucu ETKİLEMEZ: okutulan serilerde "biri ötekinin ön eki olamaz" kuralı
 * `assertSeriesFormatAllowed ③` ile zaten sağlanıyor, yani bir kod en çok bir
 * seriye uyar.
 */
export function classifyScannedCode(code: string): SeriesClassifierRow | null {
  const upper = normalizeScanCode(code);
  if (upper === "") return null;
  for (const entry of NUMBER_SERIES_CATALOG) {
    if (!entry.kind) continue;
    if (matchesSeries(resolveSeriesFormat(entry.key), upper)) return classifierRow(entry);
  }
  return null;
}

/** Prisma tx tipini dışa taşımamak için — çağıranlar kendi delegate'ini getirir. */
export type SeriesTx = Prisma.TransactionClient;
