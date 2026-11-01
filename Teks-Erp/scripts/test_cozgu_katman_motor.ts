// =============================================================================
// ÇÖZGÜ KATMANI MOTORU (Seyitoğlu SY-B1) — DB'siz; tasarım §3.5 + 2026-10-31 beamMode kararı
// =============================================================================
// Ölçülenler:
//   §1 KATMANSIZ girdi bayt-aynı: fotoğrafta `warpLayers` anahtarı YOK, hash sabit (altın), sonuç
//      `warpLayers: undefined` ile aynı (test_maliyet_formul §1 altını ayrıca kilitli)
//   §2 2 katmanlı fikstür (zemin 5250 tel %8 + döner 2720 tel %14) el hesabına 4/6 hanede eşit:
//      iki çözgü satırı, etiket "Çözgü (döner) — …", warpKgPerM = toplam, ham fark = döner satırı
//   §3 SHARED_BEAM: levent hazırlığı ve hazır levent düşümü EN HIZLI tükenen gruptan (%14);
//      SEPARATE/CREEL zemin take-up'ında kalır · `fastestGroupTakeUpPct` kipe bakar
//   §4 fotoğraf gidiş-dönüş (katmanlı) + bilinmeyen kip zod'da reddedilir
//   §5 derleyici: katman satırı kartın take-up'ını alır; fire SEPARATE_BEAM'de kendi kartından (SY-P1),
//      kartta yoksa/SHARED/CREEL'de zemin zinciri; katmansızda anahtar yok
//   §6 iplik ihtiyacı kullanımı katman başına kip taşır
// NEGATİF SONDALAR: bkz. BEKCI-HARITASI satırı (katman döngüsü kaldırıldı → §2 · kip okunmadı → §3 ·
//   katman kart firesi yerine zemin zinciri → §5c).
// Koşum: npx tsx scripts/test_cozgu_katman_motor.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import {
  computeFabricCost,
  fabricMetersFromWarpM,
  yarnUsagePerM,
  type CostInput,
  type CostSource,
  type CostWarpLayer,
  type Sourced,
} from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { buildCostInput, type CostSources } from "../src/services/helpers/cost-assembler.helper";
import { fastestGroupTakeUpPct } from "../src/services/helpers/warp-layer-beam.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const s = (v: string | null, source: CostSource = "KART"): Sourced<Prisma.Decimal> => ({ value: v === null ? null : D(v), source });
const r4 = (v: Prisma.Decimal | null | undefined): string => (v ? v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4) : "null");
const r6 = (v: Prisma.Decimal | null | undefined): string => (v ? v.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6) : "null");
const FX = { USD: D(34) };

/** Zemin 5250 tel 75 den %8, fire %2,5 (YAPI); atkı/tezgah/terbiye MAL-2 altınıyla aynı. */
function base(): CostInput {
  return {
    schemaVersion: 1,
    parameterSetId: "p1",
    warp: {
      warpSpecId: "w1", endsCount: 5250, takeUpPct: s("8"), wastePct: s("2.5", "YAPI"),
      yarn: { yarnItemId: "yc", name: "PES 75", denier: s("75"), price: { amount: D("2.60"), currency: "USD", source: "KART" } },
    },
    weft: {
      weftSpecId: "f1", picksPerCm: s("28"), lengthCm: s("310", "YAPI"), wastePct: s("3", "YAPI"),
      yarns: [{ yarnItemId: "ya", name: "A 150", denier: s("150"), picksInRepeat: 1, price: { amount: D("2.40"), currency: "USD", source: "KART" } }],
    },
    loom: {
      rpm: s("600", "YAPI"), efficiencyPct: s("85", "YAPI"), machineRateTry: s("120", "PARAMETRE"), laborRateTry: s("250", "PARAMETRE"),
      loomsPerOperator: s("8", "PARAMETRE"), energyKwhPerHour: s("6", "PARAMETRE"), energyPriceTry: s("3.20", "PARAMETRE"),
    },
    beam: { prepCostTry: s("4500", "PARAMETRE"), lengthM: s("3000", "PARAMETRE") },
    finishing: null,
    lengthShrinkPct: s("4", "YAPI"),
    fabricWastePct: s("2", "YAPI"),
    overheadPct: s("12", "PARAMETRE"),
    extra: null,
  };
}
/** Döner çözgü 2720 tel 50 den %14, fire zinciri zeminle aynı (%2,5), 3,50 USD/kg. */
const leno = (beamMode: CostWarpLayer["beamMode"]): CostWarpLayer => ({
  warpSpecId: "w2", endsCount: 2720, takeUpPct: s("14"), wastePct: s("2.5", "YAPI"), role: "LENO", beamMode,
  yarn: { yarnItemId: "yl", name: "DÖNER 50", denier: s("50"), price: { amount: D("3.50"), currency: "USD", source: "KART" } },
});
const withLayer = (mode: CostWarpLayer["beamMode"]): CostInput => ({ ...base(), warpLayers: [leno(mode)] });

function main(): void {
  console.log("=== ÇÖZGÜ KATMANI MOTORU (SY-B1) ===\n── §1 Katmansız bayt-aynı ──");
  const b = base();
  const snap = serializeCostInput(b);
  check("§1a ⭐ katmansız fotoğrafta `warpLayers` anahtarı YOK", !("warpLayers" in snap) && !JSON.stringify(snap).includes("warpLayers"));
  const h = costInputHash(b);
  check("§1b ⭐ katmansız inputHash = `warpLayers: undefined` hash'i (anahtar hash'e girmez)", h === costInputHash({ ...b, warpLayers: undefined }), h);
  const r0 = computeFabricCost(b, FX).result!;
  const rU = computeFabricCost({ ...b, warpLayers: undefined }, FX).result!;
  check("§1c katmansız sonuç: tek çözgü satırı, warpKgPerM = zemin", r0.lines.filter((l) => l.component === "WARP_YARN").length === 1 && r6(r0.warpKgPerM) === "0.048774", r6(r0.warpKgPerM));
  check("§1d boş anahtar = anahtarsız (toplam aynı)", r0.totalCostPerMTry.equals(rU.totalCostPerMTry));

  console.log("\n── §2 İki katmanlı fikstür = el hesabı ──");
  const sep = computeFabricCost(withLayer("SEPARATE_BEAM"), FX);
  const r = sep.result;
  const warpLines = r?.lines.filter((l) => l.component === "WARP_YARN") ?? [];
  check("§2a ⭐ iki çözgü satırı; zemin 0.048774 kg/m · 4.3116 TL/m; döner 0.018022 kg/m · 2.1446 TL/m",
    warpLines.length === 2 && r6(warpLines[0]!.qty) === "0.048774" && r4(warpLines[0]!.amountPerMTry) === "4.3116" && r6(warpLines[1]!.qty) === "0.018022" && r4(warpLines[1]!.amountPerMTry) === "2.1446",
    warpLines.map((l) => `${l.label}=${r6(l.qty)}/${r4(l.amountPerMTry)}`).join(" · "));
  check("§2b satır etiketi \"Çözgü (döner) — DÖNER 50\", iplik kimliği katmanın", warpLines[1]?.label === "Çözgü (döner) — DÖNER 50" && warpLines[1]?.yarnItemId === "yl");
  check("§2c ⭐ warpKgPerM = zemin + döner = 0.066795", r6(r?.warpKgPerM) === "0.066795", r6(r?.warpKgPerM));
  check("§2d ham fark = yalnız döner satırı (SEPARATE'te hazırlık zemin take-up'ında: 1.6304)",
    !!r && r4(r.rawCostPerMTry.minus(r0.rawCostPerMTry)) === r4(warpLines[1]!.amountPerMTry) && r4(r.lines.find((l) => l.component === "BEAM_PREP")?.amountPerMTry) === "1.6304");
  const noPrice = computeFabricCost({ ...base(), warpLayers: [{ ...leno("SEPARATE_BEAM"), yarn: { ...leno("SEPARATE_BEAM").yarn, price: null } }] }, FX);
  check("§2e katman ipliği fiyatsız → sonuç YOK + YARN_PRICE_MISSING (yarım maliyet gösterilmez)", noPrice.result === null && noPrice.missing.includes("YARN_PRICE_MISSING"));
  const noTake = computeFabricCost({ ...base(), warpLayers: [{ ...leno("SEPARATE_BEAM"), takeUpPct: s(null) }] }, FX);
  check("§2f katman take-up'ı yok → TAKEUP_MISSING", noTake.result === null && noTake.missing.includes("TAKEUP_MISSING"));

  console.log("\n── §3 Sarım kipi: SHARED_BEAM en hızlı grup ──");
  const shared = computeFabricCost(withLayer("SHARED_BEAM"), FX).result;
  const creel = computeFabricCost(withLayer("CREEL"), FX).result;
  check("§3a ⭐ SHARED_BEAM: levent hazırlığı en hızlı grupla (%14) → 1.7442 TL/m; SEPARATE 1.6304",
    r4(shared?.lines.find((l) => l.component === "BEAM_PREP")?.amountPerMTry) === "1.7442", r4(shared?.lines.find((l) => l.component === "BEAM_PREP")?.amountPerMTry));
  check("§3b CREEL: hazırlık zemin take-up'ında (1.6304), çözgü kg'ı aynı (0.066795)",
    r4(creel?.lines.find((l) => l.component === "BEAM_PREP")?.amountPerMTry) === "1.6304" && r6(creel?.warpKgPerM) === "0.066795");
  check("§3c ⭐ hazır levent düşümü: SHARED 1000 m çözgü → 860 m kumaş; SEPARATE → 920; katmansız → 920",
    r4(fabricMetersFromWarpM(withLayer("SHARED_BEAM"), D(1000))) === "860.0000" && r4(fabricMetersFromWarpM(withLayer("SEPARATE_BEAM"), D(1000))) === "920.0000" && r4(fabricMetersFromWarpM(base(), D(1000))) === "920.0000");
  check("§3d `fastestGroupTakeUpPct`: SHARED grup büyükse onu, SEPARATE/CREEL'i yok sayar, grupsuzda zemini AYNEN",
    fastestGroupTakeUpPct(D(8), [{ beamMode: "SHARED_BEAM", takeUpPct: D(14) }])?.equals(14) === true &&
    fastestGroupTakeUpPct(D(8), [{ beamMode: "SEPARATE_BEAM", takeUpPct: D(14) }, { beamMode: "CREEL", takeUpPct: D(20) }])?.equals(8) === true &&
    fastestGroupTakeUpPct(null, []) === null && fastestGroupTakeUpPct(D(8), [{ beamMode: "SHARED_BEAM", takeUpPct: null }])?.equals(8) === true);

  console.log("\n── §4 Fotoğraf ──");
  const li = withLayer("SHARED_BEAM");
  const back = parseCostInputSnapshot(JSON.parse(JSON.stringify(serializeCostInput(li))));
  check("§4a ⭐ katmanlı fotoğraf gidiş-dönüş: hash ve sonuç aynı", costInputHash(back) === costInputHash(li) && computeFabricCost(back, FX).result!.totalCostPerMTry.equals(shared!.totalCostPerMTry));
  check("§4b katmanlı hash katmansızdan farklı", costInputHash(li) !== h);
  let rejected = false;
  try { parseCostInputSnapshot({ ...JSON.parse(JSON.stringify(serializeCostInput(li))), warpLayers: [{ ...JSON.parse(JSON.stringify(serializeCostInput(li))).warpLayers[0], beamMode: "BOBIN" }] }); } catch { rejected = true; }
  check("§4c bilinmeyen kip fotoğrafta reddedilir (fail-closed)", rejected);

  console.log("\n── §5 Derleyici ──");
  const yarn = (id: string, den: number) => ({ id, name: id, linearDensityDen: D(den) });
  const item = {
    id: "i1", code: "K1", name: "K1", itemType: "FABRIC", isActive: true, rawWidthCm: D(300),
    warpSpec: { id: "w1", endsCount: 5250, takeUpPct: D(8), wastePct: null, reedWidthCm: D(310), yarnItem: yarn("yc", 75) },
    weftSpec: null, costStructure: { warpWastePct: D("2.5"), processes: [] },
  };
  const src = {
    items: new Map([["i1", item]]), params: { id: "p1", defaultTakeUpPct: D(5), defaultWarpWastePct: D(3), weftSelvedgeAllowanceCm: D(0) }, prices: new Map(), rates: new Map(), asOf: new Date(),
    warpLayers: new Map([["i1", [{ itemId: "i1", role: "LENO", beamMode: "SHARED_BEAM", warpSpec: { id: "w2", endsCount: 2720, takeUpPct: D(14), wastePct: D(1), yarnItem: yarn("yl", 50) } }]]]),
  } as unknown as CostSources;
  const built = buildCostInput(src, { itemId: "i1" });
  const bl = built.warpLayers?.[0];
  check("§5a ⭐ katman kartın take-up'ı (KART %14), fire zemin zinciriyle (YAPI %2,5), kip/rol taşınır",
    bl?.takeUpPct.value?.equals(14) === true && bl.takeUpPct.source === "KART" && bl.wastePct.value?.equals("2.5") === true && bl.wastePct.source === "YAPI" && bl.beamMode === "SHARED_BEAM" && bl.role === "LENO" && bl.yarn.yarnItemId === "yl");
  const bare = buildCostInput({ ...src, warpLayers: new Map() } as CostSources, { itemId: "i1" });
  check("§5b ⭐ katmansız üründe derlenen girdide `warpLayers` anahtarı YOK", !("warpLayers" in bare));

  // SY-P1 (2026-11-01 kararı #355): SEPARATE_BEAM katmanı firesini KENDİ kartından alır; kartta yoksa
  // ve SHARED_BEAM/CREEL'de zemin zinciri aynen (§5a SHARED kartta %1 olsa da YAPI %2,5 kalır).
  const layerOf = (mode: string, waste: Prisma.Decimal | null) => buildCostInput({
    ...src, warpLayers: new Map([["i1", [{ itemId: "i1", role: "LENO", beamMode: mode, warpSpec: { id: "w2", endsCount: 2720, takeUpPct: D(14), wastePct: waste, yarnItem: yarn("yl", 50) } }]]]),
  } as unknown as CostSources, { itemId: "i1" });
  const sepOwn = layerOf("SEPARATE_BEAM", D(1));
  check("§5c ⭐ SEPARATE_BEAM: katman firesi kendi kartından (KART %1), YAPI %2,5 değil",
    sepOwn.warpLayers?.[0]?.wastePct.value?.equals(1) === true && sepOwn.warpLayers[0]!.wastePct.source === "KART",
    `${sepOwn.warpLayers?.[0]?.wastePct.value?.toString()}/${sepOwn.warpLayers?.[0]?.wastePct.source}`);
  const sepNone = layerOf("SEPARATE_BEAM", null).warpLayers?.[0]?.wastePct;
  const creelOwn = layerOf("CREEL", D(1)).warpLayers?.[0]?.wastePct;
  check("§5d SEPARATE_BEAM kartta fire yok → zemin zinciri (YAPI %2,5); CREEL kartta %1 olsa da zemin zinciri",
    sepNone?.value?.equals("2.5") === true && sepNone.source === "YAPI" && creelOwn?.value?.equals("2.5") === true && creelOwn.source === "YAPI");
  const usageOwn = yarnUsagePerM(sepOwn).warpLayers[0]?.kgPerM;
  const usageChain = yarnUsagePerM(layerOf("SEPARATE_BEAM", null)).warpLayers[0]?.kgPerM;
  check("§5e iplik ihtiyacı aynı girdiden: kendi kart firesi (%1) katman kg'ını zincire (%2,5) göre düşürür; zemin kg'ı aynı",
    !!usageOwn && !!usageChain && usageOwn.lt(usageChain) && r6(yarnUsagePerM(sepOwn).warp?.kgPerM) === r6(yarnUsagePerM(layerOf("SEPARATE_BEAM", null)).warp?.kgPerM),
    `${r6(usageOwn)} < ${r6(usageChain)}`);

  console.log("\n── §6 İplik ihtiyacı kullanımı ──");
  const u = yarnUsagePerM(withLayer("CREEL"));
  check("§6a katman kullanımı kip ve kartla; zemin `warp` yalnız zemin kg'ı",
    u.warpLayers.length === 1 && u.warpLayers[0]!.beamMode === "CREEL" && r6(u.warpLayers[0]!.kgPerM) === "0.018022" && r6(u.warp?.kgPerM) === "0.048774");
  check("§6b katmansızda boş liste", yarnUsagePerM(base()).warpLayers.length === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
