// =============================================================================
// RAPOR — Kurşun gramajı (KQ-D6): fabrika günü × gramaj × kumaş × makine × operatör
// =============================================================================
// Kendi sorgusu YOK: uygulamalar `listKursunApplications`ten, özet şeridi
// `aggregateKursunApplications`tan gelir — İE kartı ve parti iziyle AYNI çift,
// sayılar bayt-eşit (`test_process_summary §2`). Süzme SUNUCUDA; liste, sayfa ve
// şerit AYNI süzülmüş kümeden kurulur. Gün anahtarı `factoryYmd` (constants/time.ts).
// =============================================================================
import { Prisma } from "@prisma/client";
import { resolveCompareRange, type DateRange } from "./_shared";
import { anaSayiKur, donemEtiketi } from "./sunum/sunum-kur";
import type { AnlatiCumlesi, ParametreBeyani, RaporSunumu, TabloBlok } from "./sunum/sunum.types";
import { loadKursunGramajOptions } from "../helpers/kursun-bypass-gramaj.helper";
import {
  aggregateKursunApplications,
  listKursunApplications,
  type KursunApplication,
  type KursunSource,
  type KursunSummary,
  UNKNOWN_GRAMAJ_LABEL,
} from "../helpers/process-summary.helper";

export interface KursunGramajFilters {
  /** `none` → "gramaj bilinmiyor" satırları. */
  valueId?: string;
  source?: KursunSource;
  workOrderId?: string;
  cursor?: number;
  limit?: number;
}

export interface KursunGramajReportRow {
  day: string;
  source: KursunSource;
  valueId: string | null;
  valueName: string;
  itemName: string;
  machineName: string | null;
  operatorName: string | null;
  rollCount: number;
  meters: string;
  deviatesFromTarget: boolean;
}

export interface KursunGramajReport {
  summary: Omit<KursunSummary, "target">;
  rows: KursunGramajReportRow[];
  totalRows: number;
  nextCursor: number | null;
}

function matches(a: KursunApplication, f: KursunGramajFilters): boolean {
  if (f.source && a.source !== f.source) return false;
  if (f.valueId === "none") return a.valueId === null;
  if (f.valueId) return a.valueId === f.valueId;
  return true;
}

function groupRows(apps: KursunApplication[]): KursunGramajReportRow[] {
  const groups = new Map<string, KursunGramajReportRow & { sum: Prisma.Decimal; sort: number }>();
  for (const a of apps) {
    const key = [a.day, a.source, a.valueId ?? "-", a.itemName, a.machineName ?? "-", a.operatorName ?? "-"].join("|");
    const g = groups.get(key) ?? {
      day: a.day, source: a.source, valueId: a.valueId, valueName: a.valueName, itemName: a.itemName,
      machineName: a.machineName, operatorName: a.operatorName, rollCount: 0, meters: "0.00",
      deviatesFromTarget: false, sum: new Prisma.Decimal(0), sort: a.valueSortOrder,
    };
    g.rollCount += 1;
    g.sum = g.sum.plus(a.meters);
    g.deviatesFromTarget ||= a.deviatesFromTarget;
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((x, y) => y.day.localeCompare(x.day) || x.source.localeCompare(y.source) || x.sort - y.sort
      || x.itemName.localeCompare(y.itemName, "tr") || (x.machineName ?? "").localeCompare(y.machineName ?? "", "tr")
      || (x.operatorName ?? "").localeCompare(y.operatorName ?? "", "tr"))
    .map(({ sum, sort: _s, ...r }) => ({ ...r, meters: sum.toFixed(2) }));
}

export async function getKursunGramajReport(range: DateRange, filters: KursunGramajFilters): Promise<KursunGramajReport> {
  const apps = (await listKursunApplications({ from: range.from, to: range.to, workOrderId: filters.workOrderId }))
    .filter((a) => matches(a, filters));
  const all = groupRows(apps);
  const start = filters.cursor ?? 0;
  const limit = filters.limit ?? 100;
  const end = start + limit;
  return {
    summary: aggregateKursunApplications(apps),
    rows: all.slice(start, end),
    totalRows: all.length,
    nextCursor: end < all.length ? end : null,
  };
}

// ── v2 sunumu (R0 genel yaprak) ─────────────────────────────────────────────
// Ana sayı ve kıyas AYNI `getKursunGramajReport`tan (tek kaynak); kıyas varsayılanını
// SUNUCU uygular ve `parametreler[]`te beyan eder (K-KIYAS). Kişi adı satırda yalnız bilgi.

export const KURSUN_KIYAS_MODLARI = ["prev", "prevYear", "none"] as const;
export type KursunKiyas = (typeof KURSUN_KIYAS_MODLARI)[number];

export interface KursunGramajSunumGirdisi {
  kiyas?: KursunKiyas;
  gramaj?: string;
  kaynak?: KursunSource;
  workOrderId?: string;
}

const TABLE_ROW_CAP = 500;
const KAYNAK_ETIKETI: Record<KursunSource, string> = { TABLET: "Tablet", KAGIT: "Kâğıt" };
const KIYAS_SECENEKLERI = [
  { deger: "prev", etiket: "Önceki dönem" },
  { deger: "prevYear", etiket: "Geçen yıl aynı dönem" },
  { deger: "none", etiket: "Kıyas yok" },
];

const sayi = (m: string): number => Number(m);
/** Fabrika günü anahtarı (YYYY-MM-DD) → ekran/Excel metni "23.10.2026". */
const gunMetni = (ymd: string): string => ymd.split("-").reverse().join(".");

function parametreBeyani(kiyas: KursunKiyas, g: KursunGramajSunumGirdisi, options: Array<{ id: string; name: string }>): ParametreBeyani[] {
  return [
    { ad: "kiyas", etiket: "Kıyas", tur: "secim", deger: kiyas, secenekler: KIYAS_SECENEKLERI },
    { ad: "gramaj", etiket: "Gramaj", tur: "secim", deger: g.gramaj ?? null,
      secenekler: [...options.map((o) => ({ deger: o.id, etiket: o.name })), { deger: "none", etiket: UNKNOWN_GRAMAJ_LABEL }] },
    { ad: "kaynak", etiket: "Kaynak", tur: "secim", deger: g.kaynak ?? null,
      secenekler: [{ deger: "TABLET", etiket: "Tablet" }, { deger: "KAGIT", etiket: "Kâğıt" }] },
  ];
}

export async function buildKursunGramajSunumu(range: DateRange, g: KursunGramajSunumGirdisi): Promise<RaporSunumu> {
  const kiyas: KursunKiyas = g.kiyas ?? "prev";
  const filters: KursunGramajFilters = { valueId: g.gramaj, source: g.kaynak, workOrderId: g.workOrderId, limit: TABLE_ROW_CAP };
  const kiyasRange = resolveCompareRange({ compare: kiyas }, range);
  const [rep, once, options] = await Promise.all([
    getKursunGramajReport(range, filters),
    kiyasRange ? getKursunGramajReport(kiyasRange, { ...filters, limit: 1 }) : Promise.resolve(null),
    loadKursunGramajOptions(),
  ]);
  const totalRolls = rep.summary.totals.rollCount;
  const sapanTop = rep.summary.rows.filter((r) => r.deviatesFromTarget).reduce((n, r) => n + r.rollCount, 0);
  const bilinmeyenTop = rep.summary.rows.filter((r) => r.valueId === null).reduce((n, r) => n + r.rollCount, 0);

  const tablo: TabloBlok = {
    kolonlar: [
      { anahtar: "gun", baslik: "Gün" },
      { anahtar: "gramaj", baslik: "Gramaj" },
      { anahtar: "kaynak", baslik: "Kaynak" },
      { anahtar: "kumas", baslik: "Kumaş" },
      { anahtar: "makine", baslik: "Makine" },
      { anahtar: "operator", baslik: "Operatör" },
      { anahtar: "top", baslik: "Adet", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
      { anahtar: "sapma", baslik: "Hedeften sapma" },
    ],
    satirlar: rep.rows.map((r) => ({
      gun: gunMetni(r.day), gramaj: r.valueName, kaynak: KAYNAK_ETIKETI[r.source], kumas: r.itemName,
      makine: r.machineName, operator: r.operatorName, top: r.rollCount, metre: sayi(r.meters),
      sapma: r.deviatesFromTarget ? "Sapma var" : null,
    })),
    toplam: { gun: "Toplam", top: totalRolls, metre: sayi(rep.summary.totals.meters) },
    ...(rep.totalRows > rep.rows.length ? { kesildi: { gosterilen: rep.rows.length, toplam: rep.totalRows } } : {}),
  };

  // Gramaj kırılımı (tablet + kâğıt birlikte) — grafik kategorisi.
  const gramajTop = new Map<string, number>();
  for (const r of rep.summary.rows) gramajTop.set(r.valueName, (gramajTop.get(r.valueName) ?? 0) + r.rollCount);

  const anlati: AnlatiCumlesi[] = [];
  if (sapanTop > 0) {
    anlati.push({ kural: "kursun.hedefSapma", onem: Math.min(1, sapanTop / Math.max(1, totalRolls)),
      metin: `${sapanTop} topa terbiye iş emrinin hedef gramajından farklı kurşun basıldı.`, kanit: { sapanTop, totalRolls } });
  }
  if (bilinmeyenTop > 0) {
    anlati.push({ kural: "kursun.gramajBilinmiyor", onem: Math.min(1, bilinmeyenTop / Math.max(1, totalRolls)) / 2,
      metin: `${bilinmeyenTop} topun gramajı bilinmiyor (kâğıtla dağıtılıp gramaj girilmemiş).`, kanit: { bilinmeyenTop, totalRolls } });
  }
  anlati.sort((a, b) => b.onem - a.onem);

  return {
    anahtar: "production/kursun-gramaj",
    baslik: "Kurşun Gramajı",
    soru: "Hangi gün hangi kumaşa hangi makinede kaç gram kurşun basıldı, hedeften sapan oldu mu?",
    donem: { from: range.from.toISOString(), to: range.to.toISOString(), etiket: donemEtiketi(range) },
    ...(kiyasRange ? { kiyasDonemi: { from: kiyasRange.from.toISOString(), to: kiyasRange.to.toISOString(), etiket: donemEtiketi(kiyasRange) } } : {}),
    anaSayi: anaSayiKur({ olcu: "kursun.top", ad: "Kurşunlanan top", deger: totalRolls, birim: "top", iyiYon: "notr",
      ...(kiyasRange ? { onceki: once ? once.summary.totals.rollCount : null } : {}) }),
    yanSayilar: [
      anaSayiKur({ olcu: "kursun.metre", ad: "Kurşunlanan metre", deger: sayi(rep.summary.totals.meters), birim: "m", iyiYon: "notr" }),
      anaSayiKur({ olcu: "kursun.hedefSapan", ad: "Hedeften sapan top", deger: sapanTop, birim: "top", iyiYon: "asagi" }),
      anaSayiKur({ olcu: "kursun.gramajBilinmiyor", ad: "Gramajı bilinmeyen top", deger: bilinmeyenTop, birim: "top", iyiYon: "asagi" }),
    ],
    anlati,
    grafik: gramajTop.size === 0 ? null : {
      tur: "cubuk",
      eksen: { x: { ad: "Gramaj", tur: "kategori" }, y: { ad: "Adet", birim: "top" } },
      kategoriler: [...gramajTop.keys()],
      seriler: [{ ad: "Top", veri: [...gramajTop.values()] }],
    },
    tablo,
    tanimlar: [
      { ad: "Kurşunlanan top", aciklama: "Dönemde kurşun basılan top × adım sayısı; tablette basılan ve kâğıtla dağıtılıp tamamlanan birlikte. Geri alınmış ve üst toptan miras kalan basımlar sayılmaz." },
      { ad: "Hedeften sapma", aciklama: "Terbiye iş emrine hedef gramaj verildiyse ve basılan gramaj ondan farklıysa işaretlenir; üretimi durdurmaz." },
      { ad: "Gramaj bilinmiyor", aciklama: "Kâğıtla dağıtılan işte gramaj girilmemişse bu satıra düşer." },
    ],
    parametreler: parametreBeyani(kiyas, g, options),
    uyarilar: [],
  };
}
