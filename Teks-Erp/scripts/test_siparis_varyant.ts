// =============================================================================
// test_siparis_varyant — SY-K1k: sipariş/teklif/fiyat listesi satırının varyantı + satır hedef değeri
// =============================================================================
//   §1 ⭐ sipariş satırına BAŞKA ürünün varyantı → 400 RECIPE_ITEM_MISMATCH (negatif sonda hedefi)
//   §2 doğru varyant yazılır; pasif varyant yeni satırda 400 RECIPE_INACTIVE; varyantsız satır bugünkü gibi (NULL, hedef yok)
//   §3 güncelleme: gövdede recipeId yoksa korunur; ürün değişip eski varyant kalırsa 400 RECIPE_ITEM_MISMATCH
//   §4 ⭐ hedef değer: çeşit değeri yazılır + BAYRAK ikizi requiredProperties'e KENDİLİĞİNDEN girer;
//      çeşit olmayan özellik 400; gövdede yoksa küme korunur (ikizi de, §4e); boş dizi temizler
//   §5 ⭐ teklif kalemi uyumsuz varyant 400; teklif → sipariş varyantı TAŞIR
//   §6 ⭐ fiyat listesi: varyantsız tekillik AYNI (aynı ürün+renk iki kez 400 · DB unique P2002); varyantlı satır
//      desen genelinin yanında durur; uyumsuz varyant 400; teklif önerisi varyant fiyatını önce seçer
// Çalıştır: npx tsx scripts/test_siparis_varyant.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { convertQuoteToOrder } from "../src/services/sales-quote-convert.service";
import { addQuoteLine } from "../src/services/sales-quote-lines.service";
import { createPriceList, publishPriceList, replacePriceListLines } from "../src/services/price-list.service";
import { resolveQuotePriceSuggestionTx } from "../src/services/helpers/quote-price.helper";
import { fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
type Hata = { status?: number; code?: string } | null;
async function hata(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; code?: string; details?: { code?: string } };
    return { status: err.statusCode, code: err.details?.code ?? err.code };
  }
}

async function orderSvc() {
  return (await import("../src/routes/order.routes")).orderService;
}

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_siparis_varyant");
  const m = await fiksturKur("SYV");
  const t = await teklifFiksturKur("SYV");
  const made = { recipes: [] as string[], props: [] as string[], items: [] as string[] };
  try {
    const svc = await orderSvc();
    const other = await prisma.item.create({ data: { code: `${t.tag}-O`, name: `${t.tag} başka kumaş`, itemType: "FABRIC" }, select: { id: true } });
    made.items.push(other.id);
    const recipe = (code: string, itemId: string, isActive = true) =>
      prisma.productRecipe.create({ data: { code: `${t.tag}-${code}`, name: `${t.tag} ${code}`, itemId, variantCode: code, isActive }, select: { id: true } });
    const v1 = await recipe("V01", m.fabricId);
    const vPassive = await recipe("V09", m.fabricId, false);
    const vOther = await recipe("V01X", other.id);
    made.recipes.push(v1.id, vPassive.id, vOther.id);
    const flag = await prisma.fabricProperty.create({ data: { code: `${t.tag}-KS`.slice(0, 32), name: `TEST Kuşak ${t.tag}`, valueType: "FLAG" }, select: { id: true } });
    made.props.push(flag.id);
    const kusak = await prisma.fabricProperty.create({
      data: {
        code: `${t.tag}-KM`.slice(0, 32), name: `TEST Kuşak markası ${t.tag}`, valueType: "CHOICE", variantOfPropertyId: flag.id,
        values: { create: [{ code: `${t.tag}ZB`.slice(0, 32), name: "Zebra" }, { code: `${t.tag}JS`.slice(0, 32), name: "Jasmin" }] },
      },
      select: { id: true, values: { select: { id: true, name: true } } },
    });
    made.props.push(kusak.id);
    const zebra = kusak.values.find((v) => v.name === "Zebra")!.id;
    const plainChoice = await prisma.fabricProperty.create({
      data: { code: `${t.tag}-GR`.slice(0, 32), name: `TEST Gramaj ${t.tag}`, valueType: "CHOICE", values: { create: [{ code: `${t.tag}G1`.slice(0, 32), name: "G1" }] } },
      select: { id: true, values: { select: { id: true } } },
    });
    made.props.push(plainChoice.id);

    const order = (line: Record<string, unknown>) =>
      svc.create({ customerId: t.customerId, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: m.fabricId, quantity: 100, unitPrice: 10, ...line }] });
    const linesOf = (orderId: string) =>
      prisma.orderLine.findMany({ where: { orderId }, select: { id: true, itemId: true, recipeId: true, quantity: true, requiredProperties: { select: { propertyId: true } }, targetValues: { select: { propertyId: true, valueId: true } } } });
    const idOf = (r: unknown) => ((r as { data: { id: string } }).data.id);

    // §1
    const e1 = await hata(() => order({ recipeId: vOther.id }));
    check("§1 ⭐ başka ürünün varyantı → 400 RECIPE_ITEM_MISMATCH", e1?.status === 400 && e1.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(e1));

    // §2
    const o2 = idOf(await order({ recipeId: v1.id }));
    const l2 = (await linesOf(o2))[0]!;
    check("§2a doğru varyant satıra yazılır", l2.recipeId === v1.id);
    const e2 = await hata(() => order({ recipeId: vPassive.id }));
    check("§2b pasif varyant yeni satırda → 400 RECIPE_INACTIVE", e2?.status === 400 && e2.code === "RECIPE_INACTIVE", JSON.stringify(e2));
    const o2c = idOf(await order({}));
    const l2c = (await linesOf(o2c))[0]!;
    check("§2c varyantsız satır bugünkü gibi (recipeId NULL, hedef yok, özellik yok)", l2c.recipeId === null && l2c.targetValues.length === 0 && l2c.requiredProperties.length === 0);

    // §3
    await svc.update(o2, { lines: [{ id: l2.id, itemId: m.fabricId, quantity: 120, unitPrice: 10 }] });
    const l3 = (await linesOf(o2))[0]!;
    check("§3a gövdede recipeId yok → varyant korunur", l3.recipeId === v1.id && Number(l3.quantity) === 120);
    const e3 = await hata(() => svc.update(o2, { lines: [{ id: l2.id, itemId: other.id, quantity: 120, unitPrice: 10 }] }));
    check("§3b ürün değişti, eski varyant kaldı → 400 RECIPE_ITEM_MISMATCH", e3?.status === 400 && e3.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(e3));
    await svc.update(o2, { lines: [{ id: l2.id, itemId: m.fabricId, quantity: 120, unitPrice: 10, recipeId: null }] });
    check("§3c recipeId null → desen geneline döner", (await linesOf(o2))[0]!.recipeId === null);

    // §4
    const o4 = idOf(await order({ targetValues: [{ propertyId: kusak.id, valueId: zebra }] }));
    const l4 = (await linesOf(o4))[0]!;
    check(
      "§4a ⭐ hedef değer yazılır + BAYRAK ikizi requiredProperties'e kendiliğinden girer",
      l4.targetValues.length === 1 && l4.targetValues[0]!.valueId === zebra && l4.requiredProperties.some((p) => p.propertyId === flag.id),
      JSON.stringify(l4),
    );
    const e4 = await hata(() => order({ targetValues: [{ propertyId: plainChoice.id, valueId: plainChoice.values[0]!.id }] }));
    check("§4b çeşit olmayan özellik → 400 TARGET_PROPERTY_NOT_VARIANT", e4?.status === 400 && e4.code === "TARGET_PROPERTY_NOT_VARIANT", JSON.stringify(e4));
    await svc.update(o4, { lines: [{ id: l4.id, itemId: m.fabricId, quantity: 100, unitPrice: 10, requiredPropertyIds: [flag.id] }] });
    check("§4c gövdede targetValues yok → küme korunur", (await linesOf(o4))[0]!.targetValues.length === 1);
    await svc.update(o4, { lines: [{ id: l4.id, itemId: m.fabricId, quantity: 100, unitPrice: 10, requiredPropertyIds: [] }] });
    const l4e = (await linesOf(o4))[0]!;
    check(
      "§4e ⭐ targetValues yok + ikiz listeden çıkarıldı → hedef korunur, BAYRAK ikizi requiredProperties'te KALIR",
      l4e.targetValues.length === 1 && l4e.requiredProperties.some((p) => p.propertyId === flag.id),
      JSON.stringify(l4e),
    );
    await svc.update(o4, { lines: [{ id: l4.id, itemId: m.fabricId, quantity: 100, unitPrice: 10, requiredPropertyIds: [flag.id], targetValues: [] }] });
    check("§4d boş dizi → küme temizlenir", (await linesOf(o4))[0]!.targetValues.length === 0);

    // §5
    const q = await teklifYaz(t, "DRAFT", { itemId: m.fabricId });
    const e5 = await hata(() => addQuoteLine(q, { itemId: m.fabricId, recipeId: vOther.id, quantity: 50, unitPrice: 3, markupPct: 10 }));
    check("§5a ⭐ teklif kalemi uyumsuz varyant → 400 RECIPE_ITEM_MISMATCH", e5?.status === 400 && e5.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(e5));
    const acc = await teklifYaz(t, "ACCEPTED", { itemId: m.fabricId });
    await prisma.salesQuoteLine.updateMany({ where: { quoteId: acc }, data: { recipeId: v1.id } });
    const conv = await convertQuoteToOrder(acc, { clientToken: randomUUID() }, { permissions: ["quote:convert", "order:write"] });
    check("§5b ⭐ teklif → sipariş varyantı taşır", (await linesOf(conv.orderId))[0]?.recipeId === v1.id);

    // §6
    const pl = await createPriceList({ clientToken: randomUUID(), customerId: t.customerId, currency: "USD", name: `${t.tag} liste` });
    const line = (extra: Record<string, unknown>) => ({ itemId: m.fabricId, unitPrice: 5, ...extra });
    const e6a = await hata(() => replacePriceListLines(pl.id, { lines: [line({}), line({ unitPrice: 6 })] }));
    check("§6a varyantsız aynı ürün+renk iki kez → 400 PRICE_LIST_DUPLICATE_LINE (bugünkü)", e6a?.status === 400 && e6a.code === "PRICE_LIST_DUPLICATE_LINE", JSON.stringify(e6a));
    const e6b = await hata(() => replacePriceListLines(pl.id, { lines: [line({ recipeId: vOther.id })] }));
    check("§6b uyumsuz varyant → 400 RECIPE_ITEM_MISMATCH", e6b?.status === 400 && e6b.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(e6b));
    const rec = await replacePriceListLines(pl.id, { lines: [line({}), line({ recipeId: v1.id, unitPrice: 7 })] });
    check("§6c varyantlı satır desen genelinin yanında durur", rec.lines.length === 2 && rec.lines.some((l) => l.recipeId === v1.id));
    let dbDup: string | null = null;
    try {
      await prisma.priceListLine.create({ data: { priceListId: pl.id, lineNo: 99, itemId: m.fabricId, unitPrice: new Prisma.Decimal(9) } });
    } catch (e) {
      dbDup = (e as { code?: string }).code ?? "?";
    }
    check("§6d DB tekilliği varyantsızda AYNI (ürün+renk NULL ikinci satır → P2002)", dbDup === "P2002", String(dbDup));
    await publishPriceList(pl.id);
    const sug = (recipeId: string | null) =>
      prisma.$transaction((tx) =>
        resolveQuotePriceSuggestionTx(tx, { itemId: m.fabricId, colorId: null, recipeId, customerId: t.customerId, currency: "USD", costPerMTry: null, markupPct: new Prisma.Decimal(10), fxRate: null }),
      );
    const sV = await sug(v1.id);
    const sG = await sug(null);
    check("§6e teklif önerisi: varyant fiyatı önce, varyantsızda desen geneli (bugünkü)", sV.suggested?.toString() === "7" && sG.suggested?.toString() === "5", `${sV.suggested} / ${sG.suggested}`);
  } finally {
    await teklifFiksturSil(t);
    await prisma.orderLine.deleteMany({ where: { order: { customerId: t.customerId } } });
    await prisma.productRecipe.deleteMany({ where: { id: { in: made.recipes } } });
    await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } });
    await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } });
    await prisma.item.deleteMany({ where: { id: { in: made.items } } });
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
