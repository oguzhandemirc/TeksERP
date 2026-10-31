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
// DB'ye YAZMAZ (saf girdiyle); HTTP ucu bölümü yok (kapı zinciri §7'de kaynaktan ölçülür).
// Panel tarafı: Electron `pages/Reports/Maliyet/profitability.test.tsx` (Excel/PDF = ekran) +
// `pages/Cost/cost-no-client-math.test.ts` (istemci hesap bekçisi, Reports/Maliyet dahil).
// Koşum: npx tsx scripts/test_karlilik_raporu.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import type { ProfitabilityResult, ProfitabilityRow } from "../src/services/helpers/profitability.helper";
import { buildProfitabilitySunumu, PROFIT_BREAKDOWNS, PROFIT_WORK_ROW_LIMIT, profitTable, settingsSummary, type ProfitNames } from "../src/services/reports/profitability.sunum";
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
    customerId: p.customerId, rollId: `r-${seq}`, serviceItemId: p.serviceItemId, workOrderStepId: null, machineId: p.machineId,
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
      && /router\.get\("\/karlilik", requireFinanceEnabled, requireReportOpen\("maliyet\/karlilik"\), requirePermission\("cost:read"\), requirePermission\("report:finance"\)/.test(route));
  const sunumSrc = readFileSync(path.join(root, "src/services/reports/profitability.sunum.ts"), "utf8");
  check("§7b sunum saf: prisma import etmez", !/lib\/prisma/.test(sunumSrc));
  check("§7c ⭐ katkı/net yalnız helper'da hesaplanır (sunum gelirden maliyet düşmez)", !/(revenue|contribution)(Try)?\??\.minus|\.minus\((?![^)]*Distributed)[^)]*(consum|machine|subcontract|labor|overhead)/i.test(sunumSrc));

  console.log("── §8 ayar okuma anında ──");
  const s8 = buildProfitabilitySunumu({ result: result(complete, { ...SETTINGS, overheadKey: "METRE", machineTime: "NORM" }), previous: null, names: NAMES, window: WINDOW, breakdown: "ay" });
  const h8 = String(s8.parametreler.find((p) => p.ad === "hesap")?.deger);
  check("§8 ayar değişince hesap özeti değişir", h8.includes("genel gider metreye göre") && h8.includes("normundan") && h8 !== settingsSummary(SETTINGS), h8);
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
