// =============================================================================
// test_varyant_fiyat_zinciri — SY-N1: varyant standart maliyet sürümü → fiyat listesi doldurma → teklif kalemi
// =============================================================================
//   §1 varyantsız (recipeId NULL) bugünkü gibi: doldurma desen geneli satırı yazar; elle girilmiş varyant satırı
//      KORUNUR (anahtar itemId + renk + recipeId); sürüm geçmişi yalnız desen geneli zinciri
//   §2 ⭐ varyant sürümü: desen geneli ACTIVE sürümü SUPERSEDE ETMEZ; varyantın ikinci sürümü yalnız kendi
//      öncülünü kapatır; geri alma varyantı taşır; başka ürünün varyantı 400 COST_RECIPE_MISMATCH
//   §3 ⭐ doldurma varyant sürümüyle varyant satırını (sürüm + maliyet donar) yazar, elle satırın yerine geçer
//      (asgari miktar korunur); pasif varyantın sürümü satır doğurmaz
//   §4 ⭐ teklif kalemi varyantın KENDİ sürümünü dondurur; varyant sürümü yoksa desen geneline DÜŞMEZ
//      (canlı hesap + STANDARD_COST_MISSING); maliyeti tazele varyantı korur
// Çalıştır: DATABASE_URL=<test DB> npx tsx scripts/test_varyant_fiyat_zinciri.ts
// NEGATİF SONDA — 2026-11-01: standard-cost.service writeVersion öncül araması `recipeId: null`a geri
//   çevrilince §2a §2b ❌ (desen geneli sürüm varyant kaydıyla SUPERSEDED oldu); quote-line-cost
//   `recipeId: ref.recipeId ?? null` → `recipeId: null` yapılınca §4a §4c ❌. İkisi de geri alındı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as pl from "../src/services/price-list.service";
import { createStandardCostVersion, listStandardCostVersions, restoreStandardCostVersion } from "../src/services/standard-cost.service";
import { addQuoteLine, refreshQuoteCosts } from "../src/services/sales-quote-lines.service";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return { status: err.statusCode, code: err.details?.code };
  }
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const FX = { USD: "34" };
const statusOf = async (id: string) => (await prisma.standardCostVersion.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_varyant_fiyat_zinciri");
  const m = await fiksturKur("TVF");
  const t = await teklifFiksturKur("TVF");
  const variantRate = `${m.tag}-VAPRE`.slice(0, 32);
  const other = await prisma.item.create({ data: { code: `${m.tag}-DIGER`, name: `${m.tag} diğer`, itemType: "FABRIC" }, select: { id: true } });
  try {
    await altinYapiYaz(m);
    await prisma.finishingRate.create({ data: { code: variantRate, name: `${m.tag} varyant apre`, basis: "RAW_M", currency: "TRY", pricePerM: D(30), typicalShrinkPct: D(4) } });
    const recipe = (code: string, itemId: string, finishingRateCode: string | null = null) =>
      prisma.productRecipe.create({ data: { code: `${m.tag}-${code}`, name: `${m.tag} ${code}`, itemId, finishingRateCode }, select: { id: true } });
    const v1 = (await recipe("V1", m.fabricId, variantRate)).id;
    const v2 = (await recipe("V2", m.fabricId, variantRate)).id;
    const vPassive = (await recipe("V9", m.fabricId, variantRate)).id;
    const vOther = (await recipe("VX", other.id)).id;
    const generic = await createStandardCostVersion(m.fabricId, { fxRates: FX, reason: "desen geneli" });

    // §1
    const mk = () => pl.createPriceList({ clientToken: randomUUID(), name: `${t.tag} liste`, customerId: t.customerId, currency: "USD" });
    const a = await mk();
    await pl.replacePriceListLines(a.id, {
      lines: [
        { itemId: m.fabricId, unitPrice: "1.00", minQty: "50" },
        { itemId: m.fabricId, recipeId: v1, unitPrice: "9.99", minQty: "70" },
      ],
    });
    const f1 = await pl.fillFromStandardCost(a.id, { itemIds: [m.fabricId], markupPct: "20", fxRate: "34" });
    const g1 = f1.lines.find((l) => l.recipeId === null && l.colorId === null);
    const manualV = f1.lines.find((l) => l.recipeId === v1);
    check("§1a desen geneli satır desen geneli sürümden dolar, asgari miktar korunur", g1?.standardCostVersionId === generic.id && g1.minQty?.toString() === "50");
    check("§1b ⭐ elle girilmiş varyant satırı (varyant sürümü yokken) KORUNUR", manualV?.unitPrice.toString() === "9.99" && manualV.standardCostVersionId === null);
    check("§1d sürüm geçmişi varsayılan = desen geneli zinciri", (await listStandardCostVersions(m.fabricId)).length === 1);

    // §2
    const va = await createStandardCostVersion(m.fabricId, { fxRates: FX, reason: "varyant", recipeId: v1 });
    const vaRow = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: va.id }, select: { recipeId: true, status: true, totalCostPerMTry: true } });
    const genRow = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: generic.id }, select: { totalCostPerMTry: true } });
    check("§2a ⭐ varyant sürümü yazılır, desen geneli ACTIVE kalır", vaRow.recipeId === v1 && vaRow.status === "ACTIVE" && (await statusOf(generic.id)) === "ACTIVE");
    check("§2a' varyant tarifesi maliyete girer (desen genelinden farklı)", !vaRow.totalCostPerMTry.eq(genRow.totalCostPerMTry), `${vaRow.totalCostPerMTry} vs ${genRow.totalCostPerMTry}`);
    const vb = await createStandardCostVersion(m.fabricId, { fxRates: FX, reason: "varyant 2", recipeId: v1 });
    check("§2b ⭐ varyantın ikinci sürümü yalnız kendi öncülünü kapatır", (await statusOf(va.id)) === "SUPERSEDED" && (await statusOf(vb.id)) === "ACTIVE" && (await statusOf(generic.id)) === "ACTIVE");
    const rs = await restoreStandardCostVersion(m.fabricId, va.id, {});
    const rsRow = await prisma.standardCostVersion.findUniqueOrThrow({ where: { id: rs.id }, select: { recipeId: true } });
    check("§2c geri alma varyantı taşır, desen geneline dokunmaz", rsRow.recipeId === v1 && (await statusOf(vb.id)) === "SUPERSEDED" && (await statusOf(generic.id)) === "ACTIVE");
    const lv = await listStandardCostVersions(m.fabricId, v1);
    check("§2d varyant geçmişi ayrı listelenir; desen geneli liste değişmez", lv.length === 3 && (await listStandardCostVersions(m.fabricId)).length === 1, String(lv.length));
    const eM = await hata(() => createStandardCostVersion(m.fabricId, { fxRates: FX, recipeId: vOther }));
    check("§2e başka ürünün varyantı → 400 COST_RECIPE_MISMATCH", eM?.status === 400 && eM.code === "COST_RECIPE_MISMATCH", JSON.stringify(eM));

    // §3
    const passiveVer = await createStandardCostVersion(m.fabricId, { fxRates: FX, recipeId: vPassive });
    await prisma.productRecipe.update({ where: { id: vPassive }, data: { isActive: false } });
    const f3 = await pl.fillFromStandardCost(a.id, { itemIds: [m.fabricId], markupPct: "20", fxRate: "34" });
    const v1Lines = f3.lines.filter((l) => l.recipeId === v1);
    const activeV1 = await prisma.standardCostVersion.findFirstOrThrow({ where: { itemId: m.fabricId, recipeId: v1, status: "ACTIVE" }, select: { id: true, totalCostPerMTry: true } });
    check("§3a ⭐ varyant satırı varyant sürümünden dolar (sürüm + maliyet donar), tek satır", v1Lines.length === 1 && v1Lines[0]!.standardCostVersionId === activeV1.id && v1Lines[0]!.costPerMTry?.eq(activeV1.totalCostPerMTry) === true);
    check("§3b elle satırın asgari miktarı korunur", v1Lines[0]?.minQty?.toString() === "70");
    check("§3c desen geneli satır yine desen geneli sürümden", f3.lines.filter((l) => l.recipeId === null && l.colorId === null).every((l) => l.standardCostVersionId === generic.id));
    check("§3d pasif varyantın sürümü satır doğurmaz", !f3.lines.some((l) => l.recipeId === vPassive) && (await statusOf(passiveVer.id)) === "ACTIVE");

    // §4
    const q = await teklifYaz(t, "DRAFT", { itemId: m.fabricId, lines: 0 });
    await addQuoteLine(q, { itemId: m.fabricId, recipeId: v1, quantity: 10, unitPrice: 3, markupPct: 10 });
    await addQuoteLine(q, { itemId: m.fabricId, quantity: 10, unitPrice: 3, markupPct: 10 });
    // Varyant sürümü yok: canlı hesap denenir — kur yoksa 400 COST_INPUT_MISSING; desen geneli sürüm sessizce DONMAZ.
    const eV2 = await hata(() => addQuoteLine(q, { itemId: m.fabricId, recipeId: v2, quantity: 10, unitPrice: 3, markupPct: 10 }));
    const ql = () => prisma.salesQuoteLine.findMany({ where: { quoteId: q }, select: { recipeId: true, standardCostVersionId: true, costPerMTry: true, costSnapshot: true } });
    const lines = await ql();
    const lV1 = lines.find((l) => l.recipeId === v1);
    const lGen = lines.find((l) => l.recipeId === null);
    const lV2 = lines.find((l) => l.recipeId === v2);
    check("§4a ⭐ varyantlı kalem varyantın KENDİ sürümünü dondurur", lV1?.standardCostVersionId === activeV1.id && lV1.costPerMTry.eq(activeV1.totalCostPerMTry));
    check("§4b varyantsız kalem desen geneli sürüm (bugünkü)", lGen?.standardCostVersionId === generic.id);
    const snapV2 = lV2?.costSnapshot as { kaynak?: string; uyarilar?: string[] } | undefined;
    const liveTried = lV2 ? lV2.standardCostVersionId === null && snapV2?.kaynak === "CANLI" && !!snapV2.uyarilar?.includes("STANDARD_COST_MISSING") : eV2?.status === 400 && eV2.code === "COST_INPUT_MISSING";
    check("§4c ⭐ varyant sürümü yoksa desen geneline düşmez (canlı hesap: kalem CANLI ya da kursuz 400)", liveTried, lV2 ? String(snapV2?.kaynak) : JSON.stringify(eV2));
    await refreshQuoteCosts(q);
    const after = await ql();
    check("§4d maliyeti tazele varyant sürümünü korur", after.find((l) => l.recipeId === v1)?.standardCostVersionId === activeV1.id && after.find((l) => l.recipeId === null)?.standardCostVersionId === generic.id);
  } finally {
    await teklifFiksturSil(t);
    const vs = await prisma.standardCostVersion.findMany({ where: { itemId: m.fabricId }, select: { id: true } });
    await prisma.standardCostLine.deleteMany({ where: { versionId: { in: vs.map((v) => v.id) } } });
    await prisma.standardCostVersion.updateMany({ where: { itemId: m.fabricId }, data: { restoredFromId: null } });
    await prisma.standardCostVersion.deleteMany({ where: { itemId: m.fabricId } });
    await prisma.productRecipe.deleteMany({ where: { itemId: { in: [m.fabricId, other.id] } } });
    await prisma.item.delete({ where: { id: other.id } });
    await prisma.finishingRate.deleteMany({ where: { code: variantRate } });
    await fiksturSil(m);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
