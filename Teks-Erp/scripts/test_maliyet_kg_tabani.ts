// =============================================================================
// MALİYET KG TABANI BEKÇİSİ (SY-E1) — `FinishingBasis.KG` + `maliyet.terbiyeKgTabani` + varyant tarife kodu
// =============================================================================
// Tasarım §6 E: boyahane kilo başına faturalar; motor KG tarifesini ham metre başı TL'ye çevirir:
// F/m = birim fiyat × kg/m, kg ayara göre NET_HAM (çözgü + atkı FİRESİZ, take-up'lı) ya da
// IPLIK_TUKETIMI (motorun fireli warpKgPerM + weftKgPerM'i, Excel uyumu). Ölçülenler:
//   §1 metre tabanı bayt-aynı: RAW_M/FINISHED_M girdisinde `kgBase` yok, satır birimi "m"
//      (sayıların altını test_maliyet_formul + test_maliyet_ek_islem tutar)
//   §2 KG + NET_HAM el hesabına eşit (6 hane) · §3 KG + IPLIK_TUKETIMI el hesabına eşit
//   §4 KG ek işlem (PROCESS) aynı çeviriyle, boy çekmesiyle mamul metreye taşınır
//   §5 fotoğraf gidiş-dönüş `kgBase` taşır; eski (anahtarsız) fotoğraf okunur
//   §6 DB: öncelik ELLE > VARYANT > YAPI (⭐ negatif sondanın hedefi); varyant kodu boşsa yapı;
//      başka ürünün varyantı 400 COST_RECIPE_MISMATCH; önizleme ucu varyantla KG satırı verir
//   §7 DB: ayar yok → NET_HAM; IPLIK_TUKETIMI → girdiye donar; metre tabanlı üründe ayar hash'i
//      değiştirmez; tanınmayan değer 400 · §8 varyant tarife kodu yazımı: bilinmeyen 400, boş → null
//   §9 DB (F2): varyantın atkı değişimi (`ProductRecipeWeftYarn`) girdiye/dökümüne o ipliği ve fiyatını
//      taşır; değişimsiz varyant ve varyantsız hesap desen geneliyle bayt-aynı (hash)
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_maliyet_kg_tabani.ts
// NEGATİF SONDA — 2026-10-31: cost-assembler önceliği `cs?.finishingRateCode ?? recipe?.finishingRateCode`
//   olarak TERS çevrilince §6b §6f §7a §7b ❌ (girdi yapı kodunu aldı); NET_HAM kg'ı fireli değerden
//   okununca §2a §2b §4 ❌. İkisi de cp ile geri alındı.
// NEGATİF SONDA — 2026-11-01 (F2): derleyici atkı satırını `cardYarn(src, y.yarnItem)` ile (değişimsiz) kurunca
//   §9b §9c ❌ (B300 kaldı); cp ile geri alındı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost, type CostInput, type CostRate, type CostSource, type Sourced } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { previewCost } from "../src/services/cost-calc.service";
import { productRecipeService } from "../src/routes/product-recipe.routes";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const r6 = (v: Prisma.Decimal | null | undefined): string => (v ? v.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6) : "null");
const s = (v: string | null, source: CostSource = "KART"): Sourced<Prisma.Decimal> => ({ value: v === null ? null : D(v), source });
const usd = (code: string, amount: string, basis: CostRate["basis"], kgBase?: CostRate["kgBase"]): CostRate => ({
  code, name: code, basis, ...(kgBase ? { kgBase } : {}), price: { amount: D(amount), currency: "USD", source: "KART" },
});
const FX = { USD: D("1") };

/** Çözgü 4000 tel × 30 den, take-up %5, fire %2 · atkı 12 atkı/cm × 300 cm × 50 den, fire %2. */
function base(finishing: CostRate | null): CostInput {
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
    finishing,
    lengthShrinkPct: s("4", "YAPI"),
    fabricWastePct: s("0", "YAPI"),
    overheadPct: s("3", "PARAMETRE"),
    extra: null,
  };
}
// El hesabı: çözgü net = 4000 × 30 / 9e6 / 0,95 = 0,014035088 · atkı net = 12 × 100 × 3 × 50 / 9e6 = 0,02
// fireli: 0,014035088 / 0,98 = 0,014321518 · 0,02 / 0,98 = 0,020408163
const NET_KG = "0.034035"; // 0,034035088
const NET_F = "0.030632"; // × 0,90 $
const IT_KG = "0.034730"; // 0,034729681
const IT_F = "0.031257";

function bolum1(): void {
  for (const basis of ["RAW_M", "FINISHED_M"] as const) {
    const inp = base(usd("APRE", "0.2", basis));
    const fin = computeFabricCost(inp, FX).result?.lines.find((l) => l.component === "FINISHING");
    check(`§1 ${basis}: fotoğrafta kgBase yok, satır birimi m, tutar = tarife`, !("kgBase" in (serializeCostInput(inp).finishing ?? {})) && fin?.qtyUnit === "m" && fin.amountPerMTry.eq(D("0.2")) && fin.qty === null);
  }
}

function bolum2ve3(): void {
  const net = computeFabricCost(base(usd("BOYA-RENKLI", "0.9", "KG", "NET_HAM")), FX).result;
  const fn = net?.lines.find((l) => l.component === "FINISHING");
  check("§2a KG+NET_HAM: kg/m el hesabı (firesiz çözgü + atkı)", r6(fn?.qty) === NET_KG, r6(fn?.qty));
  check("§2b KG+NET_HAM: terbiye $/m = 0,90 × kg", r6(fn?.amountPerMTry) === NET_F && fn?.qtyUnit === "kg" && fn.unitPriceTry?.eq(D("0.9")) === true, r6(fn?.amountPerMTry));
  check("§2c KG ham metre tabanıdır: mamul = (ham + F) / (1 − %4)", !!net && net.finishedCostPerMTry?.eq(net.rawCostPerMTry.plus(fn!.amountPerMTry).div(D("0.96"))) === true);
  const it = computeFabricCost(base(usd("BOYA-RENKLI", "0.9", "KG", "IPLIK_TUKETIMI")), FX).result;
  const fi = it?.lines.find((l) => l.component === "FINISHING");
  check("§3a KG+IPLIK_TUKETIMI: kg/m el hesabı (fireli)", r6(fi?.qty) === IT_KG, r6(fi?.qty));
  check("§3b KG+IPLIK_TUKETIMI: kg = motorun warpKgPerM + weftKgPerM'i", !!it && fi?.qty?.eq(it.warpKgPerM.plus(it.weftKgPerM)) === true);
  check("§3c KG+IPLIK_TUKETIMI: terbiye $/m", r6(fi?.amountPerMTry) === IT_F, r6(fi?.amountPerMTry));
  const none = computeFabricCost(base({ code: "YOK", name: "YOK", basis: "KG", kgBase: "NET_HAM", price: null }), FX);
  check("§3d Fiyatsız KG tarifesi → FINISHING_RATE_MISSING, sonuç null (0 değil)", none.result === null && none.missing.includes("FINISHING_RATE_MISSING"));
}

function bolum4(): void {
  const inp = { ...base(null), processes: [usd("BOYA-EK", "0.9", "KG", "NET_HAM")] };
  const p = computeFabricCost(inp, FX).result?.lines.find((l) => l.component === "PROCESS");
  check("§4 KG ek işlem: F ÷ (1 − boy çekmesi) — tarife yokken keep=1 → F", r6(p?.amountPerMTry) === NET_F && p?.qtyUnit === "kg", r6(p?.amountPerMTry));
}

function bolum5(): void {
  const g = base(usd("BOYA-RENKLI", "0.9", "KG", "IPLIK_TUKETIMI"));
  const back = parseCostInputSnapshot(serializeCostInput(g));
  check("§5a Fotoğraf gidiş-dönüş: kgBase + hash + sonuç aynı", back.finishing?.kgBase === "IPLIK_TUKETIMI" && costInputHash(back) === costInputHash(g) && computeFabricCost(back, FX).result!.totalCostPerMTry.eq(computeFabricCost(g, FX).result!.totalCostPerMTry));
  check("§5b kg tabanı hash'e girer (ayar değişimi sürümü bayatlatır)", costInputHash(g) !== costInputHash(base(usd("BOYA-RENKLI", "0.9", "KG", "NET_HAM"))));
  const old = serializeCostInput(base(usd("APRE", "0.2", "RAW_M")));
  check("§5c Eski (kgBase'siz) metre fotoğrafı okunur", parseCostInputSnapshot(old).finishing?.basis === "RAW_M");
}

async function err400(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError && e.statusCode === 400 ? String(e.details?.code ?? "400") : `beklenmeyen: ${String(e)}`;
  }
}

async function bolum6ve7ve8(f: MaliyetFikstur, kg: string, otherItemId: string): Promise<void> {
  const svc = productRecipeService; // route örneği: genel CRUD yazım kapısı (write-guard) dahil
  const created = (await svc.create({ code: `${f.tag}-RV1`, name: `${f.tag} V01 renkli`, itemId: f.fabricId, finishingRateCode: ` ${kg} ` })) as { data?: { id: string } };
  const v1 = created.data!.id;
  const v2 = (await prisma.productRecipe.create({ data: { code: `${f.tag}-RV2`, name: `${f.tag} V02`, itemId: f.fabricId }, select: { id: true } })).id;
  const v3 = (await prisma.productRecipe.create({ data: { code: `${f.tag}-RV3`, name: `${f.tag} başka`, itemId: otherItemId, finishingRateCode: kg }, select: { id: true } })).id;
  const asm = (ref: { itemId: string; recipeId?: string }, o: { finishingRateCode?: string | null } = {}) => prisma.$transaction((tx) => assembleCostInputTx(tx, ref, o));

  const plain = await asm({ itemId: f.fabricId });
  check("§6a Varyantsız: yapının tarifesi (bugünkü)", plain.finishing?.code === f.rateCode && plain.finishing.basis === "RAW_M");
  const withV = await asm({ itemId: f.fabricId, recipeId: v1 });
  check("§6b ⭐ Varyant kodu ürün yapısınınkinden ÖNCE gelir", withV.finishing?.code === kg && withV.finishing.basis === "KG", String(withV.finishing?.code));
  check("§6c Varyant kodu boş → yapının tarifesi", (await asm({ itemId: f.fabricId, recipeId: v2 })).finishing?.code === f.rateCode);
  check("§6d ELLE ezme varyantı da ezer", (await asm({ itemId: f.fabricId, recipeId: v1 }, { finishingRateCode: f.rateCode })).finishing?.code === f.rateCode);
  check("§6e Başka ürünün varyantı → 400 COST_RECIPE_MISMATCH", (await err400(() => asm({ itemId: f.fabricId, recipeId: v3 }))) === "COST_RECIPE_MISMATCH");
  const pv = (await previewCost({ itemId: f.fabricId, recipeId: v1, fxRates: { USD: "34" } })) as unknown as { sonuc?: { satirlar: Array<{ bilesen: string; birim: string | null }> } | null };
  check("§6f Önizleme ucu varyantla: terbiye satırı kg biriminde", pv.sonuc?.satirlar.find((l) => l.bilesen === "FINISHING")?.birim === "kg", JSON.stringify(pv).slice(0, 160));

  check("§7a Ayar yok → kgBase NET_HAM (kod varsayılanı)", withV.finishing?.kgBase === "NET_HAM");
  const hRaw = costInputHash(plain);
  const admin = (await ensureTestAdmin()).id;
  await systemSettingService.setFeatureFlags({ costFinishingKgBasis: "IPLIK_TUKETIMI" }, admin);
  check("§7b IPLIK_TUKETIMI → girdiye donar", (await asm({ itemId: f.fabricId, recipeId: v1 })).finishing?.kgBase === "IPLIK_TUKETIMI");
  check("§7c Metre tabanlı üründe ayar girdiyi/hash'i DEĞİŞTİRMEZ (SIFIR FARK)", costInputHash(await asm({ itemId: f.fabricId })) === hRaw);
  const bad = await err400(() => systemSettingService.setFeatureFlags({ costFinishingKgBasis: "BRUT" as never }, admin));
  check("§7d Tanınmayan ayar değeri → 400", bad !== null && !bad.startsWith("beklenmeyen"), String(bad));

  check("§8a Yazımda kod kırpılır ve aktif tarifeye çözülür", (await prisma.productRecipe.findUnique({ where: { id: v1 }, select: { finishingRateCode: true } }))?.finishingRateCode === kg);
  check("§8b Bilinmeyen kod → 400 COST_FINISHING_RATE_UNKNOWN", (await err400(() => svc.update(v2, { finishingRateCode: `${f.tag}-YOK` }))) === "COST_FINISHING_RATE_UNKNOWN");
  await svc.update(v1, { finishingRateCode: "" });
  check("§8c Boş kod → null (yapının tarifesine döner)", (await prisma.productRecipe.findUnique({ where: { id: v1 }, select: { finishingRateCode: true } }))?.finishingRateCode === null);
}

/** §9 (F2): varyantın atkı değişimi standart maliyete girer; değişimsiz varyant desen geneliyle bayt-aynı. */
async function bolum9(f: MaliyetFikstur, plainHash: string): Promise<void> {
  const v = (await prisma.productRecipe.create({ data: { code: `${f.tag}-RV9`, name: `${f.tag} V09`, itemId: f.fabricId }, select: { id: true } })).id;
  const asm = (recipeId?: string) => prisma.$transaction((tx) => assembleCostInputTx(tx, recipeId ? { itemId: f.fabricId, recipeId } : { itemId: f.fabricId }));
  check("§9a ⭐ Değişimsiz varyant: girdi desen geneliyle bayt-aynı (hash)", costInputHash(await asm(v)) === plainHash);
  const sim = await prisma.item.create({ data: { code: `${f.tag}-SIM`, name: `${f.tag} ŞEFFAF SİM`, itemType: "YARN", linearDensityDen: D(69) }, select: { id: true, name: true } });
  await prisma.yarnCostPrice.create({ data: { yarnItemId: sim.id, currency: "USD", pricePerKg: D("4.80"), note: f.tag } });
  await prisma.productRecipeWeftYarn.create({ data: { recipeId: v, weftSortOrder: 2, yarnItemId: sim.id } });
  const inp = await asm(v);
  const y = inp.weft?.yarns ?? [];
  check("§9b ⭐ Varyant kapsamı: atkı B satırı varyantın ipliği + onun fiyatı; A ve pay/sıklık kartın",
    y.length === 2 && y[1]?.yarnItemId === sim.id && y[1]?.price?.amount.eq(D("4.80")) === true && y[1]?.denier.value?.eq(69) === true
      && y[0]?.yarnItemId === f.weftAId && y[1]?.picksInRepeat === 1 && inp.weft?.picksPerCm.value?.eq(28) === true, JSON.stringify(y.map((r) => r.name)));
  const lines = computeFabricCost(inp, FX).result?.lines.filter((l) => l.component === "WEFT_YARN") ?? [];
  check("§9c Döküm satırı etiketi varyantın ipliğini gösterir", lines.some((l) => l.label === `Atkı — ${sim.name}` && l.yarnItemId === sim.id) && !lines.some((l) => l.yarnItemId === f.weftBId), lines.map((l) => l.label).join(" | "));
  check("§9d Varyantsız hesap değişmez (desen geneli)", costInputHash(await asm()) === plainHash);
  await prisma.productRecipe.delete({ where: { id: v } });
  await prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: sim.id } });
  await prisma.item.delete({ where: { id: sim.id } });
}

async function main(): Promise<void> {
  console.log("=== MALİYET KG TABANI BEKÇİSİ (SY-E1) ===");
  bolum1();
  bolum2ve3();
  bolum4();
  bolum5();
  assertGelistirmeVeritabani("test_maliyet_kg_tabani");
  const before = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.COST_FINISHING_KG_BASIS } });
  const f = await fiksturKur("MKG");
  const kg = `${f.tag}-KG`.slice(0, 32);
  const other = await prisma.item.create({ data: { code: `${f.tag}-DIGER`, name: `${f.tag} diğer`, itemType: "FABRIC" }, select: { id: true } });
  try {
    if (before) await prisma.systemSetting.delete({ where: { key: SETTING_KEYS.COST_FINISHING_KG_BASIS } });
    await altinYapiYaz(f);
    await prisma.finishingRate.create({ data: { code: kg, name: `${f.tag} boya renkli`, basis: "KG", currency: "USD", pricePerM: D("0.9") } });
    await bolum6ve7ve8(f, kg, other.id);
    await bolum9(f, costInputHash(await prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId: f.fabricId }))));
  } finally {
    await prisma.productRecipe.deleteMany({ where: { itemId: { in: [f.fabricId, other.id] } } }); // kod numara serisinden doğabilir
    await prisma.item.delete({ where: { id: other.id } });
    await prisma.finishingRate.deleteMany({ where: { code: kg } });
    await fiksturSil(f);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_FINISHING_KG_BASIS } });
    if (before) await prisma.systemSetting.create({ data: { key: before.key, value: before.value as Prisma.InputJsonValue } });
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
