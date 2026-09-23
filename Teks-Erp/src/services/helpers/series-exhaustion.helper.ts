// =============================================================================
// NUMARA SERİSİ — TÜKENME UYARISI (%90, 2026-09-23)
// =============================================================================
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: "sınıra yaklaşıldı" · "sınırdan uzak" · **ÖLÇÜLEMEDİ**.
// Üst sınırı olmayan seride yüzde TANIMSIZDIR ve `null` döner — "0 %" demek,
// ölçülmemiş bir şeye sıfır demek olurdu (numaralandırma ekranının etki sayısı
// kararının aynısı).
//
// ⚠️ HANE VEKİL SINIR SAYILMAZ: `digits` bir DOLGU ayarıdır, taşma haneyi
// genişletir (ölçüldü). `10^digits−1`i sınır saymak, hiçbir şeyin olmayacağı
// bir yerde alarm üretirdi — çözdüğünden büyük bir arıza.
//
// ⚠️ KOLON GENİŞLİĞİ DE UYARIYA GİRMEZ ve bu ÖLÇÜLDÜ: 50 serinin 49'unda kolonda
// 18–61 fazla hane var (sıra 10^18 katına çıkmadan dolmaz), en dar pay
// `packingLotCode`ta 3 hane. Gerçek bir SERT SINIR ama pratik bir TÜKENME riski
// değil ⇒ KAPI olarak duruyor (`NUMBER_SERIES_CODE_TOO_LONG`), uyarı olarak değil.
//
// ⚠️ YÜZDE YÜRÜRLÜKTEKİ DÖNEMİN kullanımıdır: tarih segmentli seride sayaç her
// gün/ay/yıl sıfırlandığı için "bugüne kadarki toplam" anlamsızdır; ölçülen şey
// YÜRÜRLÜKTEKİ dizgi uzayında kullanılmış en büyük sıradır.
// =============================================================================
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import prisma from "../../lib/prisma";
import { resolveSeriesFormat, seriesUsedMaxFrom } from "../number-series.service";
import { MAX_ROLL_SEQ, rollBarcodePrefix } from "./roll-barcode.helper";
import { seriesPrefix } from "./series-format.helper";

/** %90 ve üstü uyarı üretir. Eşik burada, iki yüzey de buradan okur. */
export const EXHAUSTION_WARN_RATIO = 0.9;

export interface SeriesExhaustion {
  key: string;
  label: string;
  /** Sert sınır; `null` = sınır tanımlı değil ⇒ yüzde ÖLÇÜLEMEDİ. */
  limit: number | null;
  /** Yürürlükteki dönemde kullanılmış en büyük sıra. */
  used: number | null;
  percent: number | null;
  warn: boolean;
  /** Sınırın NEREDEN geldiği — panelde cümle bundan kurulur. */
  source: "maxValue" | "rollCounter" | null;
  /** Ölçülemediyse GEREKÇE (üçüncü sonuç sessiz kalmaz). */
  reason?: string;
}

/**
 * Top barkodu — `ownCounter` olduğu için sayaç AYARLARI kapalı, ama TÜKENME
 * sorusu burada en anlamlı yerinde: `MAX_ROLL_SEQ` gerçek bir GÜNLÜK kapasite
 * (gün+tip başına 9.999) ve dolduğunda üretim durur.
 */
async function rollExhaustion(label: string, at: Date): Promise<SeriesExhaustion> {
  const gun = rollBarcodePrefix("H", at).slice(1, 7);
  const rows = await prisma.rollBarcodeCounter.findMany({
    where: { day: gun },
    select: { type: true, n: true },
  });
  const used = rows.reduce((m, r) => (r.n > m ? r.n : m), 0);
  const percent = used / MAX_ROLL_SEQ;
  return {
    key: "roll", label, limit: MAX_ROLL_SEQ, used, percent,
    warn: percent >= EXHAUSTION_WARN_RATIO, source: "rollCounter",
  };
}

/** Bir serinin yürürlükteki dönemdeki tükenme durumu. */
export async function seriesExhaustion(key: string, at: Date = new Date()): Promise<SeriesExhaustion> {
  const entry = numberSeriesCatalogEntry(key);
  if (key === "roll") return rollExhaustion(entry.label, at);

  const fmt = resolveSeriesFormat(key);
  const limit = fmt.maxValue ?? null;
  if (limit === null) {
    return {
      key, label: entry.label, limit: null, used: null, percent: null, warn: false, source: null,
      reason: "Bu seride üst sınır tanımlı değil; numara 9999'u aşınca hane genişler, sayaç dolmaz.",
    };
  }
  if (!entry.countTable) {
    return {
      key, label: entry.label, limit, used: null, percent: null, warn: false, source: "maxValue",
      reason: "Bu serinin sayım kaynağı beyan edilmemiş; kullanılan sıra ölçülemiyor.",
    };
  }
  const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> }>)[
    entry.countTable.model
  ];
  if (!delegate) {
    return {
      key, label: entry.label, limit, used: null, percent: null, warn: false, source: "maxValue",
      reason: "Sayım kaynağı okunamadı.",
    };
  }
  const full = seriesPrefix(fmt, at);
  const alan = entry.countTable.field;
  const rows = await delegate.findMany({
    where: { [alan]: { gte: full, startsWith: full } },
    select: { [alan]: true },
  });
  // ⚠️ `seriesSeqFrom` DEĞİL: o SIRADAKİNİ verir ve sınır dolduğunda 409 fırlatır,
  // yani tam %100'de bu uç cevap yerine hata döndürürdü. Kullanılan sıra bir
  // GÖZLEMDİR, bir talep değil.
  const used = seriesUsedMaxFrom(rows.map((r) => r[alan] as string | null), full);
  const percent = used / limit;
  return {
    key, label: entry.label, limit, used, percent,
    warn: percent >= EXHAUSTION_WARN_RATIO, source: "maxValue",
  };
}

/**
 * `/api/admin/health` yüzeyi — YALNIZ uyarı üretenler.
 *
 * ⚠️ Maliyet ölçülü: sorgu YALNIZ sınırı olan serilere gider (bugün `roll` ve
 * fabrikanın elle sınır koyduğu seriler). Sınırsız seri tek bir senkron okumayla
 * elenir, DB'ye hiç gidilmez.
 */
export async function seriesExhaustionWarnings(at: Date = new Date()): Promise<SeriesExhaustion[]> {
  const out: SeriesExhaustion[] = [];
  for (const e of NUMBER_SERIES_CATALOG) {
    if (e.key !== "roll" && (resolveSeriesFormat(e.key).maxValue ?? null) === null) continue;
    const d = await seriesExhaustion(e.key, at);
    if (d.warn) out.push(d);
  }
  return out;
}
