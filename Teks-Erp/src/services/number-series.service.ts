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

  let seq = nextDailySeq(scoped.map(rowCode), fullPrefix);

  // ── ÇAKIŞMA ATLAMASI: kapsam daraltması sayacı 1'e döndürebilir ──────────────
  // Aynı gün biçim değiştirilip GERİ alınırsa kapsam boşalır ve sıra 1'den başlar;
  // o kod ZATEN VAR olabilir. `@unique` P2002 verir ve `withBarcodeRetry` bunu
  // DETERMİNİSTİK olarak tekrarlayıp 409'la biter (`shipping.service.ts:230` bu
  // davranışı yazılı beyan ediyor) — yani kendi kendine onarmaz.
  if (since && hasCreatedAt) {
    const taken = new Set(rows.map(rowCode).filter((c): c is string => typeof c === "string"));
    const startSeq = seq;
    while (taken.has(`${fullPrefix}${String(seq).padStart(fmt.digits, "0")}`)) {
      seq += 1;
      if (seq - startSeq >= SKIP_LIMIT) {
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
  next: Omit<NumberSeriesFormat, "retiredPrefixes" | "infix" | "formatChangedAt">,
  userId?: string,
): Promise<NumberSeries> {
  // ⚠️ KONFİGÜRASYON SINIRI (C0): sayacı biçim değişimine HAZIR OLMAYAN seri
  // düzenlenemez. Üretim yolu kapatılmaz — çuval açılamaz hâle gelirdi; asıl
  // engellenmesi gereken riskli AYAR değişikliğidir. Beyan katalogdadır.
  const katalog = numberSeriesCatalogEntry(key);
  // ⚠️ C0b — ESKİ İSTEMCİ KAPISI, `lockedReason`dan AYRI bir cümledir:
  // `lockedReason` "bu serinin biçimi YAPISAL olarak değişemez" der (top
  // barkodunun faz harfi), bu kapı "BUGÜN değişemez çünkü saha hazır değil"
  // der. İkisi farklı gün kalkar, bu yüzden biri ötekinin yerine geçmez.
  // Okutulan bir serinin ön eki değişirse, Faz B'yi taşımayan istemci kendi
  // SABİT regex'iyle okumaya devam eder ve kodu SESSİZCE yanlış türe çözer.
  if (katalog.kind && !scanningClientsCarryFazB()) {
    throw AppError.badRequest(
      `Okutulan serilerin biçimi, sahadaki panel ve tabletler güncellenmeden değiştirilemez: ${katalog.label}. ` +
        `En düşük sürüm eşiği panelde ${FAZ_B_ONCESI.electron}, tablette ${FAZ_B_ONCESI.mobil} üstüne çıkmalı.`,
      { code: "NUMBER_SERIES_CLIENT_TOO_OLD", key },
    );
  }
  if (!katalog.scopedCounter) {
    throw AppError.badRequest(
      `Bu serinin sayacı biçim değişimine hazır değil: ${katalog.label}. ` +
        "Numara üreten yol kapsam damgasına geçirilmeden biçim değiştirilemez.",
      { code: "NUMBER_SERIES_COUNTER_NOT_SCOPED", key },
    );
  }
  const current = resolveSeriesFormat(key);
  const retired =
    current.prefix === next.prefix
      ? current.retiredPrefixes
      : [...new Set([...current.retiredPrefixes, current.prefix])];
  assertSeriesFormatAllowed(key, { ...next, retiredPrefixes: retired });

  const row = await prisma.numberSeries.update({
    where: { key },
    // `formatChangedAt` sayacın KAPSAM sınırıdır: bundan sonraki numaralar yalnız
    // bu andan sonra doğan kodlara bakar (eski rejim sayaca giremez).
    data: { ...next, retiredPrefixes: retired, formatChangedAt: new Date(), updatedById: userId ?? null },
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
