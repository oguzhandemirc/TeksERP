// =============================================================================
// Temel raporlar (Raporlar v2) — ortak kurucu parçalar (saf; DB'siz)
// =============================================================================
// Temel rapor SAYI ÜRETMEZ: her sayı mevcut rapor servisinin alanından okunur (bekçi
// `test_temel_rapor_esitlik`). Burada yalnız zarfın tekrar eden parçaları kurulur: ölçü
// adı/birimi/iyi yönü tanım sözlüğünden, başlık/soru katalogdan, tablo satır tavanı.

import { z } from "zod";
import { REPORT_BY_KEY, type ReportKey, type ReportVaryantBoyutu } from "../../../constants/report-catalog";
import { OLCU_BY_KIMLIK, type OlcuIyiYon, type OlcuBirimi } from "../semantik/tanimlar";
import { anaSayiKur, donemEtiketi } from "../sunum/sunum-kur";
import type { AnaSayi, Birim, DonemAraligi, IyiYon, ParametreBeyani, ParametreSecenegi, RaporSunumu, RaporTanimi, TabloBlok } from "../sunum/sunum.types";
import type { SuzgecEcho } from "../_filters";
import type { Secenek } from "../_secenekler";
import { capReportLists, resolveCompareRange, type CompareMode, type DateRange } from "../_shared";

const UNIT_MAP: Readonly<Record<Exclude<OlcuBirimi, "para">, Birim>> = {
  metre: "m",
  kg: "kg",
  yuzde: "yuzde",
  adet: "adet",
  gun: "gun",
  dakika: "dakika",
};

const DIRECTION_MAP: Readonly<Record<OlcuIyiYon, IyiYon>> = { artis: "yukari", azalis: "asagi", notr: "notr" };

/** Tanım sözlüğünde olmayan kimlik bir programlama hatasıdır — sessizce uydurulmaz (fail-closed). */
function definitionOf(id: string) {
  const def = OLCU_BY_KIMLIK.get(id);
  if (!def) throw new Error(`Ölçü tanımı yok: ${id}`);
  return def;
}

/** Katalog satırının başlığı ve sorusu — zarf metni katalogla bayt-eşit kalsın. */
export function catalogHeader(key: ReportKey): { anahtar: string; baslik: string; soru: string } {
  const entry = REPORT_BY_KEY.get(key);
  if (!entry) throw new Error(`Rapor katalogda yok: ${key}`);
  return { anahtar: entry.key, baslik: entry.baslik, soru: entry.soru };
}

export function periodOf(range: DateRange): DonemAraligi {
  return { from: range.from.toISOString(), to: range.to.toISOString(), etiket: donemEtiketi(range) };
}

/**
 * Sözlükteki ölçüden ana/yan sayı kartı. `birim` yalnız sözlük birimi "para" ise ya da ölçü
 * sözlükte başka bir sayım birimiyle (sipariş) gösteriliyorsa verilir.
 */
export function metricFigure(
  id: string,
  value: number | null,
  opts: { previous?: number | null; unit?: Birim; unmeasured?: string; name?: string } = {},
): AnaSayi {
  const def = definitionOf(id);
  const unit = opts.unit ?? (def.birim === "para" ? null : UNIT_MAP[def.birim]);
  if (!unit) throw new Error(`Para birimli ölçü için birim verilmeli: ${id}`);
  return anaSayiKur({
    olcu: id,
    ad: opts.name ?? def.ad,
    deger: value,
    birim: unit,
    olculemedi: opts.unmeasured,
    onceki: opts.previous,
    iyiYon: DIRECTION_MAP[def.iyiYon],
  });
}

/** Sözlükte ayrı tanımı olmayan yardımcı sayı (ör. "Aktif sipariş") — ölçü kimliği raporun içindedir. */
export function plainFigure(
  id: string,
  name: string,
  value: number | null,
  opts: { unit: Birim; previous?: number | null; direction?: IyiYon; unmeasured?: string },
): AnaSayi {
  return anaSayiKur({
    olcu: id,
    ad: name,
    deger: value,
    birim: opts.unit,
    olculemedi: opts.unmeasured,
    onceki: opts.previous,
    iyiYon: opts.direction ?? "notr",
  });
}

/** Raporda geçen ölçülerin günlük dil tanımları (sözlükten; sıra verilen sıradır). */
export function definitionsOf(ids: readonly string[]): RaporTanimi[] {
  return ids.map((id) => {
    const def = definitionOf(id);
    return { ad: def.ad, aciklama: def.aciklama };
  });
}

/** Tabloyu rapor satır tavanına keser; kesildiyse `kesildi` + Türkçe uyarı (sessiz kesme yok). */
export function capTable(table: TabloBlok, label: string): { tablo: TabloBlok; uyarilar: string[] } {
  const { data, warnings } = capReportLists({ satirlar: table.satirlar }, [["satirlar", label]]);
  if (warnings.length === 0) return { tablo: table, uyarilar: [] };
  return {
    tablo: { ...table, satirlar: data.satirlar, kesildi: { gosterilen: data.satirlar.length, toplam: table.satirlar.length } },
    uyarilar: warnings,
  };
}

/** Tek para birimli tutar listesinden yan sayı birimi; çok birim ya da desteklenmeyen birim → `null`. */
export function singleCurrencyUnit(amounts: ReadonlyArray<{ currency: string }>): Birim | null {
  if (amounts.length !== 1) return null;
  const c = amounts[0].currency;
  return c === "TRY" || c === "USD" || c === "EUR" ? c : null;
}

const COMPARE_OPTIONS = [
  { deger: "none", etiket: "Kıyas yok" },
  { deger: "prev", etiket: "Önceki dönem" },
  { deger: "prevYear", etiket: "Geçen yıl aynı dönem" },
  { deger: "custom", etiket: "Seçilen dönem" },
];

/**
 * K-KIYAS: kıyas varsayılanının TEK kaynağı sunucudur — `kiyas` verilmezse "önceki dönem"
 * uygulanır; istemci varsayılan yazmaz, çipi `parametreler[]`teki `kiyas` beyanından çizer.
 */
export function resolveCoreCompare(input: CoreRangeQuery, range: DateRange): { mode: CompareMode; compareRange: DateRange | null } {
  const mode: CompareMode = input.kiyas ?? "prev";
  return { mode, compareRange: resolveCompareRange({ compare: mode }, range) };
}

/** Dönem + kıyas parametre beyanı; kıyasın anahtarı `kiyas`, `deger` UYGULANAN kip, `secenekler` diğerleri dahil hepsi. */
export function rangeParameters(range: DateRange, compareMode: CompareMode): ParametreBeyani[] {
  return [
    { ad: "dateFrom", etiket: "Başlangıç", tur: "tarih", deger: range.from.toISOString() },
    { ad: "dateTo", etiket: "Bitiş", tur: "tarih", deger: range.to.toISOString() },
    { ad: "kiyas", etiket: "Kıyas", tur: "secim", deger: compareMode, secenekler: COMPARE_OPTIONS },
  ];
}

const FILTER_LABELS: Readonly<Record<string, string>> = { customerId: "Müşteri", itemId: "Kumaş" };

/** Kaynak raporun seçici listesi → çip seçenekleri (kodlu kalemde "KOD · ad"). */
export function optionsOf(list: readonly Secenek[] | undefined): ParametreSecenegi[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((o) => ({ deger: o.id, etiket: o.kod ? `${o.kod} · ${o.ad}` : o.ad }));
}

/** Kimlik listesi süzgeci beyanı — seçim yoksa `null` ("Tümü"), boş dizi yazılmaz; seçenek varsa panel çip çizer. */
export function listParameter(name: "customerId" | "itemId", value: string[] | undefined, options?: readonly Secenek[]): ParametreBeyani {
  const secenekler = optionsOf(options);
  return { ad: name, etiket: FILTER_LABELS[name], tur: "cokluSecim", deger: value && value.length > 0 ? value : null, ...(secenekler ? { secenekler } : {}) };
}

/** Kırılım satırlarından büyükten küçüğe varyant havuzu (`key` = süzgeç kimliği). */
export function rankedPool<T extends { key: string; label: string }>(rows: readonly T[], size: (r: T) => number): ParametreSecenegi[] {
  return [...rows].sort((a, b) => size(b) - size(a)).map((r) => ({ deger: r.key, etiket: r.label }));
}

/** Yön süzgeci beyanı. */
export function destinationParameter(value: string | undefined, label = "Yön"): ParametreBeyani {
  return {
    ad: "destination",
    etiket: label,
    tur: "secim",
    deger: value ?? null,
    secenekler: [
      { deger: "DOMESTIC", etiket: "Yurtiçi" },
      { deger: "EXPORT", etiket: "Yurtdışı" },
    ],
  };
}

/** Temel rapor servisinin çıktısı: sunum zarfı + zarfın kökündeki `suzgec` beyanı (kaynak ucun biçimi). */
export interface CoreReportResult {
  sunum: RaporSunumu;
  suzgec?: SuzgecEcho;
  /** Varyant havuzu: ana koşunun kırılımından boyut başına değerler, büyükten küçüğe (yalnız sarmal okur; tele gitmez). */
  kirilimlar?: Partial<Record<ReportVaryantBoyutu, ParametreSecenegi[]>>;
}

/**
 * K-TEL: rapor v2 uçlarının ORTAK sorgu teli — tel anahtarları Türkçe (`kiyas`; `compare` GEÇERSİZ). Kıyas
 * kipleri panelin çipindeki `COMPARE_OPTIONS` ile aynı (özel aralık v2 telinde yok). Bekçi: `test_rapor_tel_anahtari`.
 */
export const coreRangeQuerySchema = z
  .object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    kiyas: z.enum(["none", "prev", "prevYear"]).optional(),
  })
  .strict();
export type CoreRangeQuery = z.infer<typeof coreRangeQuerySchema>;
