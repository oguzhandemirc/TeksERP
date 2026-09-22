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
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { factoryYmd } from "../constants/time";
import { ddmmyy, nextDailySeq } from "../utils/code-format";

/** Biçimin veri-sahipli parçası — panelden yazılan tek şey budur. */
export interface NumberSeriesFormat {
  prefix: string;
  dateSegment: NumberSeries["dateSegment"];
  digits: number;
  separator: string;
  retiredPrefixes: string[];
  /**
   * KOD-SAHİPLİ — katalogdan gelir, `number_series` satırından DEĞİL ve panel
   * yazamaz (`updateSeriesFormat` tipi dışarıda bırakır). Biçimle birlikte
   * taşınmasının sebebi: `matchesSeries(resolveSeriesFormat(key), code)` çağıran
   * bir yol infix'i ayrıca geçirmeyi unutursa sessizce YANLIŞ cevap alırdı.
   */
  infix?: string;
}

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

// ── BİÇİMLENDİRME ───────────────────────────────────────────────────────────

/** Tarih segmentinin metni. `NONE` → boş (sayaç hiç sıfırlanmaz). */
function dateText(segment: NumberSeries["dateSegment"], date: Date): string {
  if (segment === "NONE") return "";
  if (segment === "DDMMYY") return ddmmyy(date);
  const ymd = factoryYmd(date); // "YYYY-MM-DD" — fabrika takvim günü (süreç TZ'si değil)
  const yyyy = ymd.slice(0, 4);
  const mm = ymd.slice(5, 7);
  if (segment === "YYMM") return `${yyyy.slice(2)}${mm}`;
  if (segment === "YYYYMM") return `${yyyy}${mm}`;
  if (segment === "YY") return yyyy.slice(2);
  return yyyy; // YYYY
}

/**
 * Sayaç kuyruğundan ÖNCEKİ sabit parça — `where: { gte, startsWith }` sorgusunun
 * anahtarı ve aynı zamanda sayacın kapsamı. Ayraç İKİ eklem yerinde de kullanılır
 * (`PRT` + "-" + `2609` + "-" → `PRT-2609-`; `STK` + "-" → `STK-`).
 */
export function seriesPrefix(fmt: NumberSeriesFormat, date: Date = new Date()): string {
  const dt = dateText(fmt.dateSegment, date);
  return dt === "" ? `${fmt.prefix}${fmt.separator}` : `${fmt.prefix}${fmt.separator}${dt}${fmt.separator}`;
}

/**
 * Tam kod. `digits = 1` → DOLGU YOK (`padStart(1)` seq ≥ 1 için no-op).
 * Sıra `10^digits`'i aşarsa kod GENİŞLER, SARMAZ — sarmak mükerrer kod demektir.
 */
export function formatSeriesCode(fmt: NumberSeriesFormat, seq: number, date: Date = new Date()): string {
  return `${seriesPrefix(fmt, date)}${String(seq).padStart(fmt.digits, "0")}`;
}

/** Panel önizlemesi — "PKT2209260001". */
export function previewSeriesCode(fmt: NumberSeriesFormat, seq = 1, date: Date = new Date()): string {
  return formatSeriesCode(fmt, seq, date);
}

/**
 * Bir kodun seriye UYUP UYMADIĞI — emekli ön ekler DAHİL, hane sayısı ESNEK.
 *
 * ⚠️ Hane esnekliği bir hata düzeltmesidir: bugünkü `isDailyCode(code, prefix, 4)`
 * 9999'u aşan günde üretilen 5 haneli kodu REDDEDİYOR (kayıt yazılıyor ama
 * okutulamıyor — `scripts/audit_repro_E-1-04.ts`). En az `digits`, fazlası serbest.
 */
export function matchesSeries(fmt: NumberSeriesFormat, code: string): boolean {
  const upper = code.trim().toUpperCase();
  const dateLen = { NONE: 0, DDMMYY: 6, YYMM: 4, YYYYMM: 6, YY: 2, YYYY: 4 }[fmt.dateSegment];
  const sep = fmt.separator === "" ? "" : escapeRe(fmt.separator);
  // infix KAÇIRILMAZ: regex parçası olarak katalogda yazılı (`[HF]`), veri değil kod.
  const infix = fmt.infix ?? "";
  for (const prefix of [fmt.prefix, ...fmt.retiredPrefixes]) {
    const head = dateLen === 0 ? `${escapeRe(prefix)}${sep}` : `${escapeRe(prefix)}${sep}\\d{${dateLen}}${sep}`;
    if (new RegExp(`^${head}${infix}\\d{${fmt.digits},}$`).test(upper)) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── ÜRETİM ──────────────────────────────────────────────────────────────────

/**
 * Sıradaki numara. `loadCodes` çağıranın modelini/alanını bilen callback'tir ve
 * tx İÇİNDE koşar (bugünkü `findMany({ gte, startsWith })` gövdesi aynen taşınır).
 *
 * ⚠️ ÇAĞRIYI TX CALLBACK'İNİN DIŞINA TAŞIMA: `withBarcodeRetry` her denemede
 * fonksiyonu baştan çağırır; okuma içeride kaldığı sürece her denemede TAZE olur.
 * Dışarı hoist edilirse retry aynı numarayı sonsuza tekrarlar.
 */
export async function nextSeriesNo(
  key: string,
  loadCodes: (fullPrefix: string) => Promise<Array<string | null | undefined>>,
  date: Date = new Date(),
): Promise<string> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  const seq = nextDailySeq(await loadCodes(fullPrefix), fullPrefix);
  return `${fullPrefix}${String(seq).padStart(fmt.digits, "0")}`;
}

/**
 * `dailyCodePrefix` yerine geçen İKİZ — çağıran ön eki artık literal yazmaz, serinin
 * ANAHTARINI yazar. Sorgu kalıbı aynen korunur: `where: { gte, startsWith }`.
 */
export function seriesCodePrefix(key: string, date: Date = new Date()): string {
  return seriesPrefix(resolveSeriesFormat(key), date);
}

/** `buildDailyCode` ikizi — hane sayısı da seriden gelir (dolgu 1 ise dolgu yok). */
export function buildSeriesCode(key: string, seq: number, date: Date = new Date()): string {
  return formatSeriesCode(resolveSeriesFormat(key), seq, date);
}

/**
 * `nextDailySeq` ikizi — listeden SAYISAL max + 1.
 *
 * ⚠️ Burada yeniden dışa açılmasının sebebi mimari: `utils/code-format.ts`'i YALNIZ
 * bu servis import eder (bekçi `test_number_series_tek_kaynak`), yoksa yarın biri
 * ön eki gene literal yazar ve seri tablosu sessizce devre dışı kalır.
 */
export function seriesSeqFrom(codes: Array<string | null | undefined>, fullPrefix: string): number {
  return nextDailySeq(codes, fullPrefix);
}

/** Sıradaki SIRA numarası (kodu kendi kuran yollar için — top barkodu, kartela). */
export async function nextSeriesSeq(
  key: string,
  loadCodes: (fullPrefix: string) => Promise<Array<string | null | undefined>>,
  date: Date = new Date(),
): Promise<{ seq: number; fullPrefix: string; fmt: NumberSeriesFormat }> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  return { seq: nextDailySeq(await loadCodes(fullPrefix), fullPrefix), fullPrefix, fmt };
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

/** İstemcilerin barkod sınıflandırması için okuduğu tablo. */
export function seriesClassifierTable(): SeriesClassifierRow[] {
  return NUMBER_SERIES_CATALOG.filter((e) => e.kind !== undefined).map((e) => {
    const fmt = resolveSeriesFormat(e.key);
    return {
      key: e.key,
      kind: e.kind as NumberSeriesKind,
      prefixes: [fmt.prefix, ...fmt.retiredPrefixes],
      dateSegment: fmt.dateSegment,
      digits: fmt.digits,
      separator: fmt.separator,
      ...(fmt.infix ? { infix: fmt.infix } : {}),
    };
  });
}

// ── KAPI ────────────────────────────────────────────────────────────────────

/** Okutulan kodların ön eki: ASCII, büyük harf, 1-6 — Code128 + istemci `toUpperCase()`. */
const SCANNED_PREFIX_RE = /^[A-Z0-9]{1,6}$/;
/** Okutulmayan seriler tire/alt çizgi taşıyabilir (STK-, PRT-), Türkçe harf yine yasak. */
const PLAIN_PREFIX_RE = /^[A-Z0-9_-]{1,6}$/;

/**
 * Biçim kapısı — fail-closed. Üç ayaklı:
 *   ① karakter kümesi (Türkçe harf barkodu bozar, `code-format.ts:167` gerekçesi),
 *   ② hane aralığı (DB CHECK'in uygulama tarafı ikizi),
 *   ③ ÖN EK ÇAKIŞMASI — yalnız TARAMA UZAYINDA küresel.
 *
 * ⚠️ ③'ün dar olması bilinçli ve ÖLÇÜLDÜ: bugün `KS` (kartela sevk + kasa kodu),
 * `IADE` (iade belgesi + iade sebebi) ve `P` (üretim partisi + sevk partisi adı)
 * zaten çakışıyor ve zararsız — ayrı tablolarda yaşıyorlar ve OKUTULMUYORLAR.
 * Kapı küresel olsaydı doğduğu gün üç yanlış kırmızı verirdi.
 */
export function assertSeriesFormatAllowed(key: string, fmt: NumberSeriesFormat): void {
  const entry = numberSeriesCatalogEntry(key);
  if (entry.lockedReason) {
    throw AppError.badRequest(`Bu serinin biçimi değiştirilemez: ${entry.lockedReason}`, {
      code: "NUMBER_SERIES_LOCKED",
      key,
    });
  }
  const re = entry.kind ? SCANNED_PREFIX_RE : PLAIN_PREFIX_RE;
  if (!re.test(fmt.prefix)) {
    throw AppError.badRequest(
      entry.kind
        ? "Okutulan kodların ön eki yalnız İngiliz alfabesi harfleri ve rakam olabilir (en çok 6 karakter)."
        : "Ön ek yalnız İngiliz alfabesi harfleri, rakam, tire ve alt çizgi olabilir (en çok 6 karakter).",
      { code: "NUMBER_SERIES_PREFIX_INVALID", key },
    );
  }
  if (!Number.isInteger(fmt.digits) || fmt.digits < 1 || fmt.digits > 8) {
    throw AppError.badRequest("Hane sayısı 1 ile 8 arasında olmalı.", {
      code: "NUMBER_SERIES_DIGITS_INVALID",
      key,
    });
  }
  if (!["", "-", "_", "/", "."].includes(fmt.separator)) {
    throw AppError.badRequest("Ayraç boş ya da - _ / . olabilir.", {
      code: "NUMBER_SERIES_SEPARATOR_INVALID",
      key,
    });
  }
  if (!entry.kind) return;

  // ③ Tarama uzayında ön ek çakışması — biri diğerinin BAŞLANGICI olamaz, çünkü
  // istemci sınıflandırması ön-ek çapalıdır (`CV` varken `CV2` ilk kurala takılır).
  const mine = [fmt.prefix, ...fmt.retiredPrefixes];
  for (const other of NUMBER_SERIES_CATALOG) {
    if (other.key === key || !other.kind) continue;
    const theirs = (() => {
      const f = resolveSeriesFormat(other.key);
      return [f.prefix, ...f.retiredPrefixes];
    })();
    for (const a of mine) {
      for (const b of theirs) {
        if (a.startsWith(b) || b.startsWith(a)) {
          throw AppError.conflict(
            `"${a}" ön eki "${other.label}" serisinin "${b}" ön ekiyle çakışıyor; okutulan kod hangi kayda ait olduğu anlaşılamaz.`,
            { code: "NUMBER_SERIES_PREFIX_COLLISION", key, conflictsWith: other.key },
          );
        }
      }
    }
  }
}

// ── YAZMA ───────────────────────────────────────────────────────────────────

/** Panelin yazdığı tek uç. Eski ön ek EMEKLİYE ayrılır (geçmiş kod okunmaya devam eder). */
export async function updateSeriesFormat(
  key: string,
  next: Omit<NumberSeriesFormat, "retiredPrefixes" | "infix">,
  userId?: string,
): Promise<NumberSeries> {
  const current = resolveSeriesFormat(key);
  const retired =
    current.prefix === next.prefix
      ? current.retiredPrefixes
      : [...new Set([...current.retiredPrefixes, current.prefix])];
  assertSeriesFormatAllowed(key, { ...next, retiredPrefixes: retired });

  const row = await prisma.numberSeries.update({
    where: { key },
    data: { ...next, retiredPrefixes: retired, updatedById: userId ?? null },
  });
  await refreshNumberSeriesCache();
  // Biçim değişikliği bir İŞ KARARIDIR (bundan sonraki her belgenin numarası değişir),
  // bu yüzden denetim defterine yazılır — tx DIŞINDA, best-effort.
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "NumberSeries",
    recordId: row.id,
    oldData: { ...current },
    newData: { ...next, retiredPrefixes: retired },
  });
  return row;
}

/** Liste ucu — katalog kimliği + yürürlükteki biçim + örnek. */
export function listSeries(): Array<
  NumberSeriesFormat & {
    key: string;
    label: string;
    kind?: NumberSeriesKind;
    editable: boolean;
    lockedReason?: string;
    preview: string;
  }
> {
  return NUMBER_SERIES_CATALOG.map((e) => {
    const fmt = resolveSeriesFormat(e.key);
    return {
      ...fmt,
      key: e.key,
      label: e.label,
      ...(e.kind ? { kind: e.kind } : {}),
      editable: !e.lockedReason,
      ...(e.lockedReason ? { lockedReason: e.lockedReason } : {}),
      preview: previewSeriesCode(fmt),
    };
  });
}

/** Prisma tx tipini dışa taşımamak için — çağıranlar kendi delegate'ini getirir. */
export type SeriesTx = Prisma.TransactionClient;
