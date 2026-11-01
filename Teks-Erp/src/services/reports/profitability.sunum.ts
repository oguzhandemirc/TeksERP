// =============================================================================
// KÂRLILIK RAPORU — v2 sunum zarfı (ekran = Excel = PDF; D4-G3, DALGA4 §8.6/§8.8)
// =============================================================================
// Hesap `helpers/profitability.helper.ts`te (tek kaynak); burası yalnız kırılıma toplar ve biçimler.
// SAF: ad sözlükleri çağırandan gelir (bekçi DB'siz ölçer). Eksik girdili iş 0 YAZILMAZ: hücre boş,
// "Durum" kolonunda "eksik: …" rozeti; ayar okuma anında uygulanır, özeti `hesap` beyanında yazılır.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { ParametreBeyani, RaporSunumu, TabloBlok, TabloHucresi, TabloKolonu } from "./sunum/sunum.types";
import { catalogHeader, metricFigure, periodOf } from "./temel/_common";
import { dayRangeParameters, type ResolvedDayRange } from "./temel/_day-range";
import { anlatiUret } from "./anlati/anlati";
import { resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import {
  summarizeProfitability, type ProfitabilityResult, type ProfitabilityRow, type ProfitGroupBy, type ProfitMissingCode,
} from "../helpers/profitability.helper";

export const PROFITABILITY_KEY = "maliyet/karlilik";
export const PROFIT_BREAKDOWNS = ["musteri", "islem", "makine", "ay", "is"] as const;
export type ProfitBreakdown = (typeof PROFIT_BREAKDOWNS)[number];
/** "iş" kırılımında ekrana basılan satır tavanı; toplam ve ana sayı TAM kümeden. */
export const PROFIT_WORK_ROW_LIMIT = 500;

const BREAKDOWN_LABEL: Record<ProfitBreakdown, string> = { musteri: "Müşteri", islem: "İşlem", makine: "Makine", ay: "Ay", is: "İş" };
const GROUP_BY: Record<Exclude<ProfitBreakdown, "is">, ProfitGroupBy> = { musteri: "customer", islem: "serviceItem", makine: "machine", ay: "month" };

export const MISSING_LABEL: Record<ProfitMissingCode, string> = {
  SARF_NORMU: "sarf normu", SARF_FIYATI: "sarf fiyatı", FX_RATE_MISSING: "döviz kuru", DIS_FASON_FATURASI: "dış fason faturası",
  DIS_FASON_TARIFESI: "dış fason tarifesi", DIS_FASON_MAKBUZU: "dış fason kabulü", GELIR_SATIRI: "fatura satırı",
  MAKINE_TARIFESI: "makine saat ücreti", MAKINE_NORMU: "makine metre/saat normu", MAKINE_SURESI: "makine süresi",
  MAKINE_METRESI: "makine metresi", VARDIYA_TAKVIMI: "vardiya takvimi",
};

export interface ProfitNames {
  customers: Map<string, string>;
  serviceItems: Map<string, string>;
  machines: Map<string, string>;
  rolls: Map<string, string>;
}

const MONTH_NAMES = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const monthName = (ym: string): string => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const tl = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d.toFixed(2)));
const D0 = () => new Prisma.Decimal(0);
const TR_NUMBER = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
/** Uyarı cümlesindeki sayı (Türkçe ayraç); tablo hücresi ham sayıdır, biçimi panel/Excel verir. */
const say = (d: Prisma.Decimal | null): string => (d === null ? "?" : TR_NUMBER.format(Number(d.toFixed(2))));
const add = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => (a === null || b === null ? null : a.plus(b));

/** Ayarın okuma anındaki özeti — ekran/Excel/PDF başlığına "hesap: …" olarak girer (§8.6). */
export function settingsSummary(s: ProfitabilityResult["settings"]): string {
  const machine = { OTURUM: "makine süresi iş oturumundan", VARDIYA: "makine süresi vardiya takviminden", NORM: "makine süresi metre/saat normundan" }[s.machineTime];
  const overhead = { YOK: "genel gider dağıtılmıyor", METRE: "genel gider metreye göre", GELIR: "genel gider gelire göre", MAKINE_SAATI: "genel gider makine saatine göre" }[s.overheadKey];
  const sub = { FATURA_ONCE: "dış fason faturadan (yoksa tarifeden, tahmini)", YALNIZ_FATURA: "dış fason yalnız faturadan" }[s.subcontractSource];
  const cons = { ALIS_FIYATI: "sarf fiyatı alış fiyatından", SON_ALIS_FATURASI: "sarf fiyatı son alış faturasından" }[s.consumablePriceSource];
  const labor = Object.entries(s.categoryClasses).filter(([, c]) => c === "ISCILIK").map(([k]) => k).sort();
  return [machine, overhead, sub, cons, labor.length ? `işçilik: ${labor.join(", ")}` : "işçilik kategorisi yok"].join(" · ");
}

/** Kırılım satırı — panel tablosu ve patron `karlilik-ozet` anlığı AYNI gruplamadan (D4-G4). */
export interface Group {
  label: string; meters: Prisma.Decimal; revenue: Prisma.Decimal; consumable: Prisma.Decimal | null; subcontract: Prisma.Decimal | null;
  machine: Prisma.Decimal | null; contribution: Prisma.Decimal | null; labor: Prisma.Decimal; overhead: Prisma.Decimal; net: Prisma.Decimal | null;
  missing: Set<ProfitMissingCode>; estimated: boolean;
  /** D4-G2c: masraf bağından doğrudan masraf (bağ yoksa alan yok → tablo bayt-aynı). */
  direct?: Prisma.Decimal;
}

function labelOf(by: Exclude<ProfitBreakdown, "is">, key: string | null, names: ProfitNames): string {
  if (by === "ay") return key ? monthName(key) : "—";
  if (key === null) return by === "musteri" ? "Müşterisiz" : by === "makine" ? "Makinesi belli değil" : "—";
  const map = by === "musteri" ? names.customers : by === "islem" ? names.serviceItems : names.machines;
  return map.get(key) ?? "—";
}

function rowKey(by: Exclude<ProfitBreakdown, "is">, r: ProfitabilityRow): string | null {
  return by === "musteri" ? r.customerId : by === "islem" ? r.serviceItemId : by === "makine" ? r.machineId : r.month;
}

/** Kırılım grupları: tutarlar helper'ın `summarizeProfitability`sinden; metre ve rozet aynı anahtarla. */
export function profitGroups(rows: ProfitabilityRow[], by: ProfitBreakdown, names: ProfitNames): Group[] {
  if (by === "is") {
    return rows.map((r) => ({
      label: `${names.rolls.get(r.rollId) ?? "—"} · ${names.serviceItems.get(r.serviceItemId) ?? "—"} · ${r.docNo}${r.kind === "CANCELLED" ? " (iptal)" : ""}`,
      meters: r.meters, revenue: r.revenueTry, consumable: r.consumableTry, subcontract: r.subcontractTry, machine: r.machineTry,
      contribution: r.contributionTry, labor: r.laborTry, overhead: r.overheadTry, net: r.netTry, missing: new Set(r.missing), estimated: r.subcontractEstimated,
      ...(r.directExpenseTry ? { direct: r.directExpenseTry } : {}),
    }));
  }
  const side = new Map<string | null, { meters: Prisma.Decimal; missing: Set<ProfitMissingCode> }>();
  for (const r of rows) {
    const k = rowKey(by, r);
    const s = side.get(k) ?? { meters: D0(), missing: new Set<ProfitMissingCode>() };
    s.meters = s.meters.plus(r.meters);
    r.missing.forEach((c) => s.missing.add(c));
    side.set(k, s);
  }
  return summarizeProfitability(rows, GROUP_BY[by]).map((g) => ({
    label: labelOf(by, g.key, names), meters: side.get(g.key)!.meters, revenue: g.revenueTry, consumable: g.consumableTry,
    subcontract: g.subcontractTry, machine: g.machineTry, contribution: g.contributionTry, labor: g.laborTry, overhead: g.overheadTry,
    net: g.netTry, missing: side.get(g.key)!.missing, estimated: g.estimatedRows > 0, ...(g.directExpenseTry ? { direct: g.directExpenseTry } : {}),
  }));
}

export function totalOf(groups: Group[]): Group {
  return groups.reduce<Group>((t, g) => ({
    label: "Toplam", meters: t.meters.plus(g.meters), revenue: t.revenue.plus(g.revenue), consumable: add(t.consumable, g.consumable),
    subcontract: add(t.subcontract, g.subcontract), machine: add(t.machine, g.machine), contribution: add(t.contribution, g.contribution),
    labor: t.labor.plus(g.labor), overhead: t.overhead.plus(g.overhead), net: add(t.net, g.net),
    missing: new Set([...t.missing, ...g.missing]), estimated: t.estimated || g.estimated,
    ...(t.direct || g.direct ? { direct: (t.direct ?? D0()).plus(g.direct ?? D0()) } : {}),
  }), { label: "Toplam", meters: D0(), revenue: D0(), consumable: D0(), subcontract: D0(), machine: D0(), contribution: D0(), labor: D0(), overhead: D0(), net: D0(), missing: new Set(), estimated: false });
}

/** Rozet metni: eksik girdi adları, yoksa tahmini dış fason. */
export function badgeOf(g: Pick<Group, "missing" | "estimated">): string {
  if (g.missing.size > 0) return `eksik: ${[...g.missing].sort().map((c) => MISSING_LABEL[c]).join(", ")}`;
  return g.estimated ? "tahmini" : "";
}

const cellsOf = (g: Group, withDirect: boolean): Record<string, TabloHucresi> => ({
  ad: g.label, metre: Number(g.meters.toFixed(2)), gelir: tl(g.revenue), sarf: tl(g.consumable), makine: tl(g.machine), disFason: tl(g.subcontract),
  katki: tl(g.contribution), iscilik: tl(g.labor), genelGider: tl(g.overhead), ...(withDirect ? { dogrudanMasraf: tl(g.direct ?? D0()) } : {}),
  net: tl(g.net), durum: badgeOf(g),
});

export function profitTable(rows: ProfitabilityRow[], by: ProfitBreakdown, names: ProfitNames): TabloBlok {
  const groups = profitGroups(rows, by, names);
  const withDirect = groups.some((g) => g.direct !== undefined);
  const money = (anahtar: string, baslik: string): TabloKolonu => ({ anahtar, baslik, birim: "TRY", hiza: "sag" });
  const kolonlar: TabloKolonu[] = [
    { anahtar: "ad", baslik: BREAKDOWN_LABEL[by] }, { anahtar: "metre", baslik: "Metre", birim: "m", hiza: "sag" },
    money("gelir", "Kesinleşen gelir"), money("sarf", "İpe giden"), money("makine", "Makineye giden"), money("disFason", "Dışarıya ödenen"),
    money("katki", "Kalan (katkı)"), money("iscilik", "İşçilik"), money("genelGider", "Genel gider"),
    ...(withDirect ? [money("dogrudanMasraf", "Bağlı masraf")] : []), money("net", "Net"), { anahtar: "durum", baslik: "Durum" },
  ];
  const shown = by === "is" ? groups.slice(0, PROFIT_WORK_ROW_LIMIT) : groups;
  return {
    kolonlar, satirlar: shown.map((g) => cellsOf(g, withDirect)), toplam: cellsOf(totalOf(groups), withDirect),
    ...(shown.length < groups.length ? { kesildi: { gosterilen: shown.length, toplam: groups.length } } : {}),
  };
}

function warningsOf(r: ProfitabilityResult, rangeNotes: string[]): string[] {
  const w: string[] = [...rangeNotes];
  const draft = r.draftRows.reduce((a, d) => a.plus(d.revenueTry), D0());
  if (r.draftRows.length > 0) w.push(`Taslak faturalarda ${say(draft)} TL gelir var; kesinleşmediği için kâra girmedi.`);
  const cancelled = r.rows.filter((x) => x.kind === "CANCELLED").length;
  if (cancelled > 0) w.push(`${cancelled} iş iptal edilen faturadan geliyor; iptal edildiği ayda eksi yazıldı, eski ay değişmedi.`);
  const missing = r.rows.filter((x) => x.missing.length > 0).length;
  if (missing > 0) w.push(`${missing} işte eksik girdi var (Durum kolonunda "eksik"); bu işlerin kalanı hesaplanmadı, 0 sayılmadı.`);
  const idleHours = r.months.reduce((a, m) => a.plus(m.idleMachineHours), D0());
  if (idleHours.gt(0)) {
    const idleTry = r.months.some((m) => m.idleMachineTry === null) ? null : r.months.reduce((a, m) => a.plus(m.idleMachineTry!), D0());
    w.push(`Makineler ${say(idleHours)} saat iş metresi olmadan çalıştı (boşta makine${idleTry === null ? ", saat ücreti eksik" : `: ${say(idleTry)} TL`}); hiçbir işe yüklenmedi.`);
  }
  const undistributed = r.months.reduce((a, m) => a.plus(m.overheadPoolTry.minus(m.overheadDistributedTry)).plus(m.laborPoolTry.minus(m.laborDistributedTry)), D0());
  if (undistributed.gt(0)) w.push(`${say(undistributed)} TL genel gider/işçilik bu dönemde işlere dağıtılmadı (ayar ya da dağıtacak iş yok).`);
  const late = r.months.reduce((a, m) => a.plus(m.directExpenses?.lateAdjustmentTry ?? 0), D0());
  if (!late.isZero()) w.push(`Geç bağ düzeltmesi: önceki ayların masraflarına bu dönemde yapılan bağ değişikliği ${say(late)} TL doğrudan masrafa aktarıldı; eski ay değişmedi.`);
  const directLeft = r.months.reduce((a, m) => a.plus(m.directExpenses?.undistributedTry ?? 0), D0());
  if (!directLeft.isZero()) w.push(`${say(directLeft)} TL bağlı masrafın hedefinin (makine/iş emri/işlem) bu dönemde faturalanan işi yok; işlere yüklenmedi.`);
  return w;
}

/** Dönem tam aylarla hesaplanır — gün aralığı ay sınırına oturmuyorsa söylenir. */
export function monthsOfWindow(days: { from: string; to: string }): { fromMonth: string; toMonth: string } {
  return { fromMonth: days.from.slice(0, 7), toMonth: days.to.slice(0, 7) };
}

type MonthSpan = { fromMonth: string; toMonth: string };
const shiftMonth = (ym: string, by: number): string => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthCount = (m: MonthSpan): number =>
  (Number(m.toMonth.slice(0, 4)) - Number(m.fromMonth.slice(0, 4))) * 12 + Number(m.toMonth.slice(5, 7)) - Number(m.fromMonth.slice(5, 7)) + 1;
const lastDayOf = (ym: string): string => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Kıyas ayları ana dönemin TAM aylarından türer (gün penceresi aya genişleyince örtüşmesin); yine örtüşürse kıyas yok. */
export function compareMonthsOf(window: ResolvedDayRange): MonthSpan | null {
  if (!window.compareDays) return null;
  const main = monthsOfWindow(window.days);
  const cmp: MonthSpan = window.mode === "prev" ? { fromMonth: shiftMonth(main.fromMonth, -monthCount(main)), toMonth: shiftMonth(main.fromMonth, -1) }
    : window.mode === "prevYear" ? { fromMonth: shiftMonth(main.fromMonth, -12), toMonth: shiftMonth(main.toMonth, -12) }
    : monthsOfWindow(window.compareDays);
  return cmp.toMonth < main.fromMonth || cmp.fromMonth > main.toMonth ? cmp : null;
}

const monthsRange = (m: MonthSpan) => ({ from: resolveRangeStart(`${m.fromMonth}-01`), to: resolveRangeEnd(lastDayOf(m.toMonth)) });

// Bulut yolu "iş" kırılımını reddeder; beyan yalnız o yüzeyin kabul ettiği seçenekleri ilan eder.
export function breakdownParameter(selected: ProfitBreakdown, allowed: readonly ProfitBreakdown[] = PROFIT_BREAKDOWNS): ParametreBeyani {
  return { ad: "kirilim", etiket: "Kırılım", tur: "secim", deger: selected, secenekler: allowed.map((k) => ({ deger: k, etiket: BREAKDOWN_LABEL[k] })) };
}

export function buildProfitabilitySunumu(p: {
  result: ProfitabilityResult; previous: ProfitabilityResult | null; names: ProfitNames; window: ResolvedDayRange; breakdown: ProfitBreakdown;
  allowedBreakdowns?: readonly ProfitBreakdown[];
}): RaporSunumu {
  const { result, previous, names, window, breakdown } = p;
  const total = totalOf(profitGroups(result.rows, "ay", names));
  const prevTotal = previous ? totalOf(profitGroups(previous.rows, "ay", names)) : null;
  const m = monthsOfWindow(window.days);
  const cmpMonths = compareMonthsOf(window);
  const aligned = window.days.from.endsWith("-01") && window.days.to === lastDayOf(m.toMonth);
  const notes = [
    aligned ? null : `Kârlılık tam aylarla hesaplanır: ${monthName(m.fromMonth)} – ${monthName(m.toMonth)}${cmpMonths ? `; kıyas ${monthName(cmpMonths.fromMonth)} – ${monthName(cmpMonths.toMonth)}` : ""}.`,
    window.compareDays && !cmpMonths ? "Kıyas dönemi bu dönemin aylarıyla örtüştüğü için kıyas yapılmadı." : null,
  ].filter((x): x is string => x !== null);
  const missingRows = result.rows.filter((x) => x.missing.length > 0).length;
  const byCustomer = profitGroups(result.rows, "musteri", names);
  return {
    ...catalogHeader(PROFITABILITY_KEY),
    donem: periodOf(window.range),
    ...(cmpMonths && previous ? { kiyasDonemi: periodOf(monthsRange(cmpMonths)) } : {}),
    anaSayi: metricFigure("karlilik.katki", tl(total.contribution), {
      unit: "TRY", previous: prevTotal ? tl(prevTotal.contribution) : undefined,
      unmeasured: `${missingRows} işte eksik girdi var; "Durum" kolonundaki eksikler girilince hesaplanır`,
    }),
    yanSayilar: [
      metricFigure("karlilik.gelir", tl(total.revenue), { unit: "TRY", previous: prevTotal ? tl(prevTotal.revenue) : undefined }),
      metricFigure("karlilik.net", tl(total.net), { unit: "TRY", unmeasured: "Eksik girdili iş var" }),
      metricFigure("karlilik.makine", tl(total.machine), { unit: "TRY", unmeasured: "Eksik girdili iş var" }),
    ],
    anlati: byCustomer.length < 2 ? [] : anlatiUret({
      kirilim: { boyut: "musteri", birim: "TRY", adTuru: "ozel", ozneIlgi: "Kesinleşen gelirin", satirlar: byCustomer.map((g) => ({ ad: g.label, deger: tl(g.revenue)! })) },
    }, { kurallar: ["enBuyukPay"] }),
    grafik: null,
    tablo: profitTable(result.rows, breakdown, names),
    tanimlar: [
      { ad: "Kesinleşen gelir", aciklama: "Onaylı hizmet faturalarının KDV hariç TL tutarı, faturadaki metre payıyla işlere bölünür; taslak fatura girmez." },
      { ad: "İpe giden", aciklama: "İşin metresi kadar harcanması beklenen sarf (ip, kurşun…), sarf normu ve sarf fiyatıyla; gerçek tüketim değil, normdur." },
      { ad: "Makineye giden", aciklama: "Makinenin o gün çalıştığı saat ile saat ücreti, o günün ölçülen metresine bölünür." },
      { ad: "Dışarıya ödenen", aciklama: "Dış fasona verilen işin bedeli: fason faturası, ayar izin veriyorsa yoksa tarife (tahmini)." },
      { ad: "Kalan (katkı)", aciklama: "Kesinleşen gelirden ipe, makineye ve dışarıya giden çıkınca kalan." },
      { ad: "Net", aciklama: "Kalandan işçilik ve genel gider payı da düşülünce kalan; dağıtım anahtarı ayardadır." },
      { ad: "Eksik", aciklama: "Norm, fiyat, kur ya da saat ücreti girilmemiş iş; değeri sıfır sayılmaz, boş bırakılır." },
    ],
    parametreler: [
      ...dayRangeParameters(window.days, window.mode), breakdownParameter(breakdown, p.allowedBreakdowns),
      { ad: "hesap", etiket: "hesap", tur: "metin", deger: settingsSummary(result.settings) },
    ],
    uyarilar: warningsOf(result, notes),
  };
}
