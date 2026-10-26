// =============================================================================
// MALİYET FORMÜL BEKÇİSİ (MAL-2) — DB'siz; plan MALIYET-TEKLIF-PLAN §2.3 ALTIN örneği
// =============================================================================
// Motor (`fabric-cost.helper`) saf ve Decimal'dır; iplik tüketiminin doğruluğu her şeyden
// önemli olduğu için §2.3 tablosu birebir kilitlidir. Ölçülenler:
//   §1 ALTIN: çözgü/atkı kg ve TL, m/sa, makine/işçilik/enerji, hazırlık, ham, mamul, sağlam,
//      genel gider, standart, teklif fiyatı (TL ve USD)
//   §2 TRY kuru tanım gereği 1 (TRY fiyatlı iplik kur istemez)
//   §3 USD kuru yok → FX_RATE_MISSING ve sonuç null (ASLA 1 ile hesap)
//   §4 take-up: varsayılandan → TAKEUP_DEFAULTED; hiç yok → TAKEUP_MISSING
//   §5 atkı Σ pay = 0 → eksik (WEFT_SPEC_MISSING)
//   §6 tarife bazı MAMUL_M formülü · §7 ham satış (tarife yok) · §8 m/sa sayı sürümü = Decimal ikizi
//   §9 tek kaynak: motor çözgü/m-sa formülünü KOPYALAMAZ; `number` aritmetiği yok
// Koşum: npx tsx scripts/test_maliyet_formul.ts
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { Prisma } from "@prisma/client";
import {
  computeFabricCost,
  presentCostResult,
  suggestUnitPrice,
  yarnUsagePerM,
  type CostInput,
  type CostSource,
  type Sourced,
} from "../src/services/helpers/fabric-cost.helper";
import { theoreticalMPerHour, theoreticalMPerHourDecimal } from "../src/services/helpers/dokuma-levent-rapor.helper";

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
const r6 = (v: Prisma.Decimal | null | undefined): string => (v ? v.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6) : "null");

/** Plan §2.3: jakar perde, çözgü 9600 tel 75 den, atkı 28/cm 1:1 A150/B300, USD 34. */
function golden(): CostInput {
  return {
    schemaVersion: 1,
    parameterSetId: "p1",
    warp: {
      warpSpecId: "w1",
      endsCount: 9600,
      takeUpPct: s("6"),
      wastePct: s("2.5", "YAPI"),
      yarn: { yarnItemId: "yc", name: "PES 75", denier: s("75"), price: { amount: D("2.60"), currency: "USD", source: "KART" } },
    },
    weft: {
      weftSpecId: "f1",
      picksPerCm: s("28"),
      lengthCm: s("310", "YAPI"),
      wastePct: s("3", "YAPI"),
      yarns: [
        { yarnItemId: "ya", name: "A 150", denier: s("150"), picksInRepeat: 1, price: { amount: D("2.40"), currency: "USD", source: "KART" } },
        { yarnItemId: "yb", name: "B 300", denier: s("300"), picksInRepeat: 1, price: { amount: D("3.10"), currency: "USD", source: "KART" } },
      ],
    },
    loom: {
      rpm: s("600", "YAPI"),
      efficiencyPct: s("85", "YAPI"),
      machineRateTry: s("120", "PARAMETRE"),
      laborRateTry: s("250", "PARAMETRE"),
      loomsPerOperator: s("8", "PARAMETRE"),
      energyKwhPerHour: s("6", "PARAMETRE"),
      energyPriceTry: s("3.20", "PARAMETRE"),
    },
    beam: { prepCostTry: s("4500", "PARAMETRE"), lengthM: s("3000", "PARAMETRE") },
    finishing: { code: "APRE", name: "Apre", basis: "RAW_M", price: { amount: D("18"), currency: "TRY", source: "KART" } },
    lengthShrinkPct: s("4", "YAPI"),
    fabricWastePct: s("2", "YAPI"),
    overheadPct: s("12", "PARAMETRE"),
    extra: null,
  };
}
const FX = { USD: D("34") };

function bolum1(): void {
  const out = computeFabricCost(golden(), FX);
  const r = out.result;
  check("§1a Altın girdi eksiksiz, sonuç var", !!r && out.missing.length === 0, out.missing.join(","));
  if (!r) return;
  const by = (c: string) => r.lines.filter((l) => l.component === c);
  const warp = by("WARP_YARN")[0];
  const [a, b] = by("WEFT_YARN");
  check("§1b Çözgü 0,087289 kg/m · 7,7163 TL", r6(warp?.qty) === "0.087289" && r4(warp?.amountPerMTry) === "7.7163", `${r6(warp?.qty)} ${r4(warp?.amountPerMTry)}`);
  check("§1c Atkı A 0,074570 kg · 6,0849 TL", r6(a?.qty) === "0.074570" && r4(a?.amountPerMTry) === "6.0849", `${r6(a?.qty)} ${r4(a?.amountPerMTry)}`);
  check("§1d Atkı B 0,149141 kg · 15,7195 TL", r6(b?.qty) === "0.149141" && r4(b?.amountPerMTry) === "15.7195", `${r6(b?.qty)} ${r4(b?.amountPerMTry)}`);
  check("§1e Tezgah 10,9286 m/sa", r4(r.loomMPerHour) === "10.9286", r4(r.loomMPerHour));
  const trio = ["LOOM_MACHINE", "LOOM_LABOR", "ENERGY"].map((c) => r4(by(c)[0]?.amountPerMTry)).join("/");
  check("§1f Makine/işçilik/enerji 10,9804/2,8595/1,7569", trio === "10.9804/2.8595/1.7569", trio);
  check("§1g Hazırlık 1,5957", r4(by("BEAM_PREP")[0]?.amountPerMTry) === "1.5957", r4(by("BEAM_PREP")[0]?.amountPerMTry));
  check("§1h ⭐ Ham metre 46,7132", r4(r.rawCostPerMTry) === "46.7132", r4(r.rawCostPerMTry));
  check("§1i Mamul 67,4096", r4(r.finishedCostPerMTry) === "67.4096", r4(r.finishedCostPerMTry));
  check("§1j Sağlam 68,7853", r4(r.soundCostPerMTry) === "68.7853", r4(r.soundCostPerMTry));
  check("§1k Genel gider 8,2542", r4(r.overheadPerMTry) === "8.2542", r4(r.overheadPerMTry));
  check("§1l ⭐ Standart metre maliyeti 77,0395", r4(r.totalCostPerMTry) === "77.0395", r4(r.totalCostPerMTry));
  const sum = r.lines.reduce((acc, l) => acc.plus(l.amountPerMTry), D(0));
  check("§1m Döküm satırları toplamı = standart (tam hassasiyet)", sum.eq(r.totalCostPerMTry));
  const tl = suggestUnitPrice({ costPerMTry: r.totalCostPerMTry, markupPct: D(18), fxRate: D(1) });
  const usd = suggestUnitPrice({ costPerMTry: r.totalCostPerMTry, markupPct: D(18), fxRate: FX.USD });
  check("§1n Teklif fiyatı 90,9066 TL → 2,6737 USD", tl?.toFixed(4) === "90.9066" && usd?.toFixed(4) === "2.6737", `${tl?.toFixed(4)} ${usd?.toFixed(4)}`);
  check("§1o Fiyat önerisi kur null → null (1 varsayılmaz)", suggestUnitPrice({ costPerMTry: r.totalCostPerMTry, markupPct: D(18), fxRate: null }) === null);
  const p = presentCostResult(r);
  check("§1p Sunum: Türkçe anahtar + 4/6 hane", p.standartTlM === "77.0395" && p.cozguKgM === "0.087289" && p.satirlar.length === r.lines.length);
  const usage = yarnUsagePerM(golden());
  check("§1q yarnUsagePerM = motorun kg'ı (fiyatsız)", usage.warp?.kgPerM.eq(warp!.qty!) === true && usage.weft.length === 2 && usage.missing.length === 0);
}

function bolum2(): void {
  const g = golden();
  g.warp!.yarn.price = { amount: D("88.40"), currency: "TRY", source: "KART" };
  g.weft!.yarns[0].price = { amount: D("81.60"), currency: "TRY", source: "KART" };
  g.weft!.yarns[1].price = { amount: D("105.40"), currency: "TRY", source: "KART" };
  const out = computeFabricCost(g, {});
  check("§2 TRY fiyatlarla kur istenmez, sonuç altınla aynı", r4(out.result?.totalCostPerMTry) === "77.0395", r4(out.result?.totalCostPerMTry));
}

function bolum3(): void {
  const out = computeFabricCost(golden(), {});
  check("§3 ⭐ USD kuru yok → FX_RATE_MISSING, sonuç null (ASLA 1)", out.result === null && out.missing.includes("FX_RATE_MISSING"), out.missing.join(","));
  const z = computeFabricCost(golden(), { USD: D(0) });
  check("§3b Kur 0 → FX_RATE_MISSING", z.result === null && z.missing.includes("FX_RATE_MISSING"));
}

function bolum4(): void {
  const g = golden();
  g.warp!.takeUpPct = s("6", "PARAMETRE");
  const a = computeFabricCost(g, FX);
  check("§4a Take-up varsayılandan → TAKEUP_DEFAULTED, sonuç var", !!a.result && a.warnings.includes("TAKEUP_DEFAULTED"));
  g.warp!.takeUpPct = s(null, "PARAMETRE");
  const b = computeFabricCost(g, FX);
  check("§4b Varsayılan da yok → TAKEUP_MISSING, sonuç null", b.result === null && b.missing.includes("TAKEUP_MISSING"));
  const c = golden();
  c.warp!.wastePct = s("2.5", "OLCULMUS");
  c.weft!.lengthCm = { value: D("310"), source: "KART", flag: "WEFT_LENGTH_FROM_WIDTH" };
  c.loom.rpm = s("600", "PARAMETRE");
  const w = computeFabricCost(c, FX).warnings;
  check("§4c Ölçülmüş fire / enden atkı boyu / varsayılan devir uyarıları", ["WARP_WASTE_MEASURED", "WEFT_LENGTH_FROM_WIDTH", "RPM_DEFAULTED"].every((x) => w.includes(x as never)), w.join(","));
  const e = golden();
  e.warp!.yarn.price = null;
  e.loom.rpm = s(null, "PARAMETRE");
  e.warp!.yarn.denier = s(null);
  const m = computeFabricCost(e, FX).missing;
  check("§4d Eksik kodları birlikte listelenir (fiyat/devir/denye)", ["YARN_PRICE_MISSING", "RPM_MISSING", "DENIER_MISSING"].every((x) => m.includes(x as never)), m.join(","));
  const n = golden();
  n.parameterSetId = null;
  check("§4e Parametre seti yok → PARAMETER_SET_MISSING", computeFabricCost(n, FX).missing.includes("PARAMETER_SET_MISSING"));
}

function bolum5(): void {
  const g = golden();
  g.weft!.yarns.forEach((y) => (y.picksInRepeat = 0));
  const out = computeFabricCost(g, FX);
  check("§5 Atkı Σ pay = 0 → eksik, sonuç null", out.result === null && out.missing.includes("WEFT_SPEC_MISSING"), out.missing.join(","));
}

function bolum6(): void {
  const g = golden();
  g.finishing!.basis = "FINISHED_M";
  const r = computeFabricCost(g, FX).result;
  // MAMUL_M: C_ham / (1 − sᵦ) + F = 46,7132.. / 0,96 + 18
  const expect = r?.rawCostPerMTry.div(D("0.96")).plus(18);
  check("§6 Tarife MAMUL_M: C_ham/(1−sᵦ)+F", !!r && !!expect && r.finishedCostPerMTry!.eq(expect), `${r4(r?.finishedCostPerMTry)} (66.6596 beklenir)`);
  check("§6b MAMUL_M sonucu 66,6596", r4(r?.finishedCostPerMTry) === "66.6596");
  const u = golden();
  u.lengthShrinkPct = s(null, "PARAMETRE");
  const w = computeFabricCost(u, FX);
  check("§6c Tarife var, çekme bilinmiyor → 0 + SHRINK_UNKNOWN", !!w.result && w.warnings.includes("SHRINK_UNKNOWN"));
}

function bolum7(): void {
  const g = golden();
  g.finishing = null;
  g.lengthShrinkPct = s(null, "PARAMETRE");
  const out = computeFabricCost(g, FX);
  const r = out.result;
  check("§7 Ham satış: F=0, sᵦ=0, mamul yok, uyarı yok", !!r && r.finishedCostPerMTry === null && !out.warnings.includes("SHRINK_UNKNOWN") && !r.lines.some((l) => l.component === "FINISHING" || l.component === "LENGTH_SHRINK"));
  check("§7b Ham satışta sağlam = ham / (1 − fᵏ)", !!r && r.soundCostPerMTry.eq(r.rawCostPerMTry.div(D("0.98"))));
}

function bolum8(): void {
  const pairs: Array<[number, number]> = [[600, 28], [450, 17.5], [720, 33.33], [1, 3], [555, 0.7]];
  const ok = pairs.every(([n, p]) => theoreticalMPerHour(n, p) === Number(theoreticalMPerHourDecimal(n, p)!.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toString()));
  check("§8 theoreticalMPerHour sayı sürümü = Decimal ikizi (3 hane)", ok);
  check("§8b Payda 0/null → null (iki sürümde)", theoreticalMPerHour(600, 0) === null && theoreticalMPerHourDecimal(600, 0) === null && theoreticalMPerHour(null, 28) === null);
}

function bolum9(): void {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/services/helpers/fabric-cost.helper.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("§9a Tek kaynak: motor `warpYarnKgExact` çağırır, 9 000 000'u çözgüde kopyalamaz", /warpYarnKgExact\(/.test(code) && (code.match(/9_000_000|9000000/g) ?? []).length <= 1);
  check("§9b Tek kaynak: m/sa `theoreticalMPerHourDecimal` (0,6/60 sabiti motorda yok)", /theoreticalMPerHourDecimal\(/.test(code) && !/\b0\.6\b|\* ?60\b|mul\(60\)/.test(code));
  check("§9c Motorda `number` aritmetiği/parseFloat/Number() yok", !/parseFloat|Number\(|Math\.|: number\b(?!\s*;\s*\/\/)/.test(code.replace(/endsCount: number|picksInRepeat: number|\(v, i\)/g, "")), "endsCount/picksInRepeat tam sayı sayımdır");
}

function main(): void {
  console.log("=== MALİYET FORMÜL BEKÇİSİ (MAL-2) ===");
  bolum1();
  bolum2();
  bolum3();
  bolum4();
  bolum5();
  bolum6();
  bolum7();
  bolum8();
  bolum9();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}
main();
