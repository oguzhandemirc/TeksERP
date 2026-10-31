// =============================================================================
// MALİYET EK İŞLEM BEKÇİSİ (SY-G1) — `CostStructureProcess` pivotu + motor `PROCESS` satırları
// =============================================================================
// Tasarım §8 G: kurşun/devere gibi ek işlemler ürün yapısında tarife kodu listesidir; motor bunları
// terbiyeden SONRA, kalite firesi ve genel giderden ÖNCE üretir (Excel ×1,03'ün tabanı). Ölçülenler:
//   §1 pivot boş → girdi anahtarı yok, sonuç + hash bayt-aynı (Adnan Şahin/dokuma SIFIR FARK)
//   §2 "3000 serisi" kalıbı: apre + kurşun + devere, kalite firesi 0, genel gider %3 → genel gider
//      tabanı ek işlemleri İÇERİR; levent hazırlığı 0 (devere tarife satırı, çift sayım yok)
//   §3 HAM_M tabanlı ek işlem boy çekmesiyle mamul metreye taşınır
//   §4 eksik: fiyatsız/çözülmeyen kod FINISHING_RATE_MISSING; döviz kuru yoksa FX_RATE_MISSING (0 değil)
//   §5 fotoğraf gidiş-dönüş (katı şema `processes`)
//   §6 DB: PUT sıralı replace, `processes` verilmezse dokunulmaz (eski istemci), [] boşaltır ve hash
//      ilk hâline döner; tekrar / terbiyeyle aynı kod / bilinmeyen kod / liste değil → 400
//   §7 detay ucu `yapi.processes` sırayla
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_maliyet_ek_islem.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { putCostStructure } from "../src/services/cost-structure.service";
import { getCostItem } from "../src/services/standard-cost.service";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost, type CostInput, type CostRate, type CostSource, type Sourced } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { AppError } from "../src/utils/app-error";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
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
const usd = (code: string, amount: string, basis: CostRate["basis"] = "FINISHED_M"): CostRate => ({ code, name: code, basis, price: { amount: D(amount), currency: "USD", source: "KART" } });
const FX = { USD: D("1") }; // Excel sunumu $/m: kur 1 → TL satırları doğrudan $ okunur

/** Tül 3000 serisi kalıbı: TRY iplik/tezgah, apre $ (MAMUL_M), kalite firesi 0, genel gider %3, hazırlık 0. */
function base(): CostInput {
  return {
    schemaVersion: 1,
    parameterSetId: "p1",
    warp: { warpSpecId: "w1", endsCount: 4000, takeUpPct: s("5"), wastePct: s("2", "YAPI"), yarn: { yarnItemId: "yc", name: "PES 30", denier: s("30"), price: { amount: D("3"), currency: "TRY", source: "KART" } } },
    weft: {
      weftSpecId: "f1", picksPerCm: s("12"), lengthCm: s("300", "YAPI"), wastePct: s("2", "YAPI"),
      yarns: [{ yarnItemId: "ya", name: "PES 50", denier: s("50"), picksInRepeat: 1, price: { amount: D("2.5"), currency: "TRY", source: "KART" } }],
    },
    loom: {
      rpm: s("500", "YAPI"), efficiencyPct: s("80", "YAPI"), machineRateTry: s("1.2", "PARAMETRE"), laborRateTry: s("2", "PARAMETRE"),
      loomsPerOperator: s("8", "PARAMETRE"), energyKwhPerHour: s("5", "PARAMETRE"), energyPriceTry: s("0.1", "PARAMETRE"),
    },
    beam: { prepCostTry: s("0", "PARAMETRE"), lengthM: s("3000", "PARAMETRE") },
    finishing: usd("APRE", "0.2361"),
    lengthShrinkPct: s("0", "YAPI"),
    fabricWastePct: s("0", "YAPI"),
    overheadPct: s("3", "PARAMETRE"),
    extra: null,
  };
}
const withProcs = (procs: CostRate[]): CostInput => ({ ...base(), processes: procs });

function bolum1(): void {
  const a = computeFabricCost(base(), FX);
  const b = computeFabricCost({ ...base(), processes: undefined }, FX);
  check("§1a Pivot boş: undefined ≡ yok (önceki motorla bayt-aynılık kanıtı test_maliyet_formul altını)", JSON.stringify(a) === JSON.stringify(b) && !!a.result);
  check("§1b Pivot boş: PROCESS satırı yok", !a.result?.lines.some((l) => l.component === "PROCESS"));
  check("§1c Pivot boş: fotoğrafta `processes` anahtarı yok, hash aynı", !("processes" in serializeCostInput(base())) && costInputHash(base()) === costInputHash({ ...base(), processes: undefined }));
}

function bolum2(): void {
  const out = computeFabricCost(withProcs([usd("KURSUN-DIS", "0.15"), usd("DEVERE", "0.05")]), FX);
  const r = out.result;
  check("§2a Ek işlemli girdi hesaplanır", !!r && out.missing.length === 0, out.missing.join(","));
  if (!r) return;
  const order = r.lines.map((l) => l.component).filter((c) => !["WARP_YARN", "WEFT_YARN", "LOOM_MACHINE", "LOOM_LABOR", "ENERGY", "BEAM_PREP"].includes(c)).join(">");
  check("§2b ⭐ Sıra: terbiye > ek işlemler > kalite firesi > genel gider", order === "FINISHING>LENGTH_SHRINK>PROCESS>PROCESS>FABRIC_WASTE>OVERHEAD", order);
  const procs = r.lines.filter((l) => l.component === "PROCESS");
  check("§2c Satırlar: İşlem — KURSUN-DIS 0,15 · DEVERE 0,05", procs.map((l) => `${l.label}=${l.amountPerMTry.toFixed(4)}`).join("|") === "İşlem — KURSUN-DIS=0.1500|İşlem — DEVERE=0.0500");
  const base103 = r.rawCostPerMTry.plus(D("0.2361")).plus(D("0.15")).plus(D("0.05"));
  check("§2d ⭐ Genel gider tabanı ek işlemleri içerir: genel gider = (ham + apre + kurşun + devere) × %3", r.overheadPerMTry.eq(base103.mul(D("0.03"))), `${r.overheadPerMTry} vs ${base103.mul(D("0.03"))}`);
  check("§2e ⭐ Standart = (ham + apre + kurşun + devere) × 1,03", r.totalCostPerMTry.eq(base103.mul(D("1.03"))), r.totalCostPerMTry.toFixed(6));
  const excel = D("0.7903").plus(D("0.34")).plus(D("0.2361")).plus(D("0.15")).plus(D("0.05")).mul(D("1.03")).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  check("§2f Excel 3000 serisi kalıbı: (0,7903+0,34+0,2361+0,15+0,05)×1,03 = 1,6134 (yalnız aritmetik; motor birebiri SY-H3)", excel.toFixed(4) === "1.6134");
  check("§2g Döküm satırları toplamı = standart", r.lines.reduce((a, l) => a.plus(l.amountPerMTry), D(0)).eq(r.totalCostPerMTry));
  check("§2h Levent hazırlığı 0 — devere tarife satırı, çift sayım yok", r.lines.find((l) => l.component === "BEAM_PREP")?.amountPerMTry.isZero() === true);
  check("§2i Mamul = ham + apre + ek işlemler", r.finishedCostPerMTry?.eq(base103) === true);
  const ham = computeFabricCost({ ...withProcs([usd("KURSUN-DIS", "0.15")]), finishing: null }, FX).result;
  check("§2j Terbiyesiz (ham satış) + ek işlem: mamul = ham + işlem", !!ham && ham.finishedCostPerMTry?.eq(ham.rawCostPerMTry.plus(D("0.15"))) === true);
}

function bolum3(): void {
  const g = { ...withProcs([usd("KURSUN-HAM", "0.15", "RAW_M")]), lengthShrinkPct: s("4", "YAPI") };
  const p = computeFabricCost(g, FX).result?.lines.find((l) => l.component === "PROCESS");
  check("§3 HAM_M ek işlem ÷ (1 − boy çekmesi): 0,15 / 0,96 = 0,15625", p?.amountPerMTry.eq(D("0.15625")) === true, p?.amountPerMTry.toString());
}

function bolum4(): void {
  const miss = computeFabricCost(withProcs([{ code: "YOK", name: "YOK", basis: "RAW_M", price: null }]), FX);
  check("§4a Fiyatsız ek işlem → FINISHING_RATE_MISSING, sonuç null (0 değil)", miss.result === null && miss.missing.includes("FINISHING_RATE_MISSING"));
  const fx = computeFabricCost(withProcs([usd("KURSUN-DIS", "0.15")]), {});
  check("§4b Döviz kuru yok → FX_RATE_MISSING (ASLA 1)", fx.result === null && fx.missing.includes("FX_RATE_MISSING"));
  const early = computeFabricCost({ ...withProcs([{ code: "YOK", name: "YOK", basis: "RAW_M", price: null }]), warp: null }, FX);
  check("§4c Erken eksikte de ek işlem eksiği listelenir", early.missing.includes("FINISHING_RATE_MISSING") && early.missing.includes("WARP_SPEC_MISSING"));
}

function bolum5(): void {
  const g = withProcs([usd("KURSUN-DIS", "0.15"), usd("DEVERE", "0.05")]);
  const snap = serializeCostInput(g);
  const back = parseCostInputSnapshot(snap);
  check("§5a Fotoğraf gidiş-dönüş: hash + sonuç aynı", costInputHash(back) === costInputHash(g) && computeFabricCost(back, FX).result?.totalCostPerMTry.eq(computeFabricCost(g, FX).result!.totalCostPerMTry) === true);
  check("§5b Ek işlem hash'i değiştirir", costInputHash(g) !== costInputHash(base()));
}

async function code400(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError && e.statusCode === 400 ? String(e.details?.code ?? "400") : `beklenmeyen: ${String(e)}`;
  }
}

async function bolum6ve7(f: MaliyetFikstur, k: string, d: string): Promise<void> {
  const body = { loomRpm: "600", efficiencyPct: "85", warpWastePct: "2.5", weftWastePct: "3", fabricWastePct: "2", finishingRateCode: f.rateCode, lengthShrinkPct: "4" };
  const asm = () => prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId: f.fabricId }));
  await putCostStructure(f.fabricId, body);
  const h0 = costInputHash(await asm());
  check("§6a Pivot boşken derlenen girdide `processes` yok", !("processes" in (await asm())));

  const row = await putCostStructure(f.fabricId, { ...body, processes: [k, d] });
  check("§6b PUT sıralı replace: yanıt [kurşun, devere]", row.processes.map((p) => `${p.sortOrder}:${p.rateCode}`).join(",") === `0:${k},1:${d}`);
  const in1 = await asm();
  check("§6c Derleyici sırayla PROCESS girdisi kurar (tarife fiyatıyla)", in1.processes?.map((p) => `${p.code}=${p.price?.amount.toString()}`).join(",") === `${k}=0.15,${d}=0.05`);
  check("§6d Ek işlem hash'i değiştirir (bayatlık rozeti çalışır)", costInputHash(in1) !== h0);

  await putCostStructure(f.fabricId, { ...body, processes: [d, k] });
  const rev = await prisma.costStructureProcess.findMany({ where: { costStructure: { itemId: f.fabricId } }, orderBy: { sortOrder: "asc" }, select: { rateCode: true } });
  check("§6e Sıra değişimi replace ile (unique sortOrder çakışmaz)", rev.map((r) => r.rateCode).join(",") === `${d},${k}`);

  await putCostStructure(f.fabricId, body);
  check("§6f ⭐ `processes` verilmezse dokunulmaz (eski istemci tam küme PUT'u)", (await prisma.costStructureProcess.count({ where: { costStructure: { itemId: f.fabricId } } })) === 2);

  const detail = await getCostItem(f.fabricId);
  check("§7 Detay `yapi.processes` sırayla", detail.yapi?.processes.map((p) => p.rateCode).join(",") === `${d},${k}`);

  check("§6g Tekrar eden kod → 400 COST_PROCESS_DUPLICATE", (await code400(() => putCostStructure(f.fabricId, { ...body, processes: [k, k] }))) === "COST_PROCESS_DUPLICATE");
  check("§6h Terbiyeyle aynı kod → 400 COST_PROCESS_SAME_AS_FINISHING", (await code400(() => putCostStructure(f.fabricId, { ...body, processes: [f.rateCode] }))) === "COST_PROCESS_SAME_AS_FINISHING");
  check("§6h2 `processes` yokken terbiye mevcut ek işleme eşitlenirse → 400 COST_PROCESS_SAME_AS_FINISHING", (await code400(() => putCostStructure(f.fabricId, { ...body, finishingRateCode: k }))) === "COST_PROCESS_SAME_AS_FINISHING");
  const csAfter = await prisma.costStructure.findUnique({ where: { itemId: f.fabricId }, select: { finishingRateCode: true } });
  check("§6h3 Reddedilen yazım terbiye kodunu geri aldı (tx rollback)", csAfter?.finishingRateCode === f.rateCode);
  const inWhatIf = await prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId: f.fabricId }, { finishingRateCode: k }));
  check("§6h4 Derleyici terbiyeyle aynı ek işlemi süzer (what-if çift sayım yok)", inWhatIf.processes?.map((p) => p.code).join(",") === d);
  check("§6i Bilinmeyen kod → 400 COST_FINISHING_RATE_UNKNOWN", (await code400(() => putCostStructure(f.fabricId, { ...body, processes: [`${f.tag}-YOK`] }))) === "COST_FINISHING_RATE_UNKNOWN");
  check("§6j Liste değil → 400 COST_PROCESS_INVALID", (await code400(() => putCostStructure(f.fabricId, { ...body, processes: k }))) === "COST_PROCESS_INVALID");
  check("§6k Reddedilen yazım pivotu değiştirmedi", (await prisma.costStructureProcess.count({ where: { costStructure: { itemId: f.fabricId } } })) === 2);

  await putCostStructure(f.fabricId, { ...body, processes: [] });
  const in2 = await asm();
  check("§6l ⭐ [] boşaltır; girdi + hash ilk hâline döner (bayt-aynı)", !("processes" in in2) && costInputHash(in2) === h0);
}

async function main(): Promise<void> {
  console.log("=== MALİYET EK İŞLEM BEKÇİSİ (SY-G1) ===");
  bolum1();
  bolum2();
  bolum3();
  bolum4();
  bolum5();
  assertGelistirmeVeritabani("test_maliyet_ek_islem");
  const f = await fiksturKur("MEI");
  const k = `${f.tag}-K`;
  const d = `${f.tag}-D`;
  try {
    await prisma.finishingRate.createMany({
      data: [
        { code: k, name: `${f.tag} kurşun`, basis: "FINISHED_M", currency: "TRY", pricePerM: D("0.15") },
        { code: d, name: `${f.tag} devere`, basis: "FINISHED_M", currency: "TRY", pricePerM: D("0.05") },
      ],
    });
    await bolum6ve7(f, k, d);
  } finally {
    await prisma.costStructureProcess.deleteMany({ where: { costStructure: { itemId: f.fabricId } } });
    await prisma.finishingRate.deleteMany({ where: { code: { in: [k, d] } } });
    await fiksturSil(f);
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
