// =============================================================================
// SEYİTOĞLU ALTIN TEST (SY-H3, tasarım §9.5 md. 4) — TÜL MALİYET.xlsx bileşen bileşen fark raporu
// =============================================================================
// Fabrika Excel'inin iki sayfası (3000 SERİSİ = 1,6134 $/m · 20Lİ DÖNER = 3,1875 $/m) motorla
// yeniden hesaplanır; her bileşen (çözgü/atkı ipliği, iplik toplamı, dokuma, apre, kurşun, devere,
// ara toplam, toplam) Excel'e 4 hanede eşit olmalı — "beklenen fark" listesindeki (Excel hatası,
// düzeltilmiş değerle) satırlar hariç. Ölçülenler:
//   §1 DB'siz: fikstür girdisi → motor → USD sunum; fark raporu basılır, SAPMA yok
//   §2 GERÇEK DB: iplik/fiyat/çözgü/atkı kartları İÇE AKTARIM motoruyla (item · yarn-cost-price ·
//      warp-spec · weft-spec adaptörleri), tarifeler + ürün yapısı + ayarlar (ATKI_UCRETI ·
//      IPLIK_TUKETIMI · sunum USD) yazılır; derleyici → motor → aynı rapor; §1 ile birebir aynı sonuç
//   §3 Excel başlık değerleri: 3000 = 1,6134 (eşit) · döner Excel 3,1875, düzeltilmiş 3,1912 (EN_TUTARSIZ)
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_maliyet_altin_seyitoglu.ts
// NEGATİF SONDA — 2026-11-01: (a) fabric-cost-kg `IPLIK_TUKETIMI` dalı net kg'a çevrilince §1/§2
//   FINISHING/SUBTOTAL/TOTAL SAPMA ❌; (b) döner beklenen fark listesi boşaltılınca §1/§2 döner ❌.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost } from "../src/services/helpers/fabric-cost.helper";
import { costPresentation, toPresentationAmount } from "../src/services/helpers/cost-presentation.helper";
import { putCostStructure } from "../src/services/cost-structure.service";
import { ImportService } from "../src/services/import/import.service";
import { readCostPresentationCurrency, SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { activateGoldenParameterSet, compareGolden, restoreGoldenParameterSet, formatGoldenRow, goldenComponents, goldenPureInput, GOLDEN_CASES, type GoldenCase, type GoldenComponent } from "./lib/seyitoglu-altin-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { assertGelistirmeVeritabani } from "./db-guard";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const USD_RATE = D("41.85"); // sunum kuru: TL hesap ÷ kur = $ (kur 1 olsaydı TL/$ karışması görünmezdi)
const PRESENT = costPresentation("USD", USD_RATE, "ONIZLEME")!;

/** Rapor + kontrol; dönen harita §1 ↔ §2 eşitliği için. */
function reportCase(section: string, c: GoldenCase, comps: Map<GoldenComponent, Prisma.Decimal>, missing: string[]): void {
  check(`${section} ${c.sheet}: motor sonuç verdi`, comps.size > 0, missing.join(","));
  const rows = compareGolden(c, comps);
  console.log(`  — fark raporu (${c.sheet}, $/m) —`);
  for (const r of rows) console.log(formatGoldenRow(r));
  const bad = rows.filter((r) => r.status === "SAPMA");
  check(`${section} ${c.sheet}: bileşen bileşen 4 hane (beklenen fark listesi dışında SAPMA yok)`, bad.length === 0, bad.map((r) => r.component).join(","));
  const listed = rows.filter((r) => r.status === "BEKLENEN_FARK").length;
  check(`${section} ${c.sheet}: beklenen fark listesinin her satırı GERÇEKTEN Excel'den sapıyor (ölü madde yok)`, listed === c.expectedDiffs.length && rows.filter((r) => r.status === "BEKLENEN_FARK").every((r) => !r.excel.minus(r.expected).abs().lt(D("0.00005"))));
}

function section1(): Map<string, Map<GoldenComponent, Prisma.Decimal>> {
  console.log("\n--- §1 DB'siz motor ---");
  const out = new Map<string, Map<GoldenComponent, Prisma.Decimal>>();
  for (const c of GOLDEN_CASES) {
    const res = computeFabricCost(goldenPureInput(c), { USD: USD_RATE });
    const comps = goldenComponents(res, USD_RATE, (id) => id ?? "?");
    reportCase("§1", c, comps, res.missing);
    out.set(c.key, comps);
    const total = res.result ? toPresentationAmount(res.result.totalCostPerMTry, PRESENT) : null;
    const headline = c.key === "S3000" ? "1.6134" : "3.1912";
    check(`§3 ${c.sheet}: sunum toplamı ${headline} $/m (Excel ${c.key === "S3000" ? "1,6134" : "3,1875 → EN_TUTARSIZ düzeltilmiş 3,1912"})`, total === headline, String(total));
  }
  return out;
}

const SETTING_KEYS_USED = [SETTING_KEYS.COST_WEAVING_STANDARD_METHOD, SETTING_KEYS.COST_FINISHING_KG_BASIS, SETTING_KEYS.COST_PRESENTATION_CURRENCY];

async function importRows(entity: string, rows: Array<Record<string, string>>, ctx: { runIds: string[]; userId: string }): Promise<void> {
  const records = new Set(rows.map((r) => r.code ?? r.yarnCode)).size; // atkı kartı: aynı kodlu satırlar TEK kart
  const input = rows.map((cells, i) => ({ rowNo: i + 2, cells }));
  const actor = { userId: ctx.userId, permissions: ["*"] };
  const preview = await ImportService.preview(entity, input, { mode: "createOnly", onError: "abort" }, actor);
  const errs = preview.rows.flatMap((r) => r.errors.map((e) => `${r.rowNo}:${e.message}`));
  check(`§2 içe aktarım önizleme ${entity}: ${rows.length} satır hatasız`, errs.length === 0, errs.slice(0, 3).join(" | "));
  const run = await ImportService.apply(entity, input, { mode: "createOnly", onError: "abort", fileName: "seyitoglu-altin.xlsx" }, actor);
  ctx.runIds.push(run.runId);
  const bad = run.rows.filter((r) => r.action === "ERROR").map((r) => `${r.rowNo}:${r.errors.map((e) => e.message).join("/")}`);
  check(`§2 içe aktarım uygula ${entity}: ${records} kayıt yazıldı`, bad.length === 0 && run.summary.create === records, bad.slice(0, 3).join(" | ") || JSON.stringify(run.summary));
}

async function section2(pure: Map<string, Map<GoldenComponent, Prisma.Decimal>>, tag: string, ids: CleanupIds): Promise<void> {
  console.log("\n--- §2 GERÇEK DB (içe aktarılmış fikstür) ---");
  const admin = (await ensureTestAdmin()).id;
  Object.assign(ids, await activateGoldenParameterSet(tag));
  await systemSettingService.setFeatureFlags({ costWeavingStandardMethod: "ATKI_UCRETI", costFinishingKgBasis: "IPLIK_TUKETIMI", costPresentationCurrency: "USD" }, admin);
  const presentCur = await readCostPresentationCurrency();
  check("§2 ayar: sunum dövizi USD okunuyor", presentCur === "USD", presentCur);

  const imp = { runIds: ids.runIds, userId: admin };
  const code = (c: GoldenCase, k: string) => `${tag}-${c.key}-${k}`.slice(0, 32);
  const yarnsOf = (c: GoldenCase) => [c.warp.yarn, ...c.weft.yarns.map((w) => w.yarn)];
  const yarnRows = GOLDEN_CASES.flatMap((c) => yarnsOf(c).map((y) => ({ code: code(c, y.key), name: `${tag} ${y.name}`, itemType: "YARN", unit: "KG", linearDensityDen: y.denier })));
  await importRows("item", yarnRows, imp);
  await importRows("yarnCostPrice", GOLDEN_CASES.flatMap((c) => yarnsOf(c).map((y) => ({ yarnCode: code(c, y.key), currency: "USD", pricePerKg: y.priceUsd }))), imp);
  await importRows("warpSpec", GOLDEN_CASES.map((c) => ({
    code: code(c, "W"), name: `${tag} ${c.sheet} çözgü`, yarnCode: code(c, c.warp.yarn.key), endsCount: String(c.warp.endsCount),
    reedWidthCm: c.warp.reedWidthCm, takeUpPct: c.warp.takeUpPct, wastePct: c.warp.wastePct,
  })), imp);
  await importRows("weftSpec", GOLDEN_CASES.flatMap((c) => c.weft.yarns.map((w) => ({
    code: code(c, "F"), name: `${tag} ${c.sheet} atkı`, picksPerCm: c.weft.picksPerCm, yarnCode: code(c, w.yarn.key), picksInRepeat: String(w.picksInRepeat),
  }))), imp);

  for (const c of GOLDEN_CASES) {
    const yarnItems = await prisma.item.findMany({ where: { code: { in: yarnsOf(c).map((y) => code(c, y.key)) } }, select: { id: true, code: true } });
    ids.yarnIds.push(...yarnItems.map((y) => y.id));
    const keyOf = new Map(yarnItems.map((y) => [y.id, y.code.slice(code(c, "").length)]));
    const warpSpec = await prisma.warpSpec.findUnique({ where: { code: code(c, "W") }, select: { id: true } });
    const weftSpec = await prisma.weftSpec.findUnique({ where: { code: code(c, "F") }, select: { id: true } });
    if (warpSpec) ids.warpSpecIds.push(warpSpec.id);
    if (weftSpec) ids.weftSpecIds.push(weftSpec.id);
    check(`§2 ${c.sheet}: içe aktarılan çözgü + atkı kartı bulundu`, !!warpSpec && !!weftSpec);
    if (!warpSpec || !weftSpec) continue;
    const fabric = await prisma.item.create({ data: { code: code(c, "K"), name: `${tag} ${c.sheet}`, itemType: "FABRIC", warpSpecId: warpSpec.id, weftSpecId: weftSpec.id, rawWidthCm: D(c.warp.reedWidthCm) }, select: { id: true } });
    ids.fabricIds.push(fabric.id);
    const rate = (k: string, basis: "KG" | "FINISHED_M", price: string) => ({ code: code(c, k), name: `${tag} ${k}`, basis, currency: "USD" as const, pricePerM: D(price) });
    const rates = [rate("APRE", "KG", c.finishingKgUsd), rate("KURSUN", "FINISHED_M", c.kursunUsd), rate("DEVERE", "FINISHED_M", c.devereUsd)];
    await prisma.finishingRate.createMany({ data: rates });
    ids.rateCodes.push(...rates.map((r) => r.code));
    await putCostStructure(fabric.id, {
      weftWastePct: c.weft.wastePct, fabricWastePct: "0", lengthShrinkPct: "0", finishingRateCode: code(c, "APRE"),
      loomPickRate: c.pickRateUsd, loomPickCurrency: "USD", processes: [code(c, "KURSUN"), code(c, "DEVERE")],
    }, admin);
    const input = await prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId: fabric.id }));
    check(`§2 ${c.sheet}: derleyici ATKI_UCRETI + KG/IPLIK_TUKETIMI + 2 ek işlem girdisi kurdu`, !!input.loomPick && input.finishing?.kgBase === "IPLIK_TUKETIMI" && input.processes?.length === 2);
    const res = computeFabricCost(input, { USD: USD_RATE });
    const comps = goldenComponents(res, USD_RATE, (id) => (id && keyOf.get(id)) || "?");
    reportCase("§2", c, comps, res.missing);
    const p = pure.get(c.key)!;
    const same = [...p.entries()].every(([k, v]) => comps.get(k)?.eq(v) === true) && comps.size === p.size;
    check(`§2 ${c.sheet}: içe aktarılmış fikstür sonucu §1 DB'siz sonuçla birebir`, same);
  }
}

interface CleanupIds { runIds: string[]; yarnIds: string[]; warpSpecIds: string[]; weftSpecIds: string[]; fabricIds: string[]; rateCodes: string[]; paramId: string | null; parkedParamId: string | null }

async function cleanup(ids: CleanupIds, prevSettings: Array<{ key: string; value: Prisma.JsonValue } | null>): Promise<void> {
  await prisma.costStructureProcess.deleteMany({ where: { costStructure: { itemId: { in: ids.fabricIds } } } });
  await prisma.costStructure.deleteMany({ where: { itemId: { in: ids.fabricIds } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.fabricIds } } });
  await prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: ids.weftSpecIds } } });
  await prisma.weftSpec.deleteMany({ where: { id: { in: ids.weftSpecIds } } });
  await prisma.warpSpec.deleteMany({ where: { id: { in: ids.warpSpecIds } } });
  await prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: { in: ids.yarnIds } } });
  await prisma.finishingRate.deleteMany({ where: { code: { in: ids.rateCodes } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.yarnIds } } });
  await prisma.importRunLine.deleteMany({ where: { importRunId: { in: ids.runIds } } });
  await prisma.importRun.deleteMany({ where: { id: { in: ids.runIds } } });
  await restoreGoldenParameterSet(ids);
  for (const [i, key] of SETTING_KEYS_USED.entries()) {
    const prev = prevSettings[i];
    if (prev) await prisma.systemSetting.update({ where: { key }, data: { value: prev.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

async function main(): Promise<void> {
  console.log("=== SEYİTOĞLU ALTIN TEST (SY-H3) ===");
  const pure = section1();
  assertGelistirmeVeritabani("test_maliyet_altin_seyitoglu");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`global ayar yazımı durduruldu — ${engel}`);
  const tag = `TEST-SYH3${Date.now().toString(36).toUpperCase()}`;
  const ids: CleanupIds = { runIds: [], yarnIds: [], warpSpecIds: [], weftSpecIds: [], fabricIds: [], rateCodes: [], paramId: null, parkedParamId: null };
  const prevSettings = [];
  for (const key of SETTING_KEYS_USED) prevSettings.push(await prisma.systemSetting.findUnique({ where: { key }, select: { key: true, value: true } }));
  try {
    await section2(pure, tag, ids);
  } finally {
    await cleanup(ids, prevSettings);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
