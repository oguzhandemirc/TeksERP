// =============================================================================
// DOKUMA ATKI ÜCRETİ YÖNTEMİ BEKÇİSİ (SY-D2; TASARIM-2026-10-31 §5, §15.1)
// =============================================================================
// Ayar `maliyet.dokumaStandartYontemi` = TEZGAH_SAATI (varsayılan, bugünkü motor) | ATKI_UCRETI.
// ATKI_UCRETI'de dokuma TEK satırdır: WEAVING_PICK = atkı/cm × ücret × kur (Excel "17 × 2 cent").
// Ölçülenler:
//   §1 (DB'siz) motor: 17 × 0,02 USD × 40 = 13,6000 TL tek satır; tezgah/işçilik/enerji YOK; devir
//      yokken sonuç var, m/sa null; ücret yok → PICK_RATE_MISSING; kur yok → FX_RATE_MISSING (1 değil)
//   §2 (DB'siz) fotoğraf: TEZGAH girdisinde `loomPick` anahtarı YOK (hash bayt-aynı); ATKI fotoğrafı
//      gidip-dönüşte aynı hash
//   §3 (test DB) ayar dört kapı: varsayılan TEZGAH_SAATI, Zod + servis tanınmayan değeri 400
//   §4 (test DB) ⭐ derleyici ayarı OKUR: TEZGAH'ta girdi/hash ayarsızla aynı; ATKI'da `loomPick`
//      PARAMETRE'den, yapıda ücret varsa YAPI kazanır; devir yokken servis sürümü m/sa null yazar
//   §5 (test DB) ücret çifti: tek başına ücret ya da döviz 400 COST_PICK_RATE_PAIR; çiftsiz PUT korur
// Koşum: DATABASE_URL=<_test DB> npx tsx scripts/test_maliyet_atki_ucreti.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { computeFabricCost, presentCostResult, type CostInput, type CostSource, type Sourced } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { putCostStructure } from "../src/services/cost-structure.service";
import { createDraft } from "../src/services/cost-parameter.service";
import { createStandardCostVersion } from "../src/services/standard-cost.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { AppError } from "../src/utils/app-error";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { ensureTestAdmin } from "./fixture-test-user";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const s = (v: string | null, source: CostSource = "KART"): Sourced<Prisma.Decimal> => ({ value: v === null ? null : D(v), source });
const r4 = (v: Prisma.Decimal | null | undefined): string => (v ? v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4) : "null");
const code = (e: unknown): string | undefined => (e instanceof AppError ? (e.details as { code?: string } | undefined)?.code : undefined);

/** Seyitoğlu tülü: atkı 17/cm, TRY iplik (kur yalnız ücret için), atkı ücreti 0,02 USD (2 cent). */
function tul(pick: CostInput["loomPick"]): CostInput {
  const tryPrice = (a: string) => ({ amount: D(a), currency: "TRY" as const, source: "KART" as const });
  return {
    schemaVersion: 1,
    parameterSetId: "p1",
    warp: { warpSpecId: "w1", endsCount: 5250, takeUpPct: s("8"), wastePct: s("2", "YAPI"), yarn: { yarnItemId: "yc", name: "PES 30", denier: s("30"), price: tryPrice("90") } },
    weft: { weftSpecId: "f1", picksPerCm: s("17"), lengthCm: s("300", "YAPI"), wastePct: s("3", "YAPI"), yarns: [{ yarnItemId: "ya", name: "PES 50", denier: s("50"), picksInRepeat: 1, price: tryPrice("95") }] },
    loom: {
      rpm: s(null, "PARAMETRE"), efficiencyPct: s("85", "YAPI"), machineRateTry: s(null, "PARAMETRE"), laborRateTry: s(null, "PARAMETRE"),
      loomsPerOperator: s(null, "PARAMETRE"), energyKwhPerHour: s(null, "PARAMETRE"), energyPriceTry: s(null, "PARAMETRE"),
    },
    beam: { prepCostTry: s("4500", "PARAMETRE"), lengthM: s("3000", "PARAMETRE") },
    finishing: null,
    lengthShrinkPct: s(null, "YAPI"),
    fabricWastePct: s("2", "YAPI"),
    overheadPct: s("12", "PARAMETRE"),
    extra: null,
    ...(pick ? { loomPick: pick } : {}),
  };
}
const CENT2 = { rate: { amount: D("0.02"), currency: "USD" as const, source: "PARAMETRE" as const } };

function bolum1(): void {
  const out = computeFabricCost(tul(CENT2), { USD: D("40") });
  const r = out.result;
  check("§1a ATKI_UCRETI: devir/makine ücreti yokken sonuç var (RPM_MISSING sayılmaz)", !!r && out.missing.length === 0, out.missing.join(","));
  if (!r) return;
  const dokuma = r.lines.filter((l) => ["WEAVING_PICK", "LOOM_MACHINE", "LOOM_LABOR", "ENERGY"].includes(l.component));
  check("§1b ⭐ dokuma TEK satır WEAVING_PICK = 17 × 0,02 × 40 = 13,6000 TL/m",
    dokuma.length === 1 && dokuma[0].component === "WEAVING_PICK" && r4(dokuma[0].amountPerMTry) === "13.6000" && r4(dokuma[0].qty) === "17.0000" && r4(dokuma[0].unitPriceTry) === "0.8000",
    dokuma.map((l) => `${l.component}=${r4(l.amountPerMTry)}`).join(","));
  const raw = r.lines.filter((l) => ["WARP_YARN", "WEFT_YARN", "WEAVING_PICK", "BEAM_PREP"].includes(l.component)).reduce((a, l) => a.plus(l.amountPerMTry), D(0));
  check("§1c ham = iplik + atkı ücreti + hazırlık", r4(raw) === r4(r.rawCostPerMTry), `${r4(raw)} vs ${r4(r.rawCostPerMTry)}`);
  check("§1d devir yok → m/sa null, sunumda tezgahMSaat null", r.loomMPerHour === null && presentCostResult(r).tezgahMSaat === null);
  const withRpm = tul(CENT2);
  withRpm.loom.rpm = s("500", "YAPI");
  const v = computeFabricCost(withRpm, { USD: D("40") }).result?.loomMPerHour;
  check("§1e devir varsa m/sa bilgi olarak hesaplanır (500×0,6/17×%85 = 15,0000)", r4(v) === "15.0000", r4(v));
  const noRate = computeFabricCost(tul({ rate: null }), { USD: D("40") });
  check("§1f ücret yok → PICK_RATE_MISSING, sonuç null (0 değil)", noRate.result === null && noRate.missing.includes("PICK_RATE_MISSING"), noRate.missing.join(","));
  const noFx = computeFabricCost(tul(CENT2), {});
  check("§1g kur yok → FX_RATE_MISSING, sonuç null (kur 1 varsayılmaz)", noFx.result === null && noFx.missing.includes("FX_RATE_MISSING"), noFx.missing.join(","));
  const tezgah = computeFabricCost(tul(undefined), { USD: D("40") });
  check("§1h TEZGAH girdisinde (loomPick yok) eski davranış: RPM_MISSING", tezgah.result === null && tezgah.missing.includes("RPM_MISSING"), tezgah.missing.join(","));
}

function bolum2(): void {
  const snapT = serializeCostInput(tul(undefined));
  check("§2a TEZGAH fotoğrafında `loomPick` anahtarı YOK (eski hash bayt-aynı)", !("loomPick" in snapT));
  const a = tul(CENT2);
  const back = parseCostInputSnapshot(serializeCostInput(a));
  check("§2b ATKI fotoğrafı gidip-dönüşte aynı hash", costInputHash(back) === costInputHash(a) && costInputHash(a) !== costInputHash(tul(undefined)));
}

async function setMethod(v: string | null): Promise<void> {
  if (v === null) await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_WEAVING_STANDARD_METHOD } });
  else await systemSettingService.setFeatureFlags({ costWeavingStandardMethod: v as never }, (await ensureTestAdmin()).id);
  invalidateFeatureFlagsCache();
}

async function bolum3(): Promise<void> {
  await setMethod(null);
  const ff = (await systemSettingService.getFeatureFlags()).data!;
  check("§3a varsayılan TEZGAH_SAATI (bugünkü motor)", ff.costWeavingStandardMethod === "TEZGAH_SAATI", String(ff.costWeavingStandardMethod));
  check("§3b Zod: tanınmayan değer reddedilir, iki değer geçer",
    !updateSchema.safeParse({ costWeavingStandardMethod: "SAAT" }).success &&
      updateSchema.safeParse({ costWeavingStandardMethod: "ATKI_UCRETI" }).success && updateSchema.safeParse({ costWeavingStandardMethod: "TEZGAH_SAATI" }).success);
  let e: unknown = null;
  try { await setMethod("SAAT"); } catch (x) { e = x; }
  check("§3c servis: tanınmayan değer 400", e instanceof AppError && e.statusCode === 400);
}

async function bolum4(f: MaliyetFikstur): Promise<void> {
  await altinYapiYaz(f);
  const build = () => prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId: f.fabricId }));
  await setMethod(null);
  const base = await build();
  await setMethod("TEZGAH_SAATI");
  const tz = await build();
  check("§4a ⭐ TEZGAH_SAATI açıkça yazılınca girdi + hash ayarsızla bayt-aynı, loomPick yok",
    costInputHash(tz) === costInputHash(base) && !("loomPick" in tz) && JSON.stringify(serializeCostInput(tz)) === JSON.stringify(serializeCostInput(base)));
  await prisma.costParameterSet.update({ where: { id: f.paramId }, data: { defaultLoomPickRate: D("0.02"), defaultLoomPickCurrency: "USD" } });
  await setMethod("ATKI_UCRETI");
  const at = await build();
  check("§4b ⭐ ATKI_UCRETI: derleyici ayarı okur, ücret PARAMETRE'den",
    at.loomPick?.rate?.source === "PARAMETRE" && at.loomPick.rate.amount.eq("0.02") && at.loomPick.rate.currency === "USD", JSON.stringify(at.loomPick ?? null));
  const out = computeFabricCost(at, { USD: D("40") });
  const pick = out.result?.lines.filter((l) => l.component === "WEAVING_PICK") ?? [];
  check("§4c fikstürde (28 atkı/cm) dokuma = 28 × 0,02 × 40 = 22,4000, tezgah satırı yok",
    pick.length === 1 && r4(pick[0].amountPerMTry) === "22.4000" && !out.result?.lines.some((l) => l.component === "LOOM_MACHINE"), out.missing.join(",") || r4(pick[0]?.amountPerMTry));
  const admin = (await ensureTestAdmin()).id;
  await putCostStructure(f.fabricId, { loomRpm: 600, efficiencyPct: "85", warpWastePct: "2.5", weftWastePct: "3", fabricWastePct: "2", finishingRateCode: f.rateCode, lengthShrinkPct: "4", loomPickRate: "0.05", loomPickCurrency: "USD" }, admin);
  const yapi = await build();
  check("§4d yapıdaki ücret parametreyi ezer (YAPI 0,05)", yapi.loomPick?.rate?.source === "YAPI" && yapi.loomPick.rate.amount.eq("0.05"), JSON.stringify(yapi.loomPick ?? null));
  // §4e uçtan uca: devir yokken servis hesapla+yaz yolu m/sa'yı null yazar ve sunar.
  await putCostStructure(f.fabricId, { efficiencyPct: "85", warpWastePct: "2.5", weftWastePct: "3", fabricWastePct: "2", finishingRateCode: f.rateCode, lengthShrinkPct: "4", loomPickRate: "0.05", loomPickCurrency: "USD" }, admin);
  await prisma.costParameterSet.update({ where: { id: f.paramId }, data: { defaultLoomRpm: null } });
  let ver: Awaited<ReturnType<typeof createStandardCostVersion>> | null = null;
  let verErr: unknown = null;
  try { ver = await createStandardCostVersion(f.fabricId, { fxRates: { USD: "40" }, reason: "SY-D2 bekçi" }, admin); } catch (x) { verErr = x; }
  check("§4e ATKI_UCRETI + devir yok: sürüm servisten yazılır, tezgahMSaat null", ver !== null && ver.tezgahMSaat === null, verErr ? String(verErr) : String(ver?.tezgahMSaat));
}

async function bolum5(f: MaliyetFikstur): Promise<void> {
  const admin = (await ensureTestAdmin()).id;
  let e1: unknown = null;
  try { await putCostStructure(f.fabricId, { loomPickRate: "0.02" }, admin); } catch (x) { e1 = x; }
  check("§5a yapı: döviz yok → 400 COST_PICK_RATE_PAIR", code(e1) === "COST_PICK_RATE_PAIR", code(e1) ?? String(e1));
  let e2: unknown = null;
  try { await createDraft({ defaultLoomPickCurrency: "USD" }, admin); } catch (x) { e2 = x; }
  check("§5b parametre: ücret yok → 400 COST_PICK_RATE_PAIR", code(e2) === "COST_PICK_RATE_PAIR", code(e2) ?? String(e2));
  let e3: unknown = null;
  try { await putCostStructure(f.fabricId, { loomPickRate: "0.02", loomPickCurrency: "XYZ" }, admin); } catch (x) { e3 = x; }
  check("§5c tanınmayan döviz 400", e3 instanceof AppError && e3.statusCode === 400);
  // §5d/§5e eski istemci: ücret çiftini göndermeyen PUT ücreti KORUR; açık null temizler.
  await putCostStructure(f.fabricId, { loomPickRate: "0.05", loomPickCurrency: "USD" }, admin);
  const kept = await putCostStructure(f.fabricId, { efficiencyPct: "85" }, admin);
  check("§5d çiftsiz PUT ücreti korur (eski panel silmez)", kept.loomPickRate?.toString() === "0.05" && kept.loomPickCurrency === "USD", `${kept.loomPickRate} ${kept.loomPickCurrency}`);
  const cleared = await putCostStructure(f.fabricId, { loomPickRate: null, loomPickCurrency: null }, admin);
  check("§5e açık null çifti temizler", cleared.loomPickRate === null && cleared.loomPickCurrency === null);
}

async function main(): Promise<void> {
  console.log("=== DOKUMA ATKI ÜCRETİ YÖNTEMİ BEKÇİSİ (SY-D2) ===");
  bolum1();
  bolum2();
  assertGelistirmeVeritabani("test_maliyet_atki_ucreti");
  const prev = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.COST_WEAVING_STANDARD_METHOD }, select: { value: true } });
  const f = await fiksturKur("MAU");
  try {
    await bolum3();
    await bolum4(f);
    await bolum5(f);
  } finally {
    await fiksturSil(f);
    // SystemSetting birebir geri: önceden yoksa silinir, varsa aynı değer yeniden yazılır.
    await setMethod(typeof prev?.value === "string" ? prev.value : null);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = 1;
});
