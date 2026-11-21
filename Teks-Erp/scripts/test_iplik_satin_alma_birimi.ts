// =============================================================================
// İPLİK SATIN ALMA BİRİMİ BEKÇİSİ (Seyitoğlu SY-a) — `Item.yarnPurchaseUnit` (NULL = KG), tek kaynak `constants/yarn-unit.ts`
// =============================================================================
// Pul adetle, payet şerit metreyle alınır: maliyet birim fiyattan, iplik kg hesabına (stok/ihtiyaç/gramaj) GİRMEZ.
//   §1 bayt-aynı: KG iplikte girdide `unit`/`piecesPerM` anahtarı yok; KG'ye dönünce hash + sonuç ilk ölçümle aynı
//   §2 METRE: atkı satırı = m/m ÷ (1 − f) × metre fiyatı; kg fiyatı adet/metre sanılmaz (YARN_PRICE_MISSING); kg kümesinden düşer
//   §3 ADET: adet/m yoksa YARN_PIECES_MISSING (kg sorusu etkilenmez); satır = m/m ÷ (1 − f) × adet/m × adet fiyatı
//   §4 fotoğraf: birimli girdi katı şemadan geçer, geri okunur, hash aynı
//   §5 yazım: KUMAŞ'a 400, ADET dışına adet/m 400, geçersiz birim 400, çözgüdeki iplik 400, "KG" → NULL, ADET→KG adet/m'yi temizler
//   §6 kartlar: denyesiz ADET iplik atkı kartına girer; çözgüye giremez; denyesiz KG iplik atkıda yine 400
//   §7 DB CHECK: KUMAŞ'ta birim ve KG'de adet/m reddedilir
// Koşum: npx tsx scripts/test_iplik_satin_alma_birimi.ts
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost, yarnUsagePerM, type CostInput } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { changeYarnCostPrice } from "../src/services/yarn-cost-price.service";
import { createWeftSpec } from "../src/services/weft-spec.service";
import { assertWarpYarnItem } from "../src/services/helpers/warp-spec-yarn-write.helper";
import { itemService } from "../src/routes/item.routes";
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
const r6 = (d: Prisma.Decimal | null | undefined) => d?.toDecimalPlaces(6).toString() ?? "null";
const asm = (itemId: string) => prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId }));
const usd = { USD: D(34) };
const code = async (fn: () => Promise<unknown>) =>
  fn().then(() => "ok", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode ?? "?"}${e.details?.code ? ":" + e.details.code : ""}`);
const setUnit = (id: string, yarnPurchaseUnit: "ADET" | "METRE" | null, yarnPiecesPerM: Prisma.Decimal | null = null) =>
  prisma.item.update({ where: { id }, data: { yarnPurchaseUnit, yarnPiecesPerM } });
const weftLine = (input: CostInput, yarnItemId: string) => computeFabricCost(input, usd).result?.lines.find((l) => l.component === "WEFT_YARN" && l.yarnItemId === yarnItemId);

async function bolum1ila4(f: MaliyetFikstur): Promise<void> {
  const base = await asm(f.fabricId);
  const h0 = costInputHash(base);
  const cost0 = computeFabricCost(base, usd).result!;
  const u0 = yarnUsagePerM(base);
  const ia = base.weft!.yarns.findIndex((y) => y.yarnItemId === f.weftAId);
  check("§1a KG iplikte girdide `unit`/`piecesPerM` anahtarı YOK", base.weft!.yarns.every((y) => !("unit" in y) && !("piecesPerM" in y)));
  // Atkı metre/m (kart: 28 atkı/cm, çözgü kartı tarak eni 310 cm, Σ atım 2, parametre atkı firesi %3).
  const mB = D(28).mul(100).mul(D(310).div(100)).mul(D(1).div(2)).div(D(1).minus(D("0.03")));

  // §2 METRE
  await setUnit(f.weftBId, "METRE");
  const m1 = await asm(f.fabricId);
  const out1 = computeFabricCost(m1, usd);
  check("§2a Kg fiyatı METRE iplikte okunmaz → YARN_PRICE_MISSING, sonuç yok", out1.result === null && out1.missing.includes("YARN_PRICE_MISSING"), out1.missing.join(","));
  check("§2b Girdide unit=METRE, denye zorunlu değil (DENIER_MISSING yok)", m1.weft!.yarns.find((y) => y.yarnItemId === f.weftBId)?.unit === "METRE" && !out1.missing.includes("DENIER_MISSING"));
  await changeYarnCostPrice({ yarnItemId: f.weftBId, currency: "USD", pricePerKg: "0.02" });
  const p1 = await prisma.yarnCostPrice.findFirstOrThrow({ where: { yarnItemId: f.weftBId, revokedAt: null }, select: { unit: true } });
  check("§2c Fiyat yazımı kartın birimini dondurur (METRE)", p1.unit === "METRE");
  const m2 = await asm(f.fabricId);
  const lb = weftLine(m2, f.weftBId);
  check("§2d ⭐ Satır = m/m ÷ (1 − f) × metre fiyatı × kur", !!lb && lb.qtyUnit === "m" && r6(lb.qty) === r6(mB) && r6(lb.amountPerMTry) === r6(mB.mul(D("0.02")).mul(34)), `${r6(lb?.qty)} ${r6(lb?.amountPerMTry)}`);
  const r2 = computeFabricCost(m2, usd).result!;
  check("§2e Motorun atkı kg/m'si yalnız KG iplikten (METRE kg'ye girmez)", r6(r2.weftKgPerM) === r6(u0.weft[ia]!.kgPerM));
  const u2 = yarnUsagePerM(m2);
  check("§2f ⭐ yarnUsagePerM (stok/ihtiyaç/gramaj) METRE ipliği LİSTELEMEZ", u2.weft.length === 1 && u2.weft[0]!.yarnItemId === f.weftAId && u2.missing.length === 0);
  check("§2g Atkı A satırı değişmez", r6(weftLine(m2, f.weftAId)?.amountPerMTry) === r6(cost0.lines.find((l) => l.yarnItemId === f.weftAId)?.amountPerMTry));

  // §3 ADET
  await setUnit(f.weftBId, "ADET");
  const a1 = await asm(f.fabricId);
  const outA = computeFabricCost(a1, usd);
  check("§3a ADET'te adet/m yoksa YARN_PIECES_MISSING", outA.result === null && outA.missing.includes("YARN_PIECES_MISSING"), outA.missing.join(","));
  check("§3b Kg sorusu (yarnUsagePerM) adet/m eksikliğinden etkilenmez", yarnUsagePerM(a1).missing.length === 0 && yarnUsagePerM(a1).weft.length === 1);
  await setUnit(f.weftBId, "ADET", D(333));
  await changeYarnCostPrice({ yarnItemId: f.weftBId, currency: "USD", pricePerKg: "0.0001" });
  const a2 = await asm(f.fabricId);
  const la = weftLine(a2, f.weftBId);
  const qty = mB.mul(333);
  check("§3c ⭐ Satır = m/m ÷ (1 − f) × adet/m × adet fiyatı × kur", !!la && la.qtyUnit === "adet" && r6(la.qty) === r6(qty) && r6(la.amountPerMTry) === r6(qty.mul(D("0.0001")).mul(34)), `${r6(la?.qty)} ${r6(la?.amountPerMTry)}`);
  check("§3d Girdide piecesPerM = 333", a2.weft!.yarns.find((y) => y.yarnItemId === f.weftBId)?.piecesPerM?.eq(333) === true);

  // §4 fotoğraf
  const back = parseCostInputSnapshot(JSON.parse(JSON.stringify(serializeCostInput(a2))));
  const yb = back.weft!.yarns.find((y) => y.yarnItemId === f.weftBId)!;
  check("§4a Birimli girdi katı şemadan geçer, geri okunur, hash aynı", costInputHash(back) === costInputHash(a2) && yb.piecesPerM instanceof Prisma.Decimal && yb.unit === "ADET");
  check("§4b Geri okunan girdi aynı maliyeti verir", r6(computeFabricCost(back, usd).result?.totalCostPerMTry) === r6(computeFabricCost(a2, usd).result?.totalCostPerMTry));

  // §1 KG'ye dönüş
  await setUnit(f.weftBId, null);
  await changeYarnCostPrice({ yarnItemId: f.weftBId, currency: "USD", pricePerKg: "3.10" });
  const z = await asm(f.fabricId);
  check("§1b ⭐ KG'ye dönünce girdi hash'i ilk ölçümle BAYT-AYNI", costInputHash(z) === h0);
  check("§1c ⭐ KG'ye dönünce maliyet aynı", computeFabricCost(z, usd).result?.totalCostPerMTry.eq(cost0.totalCostPerMTry) === true);
}

async function bolum5ila7(f: MaliyetFikstur, extra: string[]): Promise<void> {
  for (const bad of ["LITRE", 5, "adet"]) {
    check(`§5a Geçersiz birim (${JSON.stringify(bad)}) → 400 ITEM_YARN_UNIT_INVALID`, (await code(() => itemService.update(f.weftAId, { yarnPurchaseUnit: bad }))) === "400:ITEM_YARN_UNIT_INVALID");
  }
  check("§5b KUMAŞ kartına birim → 400 ITEM_YARN_UNIT_YARN_ONLY", (await code(() => itemService.update(f.fabricId, { yarnPurchaseUnit: "ADET" }))) === "400:ITEM_YARN_UNIT_YARN_ONLY");
  check("§5c KG iplikte adet/m → 400 ITEM_YARN_PIECES_ADET_ONLY", (await code(() => itemService.update(f.weftAId, { yarnPiecesPerM: 100 }))) === "400:ITEM_YARN_PIECES_ADET_ONLY");
  check("§5d Çözgüdeki iplik ADET yapılamaz → 400 ITEM_YARN_UNIT_IN_WARP", (await code(() => itemService.update(f.warpYarnId, { yarnPurchaseUnit: "ADET" }))) === "400:ITEM_YARN_UNIT_IN_WARP");
  check("§5e Atkı ipliği ADET + adet/m '333,5' yazılır", (await code(() => itemService.update(f.weftAId, { yarnPurchaseUnit: "ADET", yarnPiecesPerM: "333,5" }))) === "ok");
  const row = await prisma.item.findUniqueOrThrow({ where: { id: f.weftAId }, select: { yarnPurchaseUnit: true, yarnPiecesPerM: true } });
  check("§5f DB: ADET, 333.5", row.yarnPurchaseUnit === "ADET" && row.yarnPiecesPerM?.eq(D("333.5")) === true);
  check("§5g 'KG' yazımı NULL'a normalize olur ve adet/m temizlenir", (await code(() => itemService.update(f.weftAId, { yarnPurchaseUnit: "KG" }))) === "ok" &&
    JSON.stringify(await prisma.item.findUniqueOrThrow({ where: { id: f.weftAId }, select: { yarnPurchaseUnit: true, yarnPiecesPerM: true } })) === JSON.stringify({ yarnPurchaseUnit: null, yarnPiecesPerM: null }));

  // §6 kartlar
  const pul = await prisma.item.create({ data: { code: `${f.tag}-PUL`, name: `${f.tag} PUL 3 MM`, itemType: ItemType.YARN, yarnPurchaseUnit: "ADET", yarnPiecesPerM: D(333) }, select: { id: true } });
  const bare = await prisma.item.create({ data: { code: `${f.tag}-DNS`, name: `${f.tag} 600 KAR IPI`, itemType: ItemType.YARN }, select: { id: true } });
  extra.push(pul.id, bare.id);
  const ws = await code(() => createWeftSpec({ code: `${f.tag}-PF`, name: `${f.tag} pul atkı`, picksPerCm: "18", yarns: [{ yarnItemId: f.weftAId, picksInRepeat: 25 }, { yarnItemId: pul.id, picksInRepeat: 5 }] }));
  check("§6a ⭐ Denyesiz ADET (pul) iplik atkı kartına girer", ws === "ok", ws);
  check("§6b Denyesiz KG iplik atkı kartında yine 400", (await code(() => createWeftSpec({ code: `${f.tag}-PG`, name: "x", yarns: [{ yarnItemId: bare.id, picksInRepeat: 1 }] }))).startsWith("400"));
  check("§6c ADET iplik çözgüye giremez → 400 WARP_YARN_NON_KG_UNIT", (await code(() => assertWarpYarnItem(pul.id))) === "400:WARP_YARN_NON_KG_UNIT");

  // §7 DB CHECK
  const ck = async (sql: string, name: string) => prisma.$executeRawUnsafe(sql).then(() => "ok", (e: Error) => (e.message.includes(name) ? "CHECK" : e.message.slice(0, 80)));
  check("§7a CHECK: KUMAŞ'ta birim reddedilir", (await ck(`UPDATE items SET "yarnPurchaseUnit" = 'ADET' WHERE id = '${f.fabricId}'::uuid`, "items_yarn_purchase_unit_ck")) === "CHECK");
  check("§7b CHECK: KG iplikte adet/m reddedilir", (await ck(`UPDATE items SET "yarnPiecesPerM" = 10 WHERE id = '${f.weftAId}'::uuid`, "items_yarn_pieces_per_m_ck")) === "CHECK");
}

async function main(): Promise<void> {
  console.log("=== İPLİK SATIN ALMA BİRİMİ BEKÇİSİ (SY-a) ===");
  assertGelistirmeVeritabani("test_iplik_satin_alma_birimi");
  const f = await fiksturKur("MSB");
  const extra: string[] = [];
  try {
    await bolum1ila4(f);
    await bolum5ila7(f, extra);
  } finally {
    const specs = await prisma.weftSpec.findMany({ where: { code: { startsWith: f.tag } , id: { not: f.weftSpecId } }, select: { id: true } });
    await prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: specs.map((s) => s.id) } } });
    await prisma.weftSpec.deleteMany({ where: { id: { in: specs.map((s) => s.id) } } });
    await prisma.item.updateMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } }, data: { yarnPurchaseUnit: null, yarnPiecesPerM: null } });
    await prisma.item.deleteMany({ where: { id: { in: extra } } });
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
