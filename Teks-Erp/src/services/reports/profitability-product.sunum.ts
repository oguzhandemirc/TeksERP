// =============================================================================
// KÂRLILIK — "kapsam: kumaş" sunumu (K1 dilim 2; PLAN-karlilik-dokuma-1126 §2.5)
// =============================================================================
// Satırlar `profitability-product.helper`den (dilim 1 motoru); burası yalnız kırılıma TOPLAR ve biçimler —
// katkı hesaplamaz. Eksik parça 0 yazılmaz: hücre boş + "eksik: …" rozeti (K1.6 al-sat "dokuma işi yok").
// Havuz dağıtılmaz (K1.4): "kalan" = gelir − doğrudan maliyet; ekranda uyarı + tanım. SAF: ad sözlükleri çağırandan.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { ParametreBeyani, RaporSunumu, TabloBlok, TabloHucresi, TabloKolonu } from "./sunum/sunum.types";
import { catalogHeader, metricFigure, periodOf, plainFigure } from "./temel/_common";
import { dayRangeParameters, type ResolvedDayRange } from "./temel/_day-range";
import { anlatiUret } from "./anlati/anlati";
import { missingText } from "./weaving-efficiency.report";
import type { ProfitabilityResult, ProductMissingCode, ProductProfitRow } from "../helpers/profitability.helper";
import {
  comparePeriodOf, monthName, PROFIT_WORK_ROW_LIMIT, PROFITABILITY_KEY, profitGroups, rangeNotesOf, scopeParameter, settingsSummary, totalOf,
} from "./profitability.sunum";

type Dec = Prisma.Decimal;
export const PRODUCT_BREAKDOWNS = ["desen", "musteri", "ay", "is"] as const;
export type ProductBreakdown = (typeof PRODUCT_BREAKDOWNS)[number];
const LABEL: Record<ProductBreakdown, string> = { desen: "Desen", musteri: "Müşteri", ay: "Ay", is: "İş" };

/** Kumaş satışına özgü kodların günlük dili; dokuma kodları "Dokuma maliyeti" raporunun sözlüğünden (tek kaynak). */
const OWN_TEXT: Partial<Record<ProductMissingCode, string>> = {
  IPLIK_MALIYETI: "iplik maliyeti", DOKUMA_ISI_YOK: "dokuma işi yok", SEVK_BAGI_YOK: "sevk bağı yok", DIS_FASON: "boya/apre fasonu",
};
export const productMissingText = (c: ProductMissingCode): string => OWN_TEXT[c] ?? missingText(c as Parameters<typeof missingText>[0]);
const WARPING_CODES: readonly ProductMissingCode[] = ["DEVERE_UCRETI", "DEVERE_FATURASI", "COZGU_TUKETIMI", "LEVENT_KOKENI"];

export interface ProductNames {
  customers: Map<string, string>;
  items: Map<string, string>;
  weavingOrders: Map<string, string>;
}

export interface ProductGroup {
  label: string; meters: Dec; revenue: Dec; yarn: Dec | null; weaving: Dec | null; warping: Dec | null; subcontract: Dec | null;
  contribution: Dec | null; missing: Set<ProductMissingCode>; estimated: boolean; ongoing: boolean;
}

const D0 = () => new Prisma.Decimal(0);
const add = (a: Dec | null, b: Dec | null) => (a === null || b === null ? null : a.plus(b));
const tl = (d: Dec | null): number | null => (d === null ? null : Number(d.toFixed(2)));

function groupOf(label: string, r: ProductProfitRow): ProductGroup {
  return {
    label, meters: r.meters, revenue: r.revenueTry, yarn: r.yarnTry, weaving: r.weavingTry, warping: r.warpingTry, subcontract: r.subcontractTry,
    contribution: r.contributionTry, missing: new Set(r.missing), estimated: r.warpingEstimated, ongoing: r.ongoing,
  };
}

/** İki grubun toplamı: bilinmeyen (null) parça toplamı da bilinmez kılar — kısmi toplam basılmaz. */
function merge(t: ProductGroup, g: ProductGroup): ProductGroup {
  return {
    label: t.label, meters: t.meters.plus(g.meters), revenue: t.revenue.plus(g.revenue), yarn: add(t.yarn, g.yarn), weaving: add(t.weaving, g.weaving),
    warping: add(t.warping, g.warping), subcontract: add(t.subcontract, g.subcontract), contribution: add(t.contribution, g.contribution),
    missing: new Set([...t.missing, ...g.missing]), estimated: t.estimated || g.estimated, ongoing: t.ongoing || g.ongoing,
  };
}

function keyOf(by: Exclude<ProductBreakdown, "is">, r: ProductProfitRow): string | null {
  return by === "desen" ? r.itemId : by === "musteri" ? r.customerId : r.month;
}

function labelOf(by: Exclude<ProductBreakdown, "is">, key: string | null, names: ProductNames): string {
  if (by === "ay") return key ? monthName(key) : "—";
  if (key === null) return "Müşterisiz";
  return (by === "desen" ? names.items : names.customers).get(key) ?? "—";
}

/** Kırılım grupları; ay kronolojik, diğerleri gelire göre büyükten küçüğe. */
export function productGroups(rows: ProductProfitRow[], by: ProductBreakdown, names: ProductNames): ProductGroup[] {
  if (by === "is") {
    return rows.map((r) => groupOf(
      `${names.items.get(r.itemId) ?? "—"} · ${r.weavingOrderId ? names.weavingOrders.get(r.weavingOrderId) ?? "—" : "—"} · ${r.docNo}${r.kind === "CANCELLED" ? " (iptal)" : ""}`, r,
    ));
  }
  const byKey = new Map<string | null, ProductGroup>();
  for (const r of rows) {
    const k = keyOf(by, r);
    const g = groupOf(labelOf(by, k, names), r);
    const prev = byKey.get(k);
    byKey.set(k, prev ? merge(prev, g) : g);
  }
  const groups = [...byKey.entries()];
  if (by === "ay") return groups.sort(([a], [b]) => String(a).localeCompare(String(b))).map(([, g]) => g);
  return groups.map(([, g]) => g).sort((a, b) => b.revenue.cmp(a.revenue) || a.label.localeCompare(b.label, "tr"));
}

export function productTotal(groups: ProductGroup[]): ProductGroup {
  const zero: ProductGroup = {
    label: "Toplam", meters: D0(), revenue: D0(), yarn: D0(), weaving: D0(), warping: D0(), subcontract: D0(), contribution: D0(),
    missing: new Set(), estimated: false, ongoing: false,
  };
  return groups.reduce(merge, zero);
}

/** Durum rozeti: eksik parçalar · iş sürüyor · devere tahmini. */
export function productBadge(g: Pick<ProductGroup, "missing" | "estimated" | "ongoing">): string {
  const parts: string[] = [];
  if (g.missing.size > 0) parts.push(`eksik: ${[...g.missing].map(productMissingText).sort((a, b) => a.localeCompare(b, "tr")).join(", ")}`);
  if (g.ongoing) parts.push("iş sürüyor");
  if (g.estimated) parts.push("devere tahmini");
  return parts.join(" · ");
}

/** Devere kolonu yalnız devere kalemi okunan kurulumda (modül kapalıyken her satır kodsuz null). */
export const hasWarping = (rows: ProductProfitRow[]): boolean => rows.some((r) => r.warpingTry !== null || r.missing.some((c) => WARPING_CODES.includes(c)));

const cellsOf = (g: ProductGroup, withWarping: boolean): Record<string, TabloHucresi> => ({
  ad: g.label, metre: Number(g.meters.toFixed(2)), gelir: tl(g.revenue), iplik: tl(g.yarn), dokuma: tl(g.weaving),
  ...(withWarping ? { devere: tl(g.warping) } : {}), disFason: tl(g.subcontract), katki: tl(g.contribution), durum: productBadge(g),
});

export function productTable(rows: ProductProfitRow[], by: ProductBreakdown, names: ProductNames): TabloBlok {
  const groups = productGroups(rows, by, names);
  const withWarping = hasWarping(rows);
  const money = (anahtar: string, baslik: string): TabloKolonu => ({ anahtar, baslik, birim: "TRY", hiza: "sag" });
  const kolonlar: TabloKolonu[] = [
    { anahtar: "ad", baslik: LABEL[by] }, { anahtar: "metre", baslik: "Satılan metre", birim: "m", hiza: "sag" },
    money("gelir", "Satış geliri"), money("iplik", "İplik"), money("dokuma", "Dokuma (tezgâh)"),
    ...(withWarping ? [money("devere", "Çözgü hazırlama (devere)")] : []), money("disFason", "Boya/apre fasonu"),
    money("katki", "Kalan (katkı)"), { anahtar: "durum", baslik: "Durum" },
  ];
  const shown = by === "is" ? groups.slice(0, PROFIT_WORK_ROW_LIMIT) : groups;
  return {
    kolonlar, satirlar: shown.map((g) => cellsOf(g, withWarping)), toplam: cellsOf(productTotal(groups), withWarping),
    ...(shown.length < groups.length ? { kesildi: { gosterilen: shown.length, toplam: groups.length } } : {}),
  };
}

const TR_NUMBER = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const say = (d: Dec): string => TR_NUMBER.format(Number(d.toFixed(2)));

function productWarnings(r: ProfitabilityResult, notes: string[]): string[] {
  const rows = r.productRows ?? [];
  const drafts = r.productDraftRows ?? [];
  const w = [...notes];
  if (drafts.length > 0) w.push(`Taslak faturalarda ${say(drafts.reduce((a, d) => a.plus(d.revenueTry), D0()))} TL kumaş geliri var; kesinleşmediği için kalana girmedi.`);
  const cancelled = rows.filter((x) => x.kind === "CANCELLED").length;
  if (cancelled > 0) w.push(`${cancelled} satır iptal edilen faturadan geliyor; iptal edildiği ayda eksi yazıldı, eski ay değişmedi.`);
  const missing = rows.filter((x) => x.missing.length > 0).length;
  if (missing > 0) w.push(`${missing} satırda eksik girdi var (Durum kolonunda "eksik"); bu satırların kalanı hesaplanmadı, 0 sayılmadı.`);
  const ongoing = rows.filter((x) => x.ongoing).length;
  if (ongoing > 0) w.push(`${ongoing} satırın dokuma işi sürüyor; maliyeti bugünkü bilgiyle, iş ilerledikçe değişebilir.`);
  const notices = r.productNotices ?? [];
  if (notices.includes("GENEL_GIDER_DAGITILMADI")) w.push("Genel gider ve işçilik kumaş satırlarına dağıtılmadı; \"Kalan\" yalnız doğrudan maliyet düşülerek bulunur.");
  if (notices.includes("IADE_DUSULMEDI")) w.push("İade edilen toplar satışta (brüt) kaldı; iade faturaları bu tabloya henüz düşülmüyor.");
  return w;
}

function productDefinitions(withWarping: boolean): Array<{ ad: string; aciklama: string }> {
  return [
    { ad: "Satış geliri", aciklama: "Onaylı satış faturasındaki kumaş satırlarının KDV hariç TL tutarı; faturanın sevk ettiği toplara metre payıyla bölünür (aynı desenin farklı renk fiyatları ortalanır)." },
    { ad: "Satılan metre", aciklama: "Sevk anındaki top metresi; sonradan iade edilen top da dahildir (brüt)." },
    { ad: "Dokuma (tezgâh)", aciklama: "Topun dokunduğu işin bugüne kadarki metre başı tezgâh maliyeti × satılan metre; \"Dokuma maliyeti\" raporuyla aynı sayı." },
    ...(withWarping ? [{ ad: "Çözgü hazırlama (devere)", aciklama: "İşin devere payı × satılan metre: faturadan, fatura yoksa siparişteki ücretten (tahmini)." }] : []),
    { ad: "İplik", aciklama: "Çözgü ve atkı ipliğinin maliyeti; okunamadığında \"eksik: iplik maliyeti\" yazar." },
    { ad: "Boya/apre fasonu", aciklama: "Topun boyahaneden geçtiği fasonun bedeli; zincirde fason yoksa 0, okunamadığında \"eksik\"." },
    { ad: "Kalan (katkı)", aciklama: "Satış gelirinden iplik, dokuma, devere ve fason çıkınca kalan; genel gider ve işçilik dağıtılmadı." },
    { ad: "Eksik", aciklama: "Maliyeti okunamayan parça sıfır sayılmaz, satırın kalanı boş kalır. \"dokuma işi yok\": top hiçbir dokuma işine bağlanmıyor (al-sat ya da stok devri)." },
  ];
}

export function productBreakdownParameter(selected: ProductBreakdown): ParametreBeyani {
  return { ad: "kirilim", etiket: "Kırılım", tur: "secim", deger: selected, secenekler: PRODUCT_BREAKDOWNS.map((k) => ({ deger: k, etiket: LABEL[k] })) };
}

const NO_SERVICE_NAMES = { customers: new Map(), serviceItems: new Map(), machines: new Map(), rolls: new Map() };

export function buildProductProfitabilitySunumu(p: {
  result: ProfitabilityResult; previous: ProfitabilityResult | null; names: ProductNames; window: ResolvedDayRange; breakdown: ProductBreakdown;
}): RaporSunumu {
  const { result, previous, names, window, breakdown } = p;
  const rows = result.productRows ?? [];
  const total = productTotal(productGroups(rows, "ay", names));
  const prevTotal = previous ? productTotal(productGroups(previous.productRows ?? [], "ay", names)) : null;
  const serviceTotal = totalOf(profitGroups(result.rows, "ay", NO_SERVICE_NAMES));
  const byCustomer = productGroups(rows, "musteri", names);
  const missingRows = rows.filter((x) => x.missing.length > 0).length;
  return {
    ...catalogHeader(PROFITABILITY_KEY),
    donem: periodOf(window.range),
    ...comparePeriodOf(window, previous !== null),
    anaSayi: metricFigure("karlilik.katki", tl(total.contribution), {
      unit: "TRY", name: "Kumaşın kalanı (katkı)", previous: prevTotal ? tl(prevTotal.contribution) : undefined,
      unmeasured: `${missingRows} satırda eksik girdi var; "Durum" kolonundaki eksikler girilince hesaplanır`,
    }),
    yanSayilar: [
      metricFigure("karlilik.gelir", tl(total.revenue), { unit: "TRY", name: "Kumaş satış geliri", previous: prevTotal ? tl(prevTotal.revenue) : undefined }),
      plainFigure("karlilik.kumasMetre", "Satılan metre", Number(total.meters.toFixed(2)), { unit: "m" }),
      plainFigure("karlilik.hizmetKatki", "Hizmet işlerinin kalanı", tl(serviceTotal.contribution), { unit: "TRY", unmeasured: "Hizmet işlerinde eksik girdi var" }),
    ],
    anlati: byCustomer.length < 2 ? [] : anlatiUret({
      kirilim: { boyut: "musteri", birim: "TRY", adTuru: "ozel", ozneIlgi: "Kumaş satış gelirinin", satirlar: byCustomer.map((g) => ({ ad: g.label, deger: tl(g.revenue)! })) },
    }, { kurallar: ["enBuyukPay"] }),
    grafik: null,
    tablo: productTable(rows, breakdown, names),
    tanimlar: productDefinitions(hasWarping(rows)),
    parametreler: [
      ...dayRangeParameters(window.days, window.mode), scopeParameter("kumas"), productBreakdownParameter(breakdown),
      { ad: "hesap", etiket: "hesap", tur: "metin", deger: settingsSummary(result.settings) },
    ],
    uyarilar: productWarnings(result, rangeNotesOf(window)),
  };
}
