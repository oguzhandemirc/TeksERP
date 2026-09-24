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
  codeCountsForCounter,
  formatSeriesCode,
  matchesSeries,
  previewSeriesCode,
  seriesCodeSeq,
  seriesPrefix,
  type NumberSeriesFormat,
} from "./helpers/series-format.helper";
import { nextDailySeq, normalizeScanCode } from "../utils/code-format";
import {
  nextCounterCandidate,
  nextCounterSeq,
  seriesCounterReadsLastBorn,
} from "./helpers/series-counter.helper";

// ── ÖNBELLEK ────────────────────────────────────────────────────────────────
// `nextNumberTx` bir tx'in İÇİNDEN senkron okur: burada DB'ye gidilirse interaktif
// bir tx bağlantı tutarken ikinci bağlantı ödünç alınır (havuz kilitlenmesi) ve
// tx kendi commit edilmemiş satırını göremez. Bu yüzden okuma SENKRON'dur ve
// önbellek boot'ta doldurulur (`number-series-catalog.job`).
let cache: Map<string, NumberSeriesFormat> | null = null;
/**
 * İLERİ TARİHLİ biçim satırları (D4③) — yalnız ÖNİZLEME okur.
 *
 * ⚠️ ÜRETİM YOLU BURAYA BAKMAZ: bir numara hiçbir zaman "gelecekteki" biçimle
 * doğmaz. `resolveSeriesFormat(key)` (tarihsiz) her zaman YÜRÜRLÜKTEKİ biçimi
 * verir; `at` verildiğinde yalnız "o gün ne olacak" sorusu cevaplanır.
 */
let futureCache: Map<string, Array<{ effectiveFrom: Date; fmt: Partial<NumberSeriesFormat> }>> = new Map();
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
    // Tohum sayaç ayarları: satır henüz doğmamışken de BUGÜNKÜ davranış geçerli
    // olsun diye. Önbellek boşken `resolveSeriesFormat` buraya düşüyor; sınır ve
    // sarma burada olmasaydı ilk boot'ta kısa parti no sarmayı unuturdu.
    ...(entry.seedMaxValue === undefined ? {} : { maxValue: entry.seedMaxValue }),
    ...(entry.seedWrap === undefined ? {} : { wrap: entry.seedWrap }),
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
    separator2: row.separator2,
    retiredPrefixes: [...row.retiredPrefixes],
    ...(entry.infix ? { infix: entry.infix.re } : {}),
    formatChangedAt: row.formatChangedAt,
    numberSource: row.numberSource,
    // NULL = ayarlanmamış = bugünkü davranış (başlangıç 1, adım 1, sınır yok).
    startValue: row.startValue,
    step: row.step,
    maxValue: row.maxValue,
    wrap: row.wrap,
  };
}

/**
 * VADESİ GELEN İLERİ TARİHLİ SATIRLARI YÜRÜRLÜĞE ALIR (D4③).
 *
 * ⚠️ NEDEN ÖNBELLEK TAZELEMESİNİN İÇİNDE: `number_series` kolonları yürürlükteki
 * satırın ÖNBELLEĞİ (D4①) ve o eşitliği bir bekçi ölçüyor. İleri tarihli bir
 * satır vadesi gelince kendiliğinden yürürlüğe girerse kolonlar BAYATLARDI —
 * yani "1 Ocak geldi ama sistem hâlâ eski biçimi üretiyor" ya da "satır yeni,
 * önbellek eski" ayrışması. Aktivasyon bir OLAYDIR ve tek yerde yapılır.
 *
 * ⚠️ AYRI BİR ZAMANLAYICI YOK ve bu bilinçli: tazeleme zaten her 60 sn'de bir
 * (ve her boot'ta) koşuyor; ikinci bir zamanlayıcı, çalışıp çalışmadığı ayrıca
 * ölçülmesi gereken ikinci bir mekanizma olurdu.
 *
 * Eski ön ek EMEKLİYE ayrılır — biçim panelden değiştirildiğindeki davranışın
 * aynısı; geçmiş kod okunmaya devam eder.
 */
async function activateDueLines(): Promise<string[]> {
  const simdi = new Date();
  const seriler = await prisma.numberSeries.findMany({
    select: {
      key: true, prefix: true, dateSegment: true, digits: true, separator: true, separator2: true,
      retiredPrefixes: true, formatChangedAt: true,
    },
  });
  const aktive: string[] = [];
  for (const s of seriler) {
    const line = await prisma.numberSeriesLine.findFirst({
      where: { seriesKey: s.key, effectiveFrom: { lte: simdi } },
      orderBy: { effectiveFrom: "desc" },
      select: { prefix: true, dateSegment: true, digits: true, separator: true, separator2: true, effectiveFrom: true },
    });
    if (!line) continue;
    // ⚠️ ÖLÇÜT "kolonlar satırdan FARKLI" DEĞİL, "DAHA YENİ bir satır VADESİ
    // GELDİ": aktivasyon bir OLAYDIR, bir eşitleme değil. Fark ölçütüyle
    // yazılmış ilk hâli, kolonlara doğrudan yazan her yolu (bekçi fikstürleri
    // dahil) sessizce GERİ ALIYORDU — ölçüldü 2026-09-23, `test_number_series_scope
    // §2` kırmızı verdi ve HAKLIYDI: kolonları satırın kopyası saymak başka,
    // satırı kolonların EFENDİSİ yapmak başkadır.
    const stamp = s.formatChangedAt?.getTime() ?? 0;
    if (line.effectiveFrom.getTime() <= stamp) continue;
    const retired =
      line.prefix === s.prefix ? s.retiredPrefixes : [...new Set([...s.retiredPrefixes, s.prefix])];
    await prisma.numberSeries.update({
      where: { key: s.key },
      data: {
        prefix: line.prefix, dateSegment: line.dateSegment, digits: line.digits,
        separator: line.separator, separator2: line.separator2,
        retiredPrefixes: retired, formatChangedAt: line.effectiveFrom,
      },
    });
    aktive.push(s.key);
  }
  if (aktive.length > 0) {
    // Bir SİSTEM olayı (kullanıcı eylemi değil): fabrikanın aylar önce verdiği
    // karar bugün yürürlüğe girdi ve bunun izi olmalı.
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "NUMBER_SERIES_LINE_ACTIVATED",
      tableName: "number_series",
      payload: { keys: aktive },
    });
  }
  return aktive;
}

export async function refreshNumberSeriesCache(): Promise<void> {
  // ⚠️ SIRA LOAD-BEARING: aktivasyon ÖNCE koşar, önbellek SONRA dolar. Ters
  // sırada, vadesi gelen satır bir tur boyunca (60 sn) görünmezdi.
  await activateDueLines();
  const rows = await prisma.numberSeries.findMany();
  // ⚠️ EMEKLİ BİÇİMLER AYNI OKUMADA: satırlar ayrı bir turda çekilseydi ön ek
  // bir sürümden, emekli biçimler başkasından gelirdi ("iki okuma" sınıfı).
  // Yürürlükteki satır hariç TÜMÜ emekli sayılır; sıra yeniden eskiye.
  const lines = await prisma.numberSeriesLine.findMany({
    orderBy: [{ seriesKey: "asc" }, { effectiveFrom: "desc" }],
    select: {
      seriesKey: true, prefix: true, dateSegment: true, digits: true,
      separator: true, separator2: true, effectiveFrom: true,
    },
  });
  const simdi = Date.now();
  const emekliler = new Map<string, NumberSeriesFormat["retiredFormats"]>();
  for (const l of lines) {
    // İleri tarihli satır henüz yürürlükte DEĞİL ve EMEKLİ de değil — atlanır.
    if (l.effectiveFrom.getTime() > simdi) continue;
    const retiredList = emekliler.get(l.seriesKey);
    if (retiredList === undefined) {
      // İlk (en yeni) satır YÜRÜRLÜKTEKİDİR, emekli listesine girmez.
      emekliler.set(l.seriesKey, []);
      continue;
    }
    retiredList.push({
      prefix: l.prefix, dateSegment: l.dateSegment, digits: l.digits,
      separator: l.separator, separator2: l.separator2,
    });
  }
  // İLERİ TARİHLİ satırlar ayrı tutulur: önizleme (`resolveSeriesFormat(key, at)`)
  // onları okur, ÜRETİM yolu okumaz — bir numara hiçbir zaman "gelecekteki"
  // biçimle doğmaz.
  const gelecek = new Map<string, Array<{ effectiveFrom: Date; fmt: Partial<NumberSeriesFormat> }>>();
  for (const l of lines) {
    if (l.effectiveFrom.getTime() <= simdi) continue;
    const dizi = gelecek.get(l.seriesKey) ?? [];
    dizi.push({
      effectiveFrom: l.effectiveFrom,
      fmt: {
        prefix: l.prefix, dateSegment: l.dateSegment, digits: l.digits,
        separator: l.separator, separator2: l.separator2,
      },
    });
    gelecek.set(l.seriesKey, dizi);
  }
  const next = new Map<string, NumberSeriesFormat>();
  // Katalogdan DÜŞMÜŞ bir DB satırı (eski sürümden kalan) tabloyu komple
  // düşürmesin: kataloğu kod sahiplenir, tanınmayan satır yok sayılır.
  for (const row of rows) {
    try {
      const f = rowFormat(row);
      const eski = emekliler.get(row.key);
      next.set(row.key, eski && eski.length > 0 ? { ...f, retiredFormats: eski } : f);
    } catch {
      continue;
    }
  }
  cache = next;
  futureCache = gelecek;
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
export function resolveSeriesFormat(key: string, at?: Date): NumberSeriesFormat {
  const entry = numberSeriesCatalogEntry(key);
  if (cache === null) {
    scheduleBackgroundRefresh();
    return seedFormat(entry);
  }
  if (Date.now() - cachedAt >= CACHE_TTL_MS) scheduleBackgroundRefresh();
  const yururlukte = cache.get(key) ?? seedFormat(entry);
  if (at === undefined) return yururlukte;
  // ⚠️ REJİMİ ÜRETİM ANI SEÇER, TARİH SEGMENTİNİN DEĞERİNİ BELGE TARİHİ VERİR.
  // Üreteçler bu fonksiyonu TARİHSİZ çağırır (yürürlükteki rejim) ve belge
  // tarihini `seriesPrefix`/`formatSeriesCode`a geçirir. `at` YALNIZ önizleme
  // içindir: "1 Ocak'ta bu seri neye benzeyecek?". Ters kurgu (rejimi belge
  // tarihi seçsin) 1 Ocak'ta girilen 28 Aralık tarihli bir fişi KAPANMIŞ bir
  // sayaç kapsamına yazardı; emsal `reconciliation-letter.service` başlığında:
  // "geçmiş tarihli numara üretmek, bugün kesilen kâğıdı geçmişe yazmak olurdu".
  const ileri = (futureCache.get(key) ?? [])
    .filter((x) => x.effectiveFrom.getTime() <= at.getTime())
    .sort((a1, b1) => b1.effectiveFrom.getTime() - a1.effectiveFrom.getTime())[0];
  return ileri ? { ...yururlukte, ...ileri.fmt, formatChangedAt: ileri.effectiveFrom } : yururlukte;
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
  loadCodes: (fullPrefix: string, fmt: NumberSeriesFormat) => Promise<Array<SeriesCodeRow>>,
  date: Date = new Date(),
  /**
   * ADAY BİÇİM — yalnız ÖNİZLEME yolu geçirir (panelde "sıradaki numara").
   *
   * ⚠️ İKİNCİ BİR HESAP YAZMAMAK için var: "sıradaki numara" sorusunu panel için
   * ayrıca hesaplasaydık, kapsam damgası · atlama döngüsü · adım/başlangıç
   * kuralları İKİ YERDE yaşardı ve biri bayatlardı ("türetilmiş alan / ayrışan
   * yüzey"). Üretim yolu bu parametreyi HİÇ geçirmez.
   */
  fmtOverride?: NumberSeriesFormat,
): Promise<string> {
  const fmt = fmtOverride ?? resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  const rows = await loadCodes(fullPrefix, fmt);
  const seq = scopedNextSeq(key, fmt, fullPrefix, rows);
  return `${fullPrefix}${String(seq).padStart(fmt.digits, "0")}`;
}

/**
 * KAPSAM + ÇAKIŞMA ATLAMASI — `nextSeriesNo` ile `nextSeriesSeq`in ORTAK çekirdeği.
 *
 * ⚠️ TEK GÖVDE OLMASI ŞART: "sıradaki sıra" sorusunu iki yerde hesaplasaydık
 * kapsam damgası bir yerde, atlama döngüsü başka bir yerde yaşardı ve fark
 * yalnız SAHADA görünürdü ("türetilmiş alan / ayrışan yüzey"). Kartela toplu
 * kabulü sırayı ister (N kart tek okumadan), fatura kodu ister — soru aynı.
 */
/**
 * SARMALI SERİDE SAYACIN KAYNAĞI — listenin İLK geçerli kodunun sırası.
 *
 * ⚠️ SIRA ÇAĞIRANIN SORUMLULUĞU: bu fonksiyon "ilk satır en yenidir" varsayar
 * ve bunu doğrulayamaz (satırlar `createdAt` taşımayabilir). Sarmalı serinin
 * üreteci `ORDER BY "createdAt" DESC` ile okur; okumayan bir çağıran sayacı
 * rastgele bir koddan sürdürürdü. Bu yüzden sarma bugün yalnız TEK üreteçte
 * (`batch.service`) açıktır ve yeni bir sarmalı seri açılırken bu cümle okunur.
 *
 * Geçerli kod yoksa `0` — `nextCounterSeq` onu `startValue`a çevirir.
 */
function sonDoganSeq(fmt: NumberSeriesFormat, rows: Array<SeriesCodeRow>): number {
  for (const r of rows) {
    const n = seriesCodeSeq(fmt, rowCode(r));
    if (n !== null) return n;
  }
  return 0;
}

/**
 * KAPSAM: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğanlara bakar.
 * Tarih segmenti düşünce sabit baş kısalır (`CV220926` → `CV`) ve eski rejimin
 * kodları sayaca girer; ölçüldü: `CV2209260001` varken sıra 2.209.260.004 olur.
 * Sıradaki numara da kullanılan sıra (tükenme) da BURADAN süzülür.
 */
function scopeSeriesRows(
  fmt: NumberSeriesFormat,
  rows: Array<SeriesCodeRow>,
): { scoped: Array<SeriesCodeRow>; since: Date | null; hasCreatedAt: boolean } {
  const since = fmt.formatChangedAt ?? null;
  const hasCreatedAt = rows.some((r) => typeof r === "object" && r !== null);
  const scoped = since && hasCreatedAt
    ? rows.filter((r) => typeof r === "object" && r !== null && r.createdAt >= since)
    : rows;
  return { scoped, since, hasCreatedAt };
}

function scopedNextSeq(
  key: string,
  fmt: NumberSeriesFormat,
  fullPrefix: string,
  rows: Array<SeriesCodeRow>,
): number {
  const { scoped, since, hasCreatedAt } = scopeSeriesRows(fmt, rows);

  // ⚠️ SAYACIN KAYNAĞI SERİYE GÖRE DEĞİŞİR ve yüklem TEK YERDE (`series-counter`):
  // sarmalı seride (plaka seti) en büyük numara "en son" DEĞİLDİR — P99'dan sonra
  // doğan P01 en yenisidir ve max'a bakan bir sayaç sonsuza dek P99'da takılırdı.
  // Sarmalı serilerde çağıran satırları EN YENİ ÖNCE sıralı verir ve ilk satır
  // sayacın kaynağıdır; diğer 51 seride davranış bayt bayt aynıdır.
  let seq = seriesCounterReadsLastBorn(fmt)
    ? nextCounterSeq(fmt, sonDoganSeq(fmt, scoped), fullPrefix)
    : seriesSeqFrom(fmt, scoped.map(rowCode), fullPrefix);

  // ── ÇAKIŞMA ATLAMASI: kapsam daraltması sayacı 1'e döndürebilir ──────────────
  // Aynı gün biçim değiştirilip GERİ alınırsa kapsam boşalır ve sıra 1'den başlar;
  // o kod ZATEN VAR olabilir. `@unique` P2002 verir ve `withBarcodeRetry` bunu
  // DETERMİNİSTİK olarak tekrarlayıp 409'la biter (`shipping.service.ts:230` bu
  // davranışı yazılı beyan ediyor) — yani kendi kendine onarmaz.
  // ⚠️ SARMALI SERİDE ATLAMA YOK ve bu bir EKSİKLİK DEĞİL: sarma KÖRLEMESİNEDİR
  // (2026-08-05 kullanıcı kararı) — numara o an başka bir canlı kayıtta kullanılıyor
  // olabilir ve fabrika bunu bilerek istedi. Atlama döngüsü burada koşsaydı biçim
  // değişiminden sonra sayaç "boştaki numarayı" arar, 99'u da doluysa 409 verir ve
  // üretimi durdururdu — reddedilen alternatifin ta kendisi.
  if (since && hasCreatedAt && !seriesCounterReadsLastBorn(fmt)) {
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
  return seq;
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
export function seriesUsedMaxFrom(
  fmt: NumberSeriesFormat,
  rows: Array<SeriesCodeRow>,
  fullPrefix: string,
): number {
  // Üreteçle AYNI kapsam ve AYNI süzgeç: başka bir serinin (ör. aynı kolonu
  // paylaşan ikiz rejimin) ya da eski biçimin kodu kullanım sayılmaz.
  const { scoped } = scopeSeriesRows(fmt, rows);
  const codes = scoped
    .map(rowCode)
    .filter((c): c is string => typeof c === "string" && codeCountsForCounter(fmt, c));
  return Math.max(0, nextDailySeq(codes, fullPrefix) - 1);
}

/**
 * Sıradaki SIRA numarası (kodu kendi kuran yollar için — top barkodu, kartela
 * toplu kabulü). `nextSeriesNo` ile AYNI çekirdekten geçer: kapsam damgası ve
 * çakışma atlaması burada da uygulanır.
 *
 * ⚠️ BİÇİM DE DÖNER ve çağıran kodu ONUNLA kurmalı: ikinci bir
 * `resolveSeriesFormat` çağrısı arada bir TTL tazelemesine denk gelirse ön ek
 * bir sürümden, hane/adım başka bir sürümden gelir ("iki okuma" sınıfı).
 */
export async function nextSeriesSeq(
  key: string,
  loadCodes: (fullPrefix: string, fmt: NumberSeriesFormat) => Promise<Array<SeriesCodeRow>>,
  date: Date = new Date(),
): Promise<{ seq: number; fullPrefix: string; fmt: NumberSeriesFormat }> {
  const fmt = resolveSeriesFormat(key);
  const fullPrefix = seriesPrefix(fmt, date);
  const rows = await loadCodes(fullPrefix, fmt);
  return { seq: scopedNextSeq(key, fmt, fullPrefix, rows), fullPrefix, fmt };
}

// ── SINIFLANDIRMA → `helpers/series-classifier.helper.ts` ────────────────────
// ⚠️ BURADAN YENİDEN İHRAÇ EDİLMİYOR ve bu bir SÖZLEŞME (2026-09-24): sınıflandırıcı
// bu servisin `resolveSeriesFormat`ını çağırır, yani ihraç geri konursa iki modül
// RUNTIME (value) DÖNGÜSÜNE girer — `test_import_cycles` bunu kırmızı verir.
// Boyut bölmesi yapılırken kolaylık olsun diye konmuştu; çağıranlar helper'ı
// DOĞRUDAN import eder, tek yön kalır.

/**
 * BEKLEYEN (henüz yürürlüğe girmemiş) BİÇİM DEĞİŞİKLİĞİ — panel bunu gösterir.
 *
 * ⚠️ En YAKIN vadeli satır döner: ekranda "şu tarihte şu biçime geçecek" tek bir
 * cümle vardır; birden çok bekleyen satır varsa sıradaki odur. Panel bunu kendi
 * hesaplamaz (önbellek sunucuda).
 */
export function pendingSeriesLine(key: string): { effectiveFrom: Date; fmt: Partial<NumberSeriesFormat> } | null {
  const dizi = [...(futureCache.get(key) ?? [])].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  return dizi[0] ?? null;
}

/** Prisma tx tipini dışa taşımamak için — çağıranlar kendi delegate'ini getirir. */
export type SeriesTx = Prisma.TransactionClient;
