// =============================================================================
// BEKÇİ — KÂRLILIK RAPORU (D4-G3; DALGA4 §8.6, §8.8, §13 D4-G3)
// =============================================================================
//   §1 zarf — anahtar katalogdan; tablo kolonları semantik adlarla; "hesap" beyanı ayar özetini taşır
//   §2 ⭐ sayı eşitliği — her kırılımın (müşteri/işlem/makine/ay/iş) toplam satırı AYNI; ana sayı = toplam katkı,
//      yan sayı = toplam gelir; toplam = helper satırlarının toplamı (sunum yeni hesap uydurmaz)
//   §3 eksik — eksik girdili iş 0 yazılmaz: grup katkısı boş, "eksik: …" rozeti, ana sayı ölçülemedi
//   §4 tahmini rozet; §5 iş kırılımı tavanı (toplam tam kümeden, `kesildi` beyanlı)
//   §6 sorgu şeması strict (tanınmayan anahtar / kırılım 400); §7 statik — uç kapı zinciri, sunum saf (prisma yok),
//      katkı yalnız helper'da hesaplanır; §8 ayar okuma anında: ayar değişince "hesap" özeti değişir
//   §9 kıyas ayları ana dönemin tam aylarıyla ÖRTÜŞMEZ (örtüşürse kıyas yok + uyarı); tam ay notu bitiş gününe de bakar
//   §10 K1 dilim 2 kapsam: beyansız hizmet yanıtı çipsiz; çipli yanıt yalnız çip kadar farklı; kapsam/kırılım çözümü + 400
//   §11 kumaş tablosu: kırılım toplamları = motor satırları; eksik boş + rozet; al-sat "dokuma işi yok"; havuz/iade uyarısı
// DB'ye YAZMAZ (saf girdiyle); HTTP ucu bölümü yok (kapı zinciri §7'de kaynaktan ölçülür).
// Panel tarafı: Electron `pages/Reports/Maliyet/profitability.test.tsx` (Excel/PDF = ekran) +
// `pages/Cost/cost-no-client-math.test.ts` (istemci hesap bekçisi, Reports/Maliyet dahil).
// Koşum: npx tsx scripts/test_karlilik_raporu.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import type { ProductMissingCode, ProductNotice, ProductProfitRow, ProfitabilityResult, ProfitabilityRow } from "../src/services/helpers/profitability.helper";
import { buildProductProfitabilitySunumu, PRODUCT_BREAKDOWNS, productTable, type ProductNames } from "../src/services/reports/profitability-product.sunum";
import { resolveProfitView } from "../src/services/reports/profitability.report";
import { buildProfitabilitySunumu, compareMonthsOf, PROFIT_BREAKDOWNS, PROFIT_WORK_ROW_LIMIT, profitTable, settingsSummary, type ProfitNames } from "../src/services/reports/profitability.sunum";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { profitabilityQuerySchema } from "../src/routes/reports/maliyet.report.routes";
import { REPORT_BY_KEY } from "../src/constants/report-catalog";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const D = (v: number | string) => new Prisma.Decimal(v);
let seq = 0;
function row(p: Partial<Omit<ProfitabilityRow, "meters">> & { meters?: number; customerId: string; serviceItemId: string; machineId: string | null; revenue: number; cons?: number | null; mach?: number | null }): ProfitabilityRow {
  seq++;
  const cons = p.cons === undefined ? D(10) : p.cons === null ? null : D(p.cons);
  const mach = p.mach === undefined ? D(5) : p.mach === null ? null : D(p.mach);
  const contribution = cons === null || mach === null ? null : D(p.revenue).minus(cons).minus(mach);
  return {
    month: p.month ?? "2023-03", kind: p.kind ?? "INVOICED", invoiceId: `inv-${seq}`, docNo: `HF-${seq}`, linkId: `l-${seq}`,
    customerId: p.customerId, rollId: `r-${seq}`, warpBeamId: null, serviceItemId: p.serviceItemId, workOrderStepId: null, machineId: p.machineId,
    meterBasis: ServiceMeterBasis.OUT, meters: D(p.meters ?? 100), revenueTry: D(p.revenue), consumableTry: cons, subcontractTry: D(0),
    subcontractEstimated: p.subcontractEstimated ?? false, machineAttributed: mach !== null, machineHours: D(1), machineTry: mach,
    contributionTry: contribution, laborTry: D(2), overheadTry: D(0), netTry: contribution === null ? null : contribution.minus(D(2)),
    missing: p.missing ?? [],
  };
}

const SETTINGS: ProfitabilityResult["settings"] = {
  subcontractSource: "FATURA_ONCE", consumablePriceSource: "ALIS_FIYATI", machineTime: "OTURUM", overheadKey: "YOK", categoryClasses: { "Maaş": "ISCILIK" },
};
const result = (rows: ProfitabilityRow[], settings = SETTINGS): ProfitabilityResult => ({
  fromMonth: "2023-03", toMonth: "2023-04", settings, rows, draftRows: [], months: [], idleMachineDays: [],
});
const NAMES: ProfitNames = {
  customers: new Map([["c1", "Kaya Perde"], ["c2", "Ay Tekstil"]]),
  serviceItems: new Map([["s1", "Kurşun 30 gr"], ["s2", "Tambur sarım"]]),
  machines: new Map([["m1", "Kurşun-1"]]),
  rolls: new Map(),
};
const WINDOW = resolveCoreDayRange({ from: "2023-03-01", to: "2023-04-30", kiyas: "none" }, 90);
const num = (v: unknown) => (typeof v === "number" ? v : null);

async function main(): Promise<void> {
  const complete = [
    row({ customerId: "c1", serviceItemId: "s1", machineId: "m1", revenue: 120.5 }),
    row({ customerId: "c1", serviceItemId: "s2", machineId: null, revenue: 80, month: "2023-04" }),
    row({ customerId: "c2", serviceItemId: "s1", machineId: "m1", revenue: 200.25, month: "2023-04" }),
    row({ customerId: "c2", serviceItemId: "s1", machineId: "m1", revenue: -50, kind: "CANCELLED", meters: -40 }),
  ];
  const s = buildProfitabilitySunumu({ result: result(complete), previous: null, names: NAMES, window: WINDOW, breakdown: "musteri" });

  console.log("── §1 zarf ──");
  check("§1a anahtar/başlık katalogdan", s.anahtar === "maliyet/karlilik" && s.baslik === REPORT_BY_KEY.get("maliyet/karlilik")?.baslik);
  const cols = s.tablo!.kolonlar.map((c) => c.baslik);
  check("§1b kolonlar semantik adlarla", ["Kesinleşen gelir", "İpe giden", "Makineye giden", "Dışarıya ödenen", "Kalan (katkı)", "Genel gider", "Net", "Durum"].every((c) => cols.includes(c)), cols.join(" | "));
  const hesap = s.parametreler.find((p) => p.ad === "hesap");
  check("§1c ⭐ \"hesap\" beyanı ayar özetini taşır (Excel/PDF parametre cümlesi + ekran başlığı)",
    hesap?.etiket === "hesap" && hesap.deger === settingsSummary(SETTINGS) && String(hesap.deger).includes("genel gider dağıtılmıyor") && String(hesap.deger).includes("işçilik: Maaş"),
    String(hesap?.deger));
  check("§1d kırılım beyanı seçenekli (panel çipi)", s.parametreler.some((p) => p.ad === "kirilim" && p.secenekler?.length === PROFIT_BREAKDOWNS.length));

  console.log("── §2 sayı eşitliği ──");
  const totals = PROFIT_BREAKDOWNS.map((b) => profitTable(complete, b, NAMES).toplam!);
  const strip = (t: Record<string, unknown>) => JSON.stringify({ ...t, ad: undefined });
  check("§2a ⭐ her kırılımın toplam satırı AYNI (5 kırılım)", totals.every((t) => strip(t) === strip(totals[0]!)), totals.map((t) => t.katki).join(","));
  const sumRev = complete.reduce((a, r) => a.plus(r.revenueTry), D(0)).toNumber();
  const sumCon = complete.reduce((a, r) => a.plus(r.contributionTry!), D(0)).toNumber();
  check("§2b ⭐ toplam = helper satırlarının toplamı (gelir, katkı)", num(totals[0]!.gelir) === sumRev && num(totals[0]!.katki) === sumCon, `${totals[0]!.gelir}/${sumRev} · ${totals[0]!.katki}/${sumCon}`);
  check("§2c ⭐ ana sayı = toplam katkı, yan sayı = toplam gelir", s.anaSayi.deger === sumCon && s.yanSayilar[0]?.deger === sumRev && s.anaSayi.ad === "Kalan (katkı)");
  const rowSum = s.tablo!.satirlar.reduce((a, r) => a + (num(r.gelir) ?? 0), 0);
  check("§2d satırlar toplamı = toplam satırı (gelir)", Math.abs(rowSum - sumRev) < 0.005, `${rowSum}`);
  check("§2e iptal iptal ayında eksi (satır helper'dan aynen)", profitTable(complete, "is", NAMES).satirlar.some((r) => num(r.gelir) === -50 && String(r.ad).includes("(iptal)")));

  console.log("── §3 eksik ──");
  const withMissing = [...complete, row({ customerId: "c2", serviceItemId: "s2", machineId: null, revenue: 30, cons: null, missing: ["SARF_NORMU"] })];
  const t3 = profitTable(withMissing, "musteri", NAMES);
  const c2 = t3.satirlar.find((r) => r.ad === "Ay Tekstil")!;
  check("§3a ⭐ eksikli grubun katkısı BOŞ (0 değil), rozet 'eksik: sarf normu'", c2.katki === null && c2.durum === "eksik: sarf normu", JSON.stringify(c2));
  check("§3b eksiksiz grubun rozeti boş, katkısı dolu", t3.satirlar.find((r) => r.ad === "Kaya Perde")?.durum === "" && num(t3.satirlar.find((r) => r.ad === "Kaya Perde")?.katki) !== null);
  const s3 = buildProfitabilitySunumu({ result: result(withMissing), previous: null, names: NAMES, window: WINDOW, breakdown: "musteri" });
  check("§3c ana sayı ölçülemedi + uyarı", s3.anaSayi.deger === null && Boolean(s3.anaSayi.olculemedi) && s3.uyarilar.some((u) => u.includes("eksik girdi")));

  console.log("── §4 tahmini · §5 tavan ──");
  const est = profitTable([row({ customerId: "c1", serviceItemId: "s1", machineId: "m1", revenue: 10, subcontractEstimated: true })], "islem", NAMES);
  check("§4 tahmini dış fason rozeti", est.satirlar[0]?.durum === "tahmini");
  const many = Array.from({ length: PROFIT_WORK_ROW_LIMIT + 3 }, () => row({ customerId: "c1", serviceItemId: "s1", machineId: "m1", revenue: 1 }));
  const t5 = profitTable(many, "is", NAMES);
  check("§5 ⭐ iş kırılımı tavanlı, toplam TAM kümeden, kesildi beyanlı",
    t5.satirlar.length === PROFIT_WORK_ROW_LIMIT && num(t5.toplam!.gelir) === many.length && t5.kesildi?.toplam === many.length);

  console.log("── §6 şema ──");
  check("§6a geçerli sorgu", profitabilityQuerySchema.safeParse({ from: "2023-03-01", to: "2023-03-31", kirilim: "is" }).success);
  check("§6b tanınmayan kırılım 400", !profitabilityQuerySchema.safeParse({ kirilim: "renk" }).success);
  check("§6c tanınmayan anahtar 400 (strict)", !profitabilityQuerySchema.safeParse({ cariId: "x" }).success);

  console.log("── §7 statik ──");
  const root = path.join(__dirname, "..");
  const route = readFileSync(path.join(root, "src/routes/reports/maliyet.report.routes.ts"), "utf8");
  check("§7a uç zinciri: router maliyet kapısı → ön muhasebe → rapor kapısı → cost:read + report:finance",
    /router\.use\(verifyToken, requireMaliyetEnabled\)/.test(route)
      && /router\.get\("\/karlilik", requireFinanceEnabled, requireDokumaForFabricScope, requireReportOpen\("maliyet\/karlilik"\), requirePermission\("cost:read"\), requirePermission\("report:finance"\)/.test(route)
      && /profitabilityQuerySchema\.safeParse\(req\.query\)/.test(route)
      && /q\.success && q\.data\.kapsam === "kumas"\) void requireDokumaEnabled\(req, res, next\)/.test(route));
  const sunumSrc = readFileSync(path.join(root, "src/services/reports/profitability.sunum.ts"), "utf8");
  check("§7b sunum saf: prisma import etmez", !/lib\/prisma/.test(sunumSrc));
  check("§7c ⭐ katkı/net yalnız helper'da hesaplanır (sunum gelirden maliyet düşmez)", !/(revenue|contribution)(Try)?\??\.minus|\.minus\((?![^)]*Distributed)[^)]*(consum|machine|subcontract|labor|overhead)/i.test(sunumSrc));

  console.log("── §8 ayar okuma anında ──");
  const s8 = buildProfitabilitySunumu({ result: result(complete, { ...SETTINGS, overheadKey: "METRE", machineTime: "NORM" }), previous: null, names: NAMES, window: WINDOW, breakdown: "ay" });
  const h8 = String(s8.parametreler.find((p) => p.ad === "hesap")?.deger);
  check("§8 ayar değişince hesap özeti değişir", h8.includes("genel gider metreye göre") && h8.includes("normundan") && h8 !== settingsSummary(SETTINGS), h8);

  console.log("── §9 kıyas ayları · tam ay notu ──");
  const def = resolveCoreDayRange({}, 90, new Date("2026-10-31T12:00:00Z"));
  const c9 = compareMonthsOf(def);
  check("§9a ⭐ varsayılan (90 gün, önceki) kıyas ayları ana aylarla örtüşmez", c9?.fromMonth === "2026-05" && c9?.toMonth === "2026-07", JSON.stringify(c9));
  const py = compareMonthsOf(resolveCoreDayRange({ from: "2023-03-01", to: "2023-04-30", kiyas: "prevYear" }, 90));
  check("§9b geçen yıl kıyası aynı aylar bir yıl önce", py?.fromMonth === "2022-03" && py?.toMonth === "2022-04", JSON.stringify(py));
  const longW = resolveCoreDayRange({ from: "2023-01-15", to: "2024-01-14", kiyas: "prevYear" }, 90);
  const sLong = buildProfitabilitySunumu({ result: result(complete), previous: null, names: NAMES, window: longW, breakdown: "musteri" });
  check("§9c 13 ayda geçen yıl örtüşür → kıyas yok + uyarı", compareMonthsOf(longW) === null && !sLong.kiyasDonemi && sLong.uyarilar.some((u) => u.includes("örtüştüğü")));
  const mid = buildProfitabilitySunumu({ result: result(complete), previous: null, names: NAMES, window: resolveCoreDayRange({ from: "2023-03-01", to: "2023-03-15", kiyas: "none" }, 90), breakdown: "musteri" });
  check("§9d bitiş ay ortasında → tam ay notu çıkar", mid.uyarilar.some((u) => u.startsWith("Kârlılık tam aylarla")));
  check("§9e ay sınırına oturan dönemde not yok", !s.uyarilar.some((u) => u.startsWith("Kârlılık tam aylarla")));
  scopeChecks(complete);
  fabricChecks(complete);
}

// ── §10–§11 K1 dilim 2: kapsam (hizmet / kumaş) ─────────────────────────────────────────────────
function prow(p: { itemId: string; wo: string | null; revenue: number; weaving: number | null; warping?: number | null; yarn: number | null; contribution: number | null; missing?: ProductMissingCode[]; customerId?: string | null; month?: string; ongoing?: boolean }): ProductProfitRow {
  seq++;
  const dn = (v: number | null | undefined) => (v === null || v === undefined ? null : D(v));
  return {
    month: p.month ?? "2023-03", kind: "INVOICED", invoiceId: `pinv-${seq}`, docNo: `SF-${seq}`, customerId: p.customerId === undefined ? "c1" : p.customerId,
    itemId: p.itemId, weavingOrderId: p.wo, ongoing: p.ongoing ?? false, rollCount: 2, returnedRollCount: 0, meters: D(100), hamMeters: D(100), revenueTry: D(p.revenue),
    weavingTry: dn(p.weaving), warpingTry: p.warping === undefined ? null : dn(p.warping), warpingEstimated: false, yarnTry: dn(p.yarn),
    yarnEstimated: false, customerYarn: false, subcontractTry: p.wo ? D(0) : null, subcontractEstimated: false, contributionTry: dn(p.contribution), missing: p.missing ?? [],
  };
}
const PNAMES: ProductNames = {
  customers: new Map([["c1", "Kaya Perde"], ["c2", "Deniz Tül"]]), items: new Map([["i1", "Tül 2001"], ["i2", "Hazır Voal"]]), weavingOrders: new Map([["w1", "DK-1"], ["w2", "DK-2"]]),
};
const withProducts = (rows: ProfitabilityRow[], productRows: ProductProfitRow[], notices: ProductNotice[] = ["GENEL_GIDER_DAGITILMADI"]): ProfitabilityResult =>
  ({ ...result(rows), productRows, productDraftRows: [], productNotices: notices });

function scopeChecks(complete: ProfitabilityRow[]): void {
  console.log("── §10 kapsam çözümü · bayt-aynı ──");
  const base = { result: result(complete), previous: null, names: NAMES, window: WINDOW, breakdown: "musteri" as const };
  const plain = buildProfitabilitySunumu(base);
  const offered = buildProfitabilitySunumu({ ...base, scopeOffered: true });
  check("§10a ⭐ dokuma kapalı (beyansız) hizmet yanıtında kapsam çipi yok", !plain.parametreler.some((p) => p.ad === "kapsam"));
  const stripped = { ...offered, parametreler: offered.parametreler.filter((p) => p.ad !== "kapsam") };
  check("§10b ⭐ dokuma açıkken hizmet yanıtı yalnız kapsam çipi kadar farklı (tablo/sayı/uyarı bayt-aynı)", JSON.stringify(stripped) === JSON.stringify(plain)
    && offered.parametreler.find((p) => p.ad === "kapsam")?.deger === "hizmet");
  const v = (q: Parameters<typeof resolveProfitView>[0], dokuma: boolean, def: "HIZMET" | "KUMAS") => { try { return resolveProfitView(q, dokuma, def); } catch (e) { return (e as { details?: { code?: string } }).details?.code ?? "?"; } };
  check("§10c kapsamsız + ayar HIZMET → hizmet/müşteri (bugünkü)", JSON.stringify(v({}, true, "HIZMET")) === JSON.stringify({ scope: "hizmet", breakdown: "musteri" }));
  check("§10d kapsamsız + ayar KUMAS + dokuma açık → kumaş/desen", JSON.stringify(v({}, true, "KUMAS")) === JSON.stringify({ scope: "kumas", breakdown: "desen" }));
  check("§10e ayar KUMAS ama dokuma kapalı → hizmete düşer", JSON.stringify(v({}, false, "KUMAS")) === JSON.stringify({ scope: "hizmet", breakdown: "musteri" }));
  check("§10f kapsama ait olmayan kırılım 400 PROFIT_BREAKDOWN_SCOPE (kumaş+işlem, hizmet+desen)",
    v({ kapsam: "kumas", kirilim: "islem" }, true, "HIZMET") === "PROFIT_BREAKDOWN_SCOPE" && v({ kirilim: "desen" }, true, "HIZMET") === "PROFIT_BREAKDOWN_SCOPE");
  check("§10g şema: tanınmayan kapsam 400, kumaş+desen geçerli",
    !profitabilityQuerySchema.safeParse({ kapsam: "renk" }).success && profitabilityQuerySchema.safeParse({ kapsam: "kumas", kirilim: "desen" }).success);
}

function fabricChecks(complete: ProfitabilityRow[]): void {
  console.log("── §11 kumaş tablosu ──");
  const rows = [
    prow({ itemId: "i1", wo: "w1", revenue: 1000, weaving: 300, yarn: 100, contribution: 600 }),
    prow({ itemId: "i1", wo: "w2", revenue: 500, weaving: 150, yarn: null, contribution: null, missing: ["IPLIK_MALIYETI"], customerId: "c2", month: "2023-04", ongoing: true }),
    prow({ itemId: "i2", wo: null, revenue: 200, weaving: null, yarn: null, contribution: null, missing: ["DOKUMA_ISI_YOK"] }),
  ];
  const res = withProducts(complete, rows, ["GENEL_GIDER_DAGITILMADI", "IADE_DUSULMEDI"]);
  const s = buildProductProfitabilitySunumu({ result: res, previous: null, names: PNAMES, window: WINDOW, breakdown: "desen" });
  const totals = PRODUCT_BREAKDOWNS.map((b) => productTable(rows, b, PNAMES).toplam);
  check("§11a ⭐ her kırılımın toplamı AYNI ve motor satırlarının toplamı (gelir 1700, kalan boş)",
    totals.every((t) => JSON.stringify({ ...t, ad: "" }) === JSON.stringify({ ...totals[0]!, ad: "" })) && totals[0]!.gelir === 1700 && totals[0]!.katki === null, JSON.stringify(totals[0]));
  const isTable = productTable(rows, "is", PNAMES);
  check("§11b eksiksiz satırın kalanı motorun sayısı (600), eksikli grubun kalanı BOŞ", isTable.satirlar[0]?.katki === 600 && s.tablo?.satirlar.find((r) => r.ad === "Tül 2001")?.katki === null);
  const alSat = s.tablo?.satirlar.find((r) => r.ad === "Hazır Voal");
  check("§11c ⭐ al-sat satırı görünür: gelir dolu, dokuma boş (0 değil), rozet 'eksik: dokuma iş emri yok' (TERIM)", alSat?.gelir === 200 && alSat?.dokuma === null && alSat?.durum === "eksik: dokuma iş emri yok", JSON.stringify(alSat));
  check("§11d iş sürüyor rozeti + iplik eksiği", String(isTable.satirlar[1]?.durum) === "eksik: iplik maliyeti · iş sürüyor", String(isTable.satirlar[1]?.durum));
  check("§11e ⭐ 'genel gider dağıtılmadı' ve 'iade düşülmedi' uyarıları + kalan tanımı", s.uyarilar.some((u) => u.startsWith("Genel gider ve işçilik kumaş satırlarına dağıtılmadı"))
    && s.uyarilar.some((u) => u.startsWith("İade edilen toplar")) && s.tanimlar.some((t) => t.ad === "Kalan (katkı)" && t.aciklama.includes("genel gider ve işçilik dağıtılmadı")));
  check("§11f kapsam beyanı 'kumas', kırılım seçenekleri desen/müşteri/ay/iş", s.parametreler.find((p) => p.ad === "kapsam")?.deger === "kumas"
    && JSON.stringify(s.parametreler.find((p) => p.ad === "kirilim")?.secenekler?.map((o) => o.deger)) === JSON.stringify(PRODUCT_BREAKDOWNS));
  check("§11g ana sayı ölçülemedi (eksik var), yan sayı hizmet kalanı = hizmet tablosunun toplamı", s.anaSayi.deger === null && Boolean(s.anaSayi.olculemedi)
    && s.yanSayilar.find((f) => f.olcu === "karlilik.hizmetKatki")?.deger === buildProfitabilitySunumu({ result: res, previous: null, names: NAMES, window: WINDOW, breakdown: "musteri" }).anaSayi.deger);
  check("§11h devere kalemi okunmayan kurulumda devere kolonu yok", !s.tablo?.kolonlar.some((k) => k.anahtar === "devere"));
  const full = [prow({ itemId: "i1", wo: "w1", revenue: 1000, weaving: 300, warping: 40, yarn: 100, contribution: 560 }), prow({ itemId: "i1", wo: "w2", revenue: 400, weaving: 100, warping: 20, yarn: 50, contribution: 230 })];
  const sFull = buildProductProfitabilitySunumu({ result: withProducts(complete, full), previous: null, names: PNAMES, window: WINDOW, breakdown: "musteri" });
  check("§11i ⭐ eksiksizde ana sayı = Σ motor katkısı (790), devere kolonu var", sFull.anaSayi.deger === 790 && sFull.tablo?.kolonlar.some((k) => k.anahtar === "devere") === true &&sFull.tablo?.toplam?.devere === 60);
  const src = readFileSync(path.join(__dirname, "..", "src/services/reports/profitability-product.sunum.ts"), "utf8");
  check("§11j ⭐ kumaş sunumu saf ve katkı hesaplamaz (prisma yok, gelirden maliyet düşmez)", !/lib\/prisma/.test(src) && !/\.minus\(/.test(src));
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exitCode = fail > 0 ? 1 : 0;
  });
