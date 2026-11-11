// =============================================================================
// İPLİK BAŞINA FİRE BEKÇİSİ (Seyitoğlu 3. bölüm I2) — `Item.yarnWastePct` tek çözücü `yarn-waste.helper`
// =============================================================================
// İplik kartında fire doluysa o ipliğin kg/m'sinde çözgü/atkı fire zinciri (YAPI/KART/PARAMETRE) YERİNE o
// kullanılır; istek ezmesi (ELLE) yine kazanır; boşken girdi + hash + sonuç bayt-aynı. DB'li (yalnız test DB).
//   §1 bayt-aynı: iplik firesi boş → girdide `wastePct` anahtarı yok, hash ve kg/m ilk ölçümle aynı
//   §2 çözgü ipliği firesi: kg/m = firesiz × 1/(1 − f), kaynak IPLIK; ELLE ezmesi kazanır (KART)
//   §3 atkı ipliği firesi: yalnız o atkı ipliği değişir, öteki zincirde kalır (KART)
//   §4 rapor çekirdeği: `yarnKgByYarn` satırı kaynağı taşır; gramaj (firesiz) iplik firesinden etkilenmez
//   §5 fotoğraf: iplik fireli girdi katı şemadan geçer, geri okunur, hash aynı
//   §6 yazım yolu: 0..50/2 ondalık; aralık dışı 400; KUMAŞ kartına 400 ITEM_YARN_WASTE_YARN_ONLY; null temizler
//   §7 DB CHECK `items_yarn_waste_pct_ck` servis atlansa da 51'i ve KUMAŞ'ı reddeder
// Koşum: npx tsx scripts/test_iplik_firesi.ts
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost, yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { yarnKgByYarn } from "../src/services/reports/yarn-need.report.service";
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
const asm = (itemId: string, o?: Parameters<typeof assembleCostInputTx>[2]) =>
  prisma.$transaction((tx) => assembleCostInputTx(tx, { itemId }, o));
const setYarn = (id: string, v: Prisma.Decimal | null) => prisma.item.update({ where: { id }, data: { yarnWastePct: v } });
const usd = { USD: D(34) };

async function bolum1ila5(f: MaliyetFikstur): Promise<void> {
  const base = await asm(f.fabricId);
  const h0 = costInputHash(base);
  const u0 = yarnUsagePerM(base);
  const cost0 = computeFabricCost(base, usd).result;
  check("§1a İplik firesi boş → girdide iplik `wastePct` anahtarı YOK", !("wastePct" in (base.warp?.yarn ?? {})) && base.weft!.yarns.every((y) => !("wastePct" in y)));
  check("§1b Boşken kaynak her satırda KART", u0.warp?.wasteSource === "KART" && u0.weft.every((w) => w.wasteSource === "KART"));

  // §2 çözgü ipliği
  await setYarn(f.warpYarnId, D("10"));
  const w = await asm(f.fabricId);
  const uw = yarnUsagePerM(w);
  const net = yarnUsagePerM(w, { includeWaste: false }).warp!.kgPerM;
  check("§2a Çözgü iplik firesi girdide (10) ve kaynak IPLIK", w.warp?.yarn.wastePct?.eq(10) === true && uw.warp?.wasteSource === "IPLIK", String(w.warp?.yarn.wastePct));
  check("§2b ⭐ kg/m = firesiz ÷ (1 − 0,10) (zincirin 2% PARAMETRE firesi YERİNE)", r6(uw.warp!.kgPerM) === r6(net.div(D("0.9"))), `${r6(uw.warp!.kgPerM)} vs ${r6(net.div(D("0.9")))}`);
  check("§2c Atkı satırları değişmez (KART, aynı kg/m)", uw.weft.every((x, i) => x.wasteSource === "KART" && r6(x.kgPerM) === r6(u0.weft[i]!.kgPerM)));
  check("§2d Hash değişir (girdi farklı)", costInputHash(w) !== h0);
  const cw = computeFabricCost(w, usd).result;
  check("§2e Motor çözgü kg/m'si iplik firesiyle (maliyet = rapor çekirdeği)", !!cw && r6(cw.warpKgPerM) === r6(uw.warp!.kgPerM) && cw.warpKgPerM.gt(cost0!.warpKgPerM));
  const e = await asm(f.fabricId, { warpWastePct: D("1.5") });
  const ue = yarnUsagePerM(e);
  check("§2f ELLE ezmesi iplik firesini yener (kaynak KART, kg/m = firesiz ÷ 0,985)", ue.warp?.wasteSource === "KART" && r6(ue.warp!.kgPerM) === r6(net.div(D("0.985"))));

  // §3 atkı ipliği (A dolu, B boş)
  await setYarn(f.warpYarnId, null);
  await setYarn(f.weftAId, D("7.5"));
  const a = await asm(f.fabricId);
  const ua = yarnUsagePerM(a);
  const ia = a.weft!.yarns.findIndex((y) => y.yarnItemId === f.weftAId);
  const ib = a.weft!.yarns.findIndex((y) => y.yarnItemId === f.weftBId);
  const netA = yarnUsagePerM(a, { includeWaste: false }).weft[ia]!.kgPerM;
  check("§3a Atkı A: kaynak IPLIK, kg/m = firesiz ÷ 0,925", ua.weft[ia]?.wasteSource === "IPLIK" && r6(ua.weft[ia]!.kgPerM) === r6(netA.div(D("0.925"))));
  check("§3b Atkı B: zincirde (KART), kg/m değişmez", ua.weft[ib]?.wasteSource === "KART" && r6(ua.weft[ib]!.kgPerM) === r6(u0.weft[ib]!.kgPerM));
  check("§3c Çözgü bugünkü gibi (KART, aynı kg/m)", ua.warp?.wasteSource === "KART" && r6(ua.warp!.kgPerM) === r6(u0.warp!.kgPerM));

  // §4 rapor çekirdeği + gramaj
  const rawM = D(1000);
  const ready = [{ d: { itemId: f.fabricId, lineCount: 1, meters: rawM }, code: "X", input: a, usage: ua, rawM }];
  const { perYarn } = yarnKgByYarn(ready, null);
  check("§4a `yarnKgByYarn` satır kaynağı: atkı A IPLIK, atkı B / çözgü KART",
    perYarn.get(f.weftAId)?.wasteSource === "IPLIK" && perYarn.get(f.weftBId)?.wasteSource === "KART" && perYarn.get(f.warpYarnId)?.wasteSource === "KART");
  check("§4b Rapor atkı A kg = kg/m × ham metre", r6(perYarn.get(f.weftAId)!.weft) === r6(ua.weft[ia]!.kgPerM.mul(rawM)));
  const g0 = yarnUsagePerM(base, { includeWaste: false });
  const g1 = yarnUsagePerM(a, { includeWaste: false });
  check("§4c Gramaj (firesiz) iplik firesinden ETKİLENMEZ", r6(g0.weft[ia]!.kgPerM) === r6(g1.weft[ia]!.kgPerM) && r6(g0.warp!.kgPerM) === r6(g1.warp!.kgPerM));

  // §5 fotoğraf
  const snap = serializeCostInput(a);
  const back = parseCostInputSnapshot(JSON.parse(JSON.stringify(snap)));
  check("§5a İplik fireli girdi katı şemadan geçer, geri okunur, hash aynı", costInputHash(back) === costInputHash(a) && back.weft!.yarns[ia]!.wastePct instanceof Prisma.Decimal);
  check("§5b Geri okunan girdi aynı kg/m'yi verir", r6(yarnUsagePerM(back).weft[ia]!.kgPerM) === r6(ua.weft[ia]!.kgPerM));

  await setYarn(f.weftAId, null);
  const z = await asm(f.fabricId);
  check("§1c ⭐ Temizlenince girdi hash'i ilk ölçümle BAYT-AYNI", costInputHash(z) === h0);
  check("§1d ⭐ Temizlenince maliyet sonucu aynı", computeFabricCost(z, usd).result?.totalCostPerMTry.eq(cost0!.totalCostPerMTry) === true);
}

async function bolum6ve7(f: MaliyetFikstur): Promise<void> {
  const code = async (fn: () => Promise<unknown>) =>
    fn().then(() => "ok", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode ?? "?"}${e.details?.code ? ":" + e.details.code : ""}`);
  for (const bad of [51, -1, "abc", "1.234", true]) {
    check(`§6a Geçersiz iplik firesi (${JSON.stringify(bad)}) → 400`, (await code(() => itemService.update(f.warpYarnId, { yarnWastePct: bad }))).startsWith("400"));
  }
  check("§6b İplik kartına '3,25' yazılır", (await code(() => itemService.update(f.warpYarnId, { yarnWastePct: "3,25" }))) === "ok");
  const row = await prisma.item.findUniqueOrThrow({ where: { id: f.warpYarnId }, select: { yarnWastePct: true } });
  check("§6c DB değeri 3.25", row.yarnWastePct?.eq(D("3.25")) === true);
  check("§6d KUMAŞ kartına → 400 ITEM_YARN_WASTE_YARN_ONLY", (await code(() => itemService.update(f.fabricId, { yarnWastePct: 5 }))) === "400:ITEM_YARN_WASTE_YARN_ONLY");
  check("§6e KUMAŞ kartına null zararsız", (await code(() => itemService.update(f.fabricId, { yarnWastePct: null }))) === "ok");
  check("§6f null temizler", (await code(() => itemService.update(f.warpYarnId, { yarnWastePct: null }))) === "ok" &&
    (await prisma.item.findUniqueOrThrow({ where: { id: f.warpYarnId }, select: { yarnWastePct: true } })).yarnWastePct === null);

  const ck = async (id: string, v: number) => prisma.$executeRawUnsafe(`UPDATE items SET "yarnWastePct" = ${v} WHERE id = '${id}'::uuid`).then(() => "ok", (e: Error) => (e.message.includes("items_yarn_waste_pct_ck") ? "CHECK" : e.message.slice(0, 80)));
  check("§7a DB CHECK 51'i reddeder", (await ck(f.warpYarnId, 51)) === "CHECK");
  check("§7b DB CHECK KUMAŞ satırını reddeder", (await ck(f.fabricId, 5)) === "CHECK");
}

async function main(): Promise<void> {
  console.log("=== İPLİK BAŞINA FİRE BEKÇİSİ (SY-3 I2) ===");
  assertGelistirmeVeritabani("test_iplik_firesi");
  const f = await fiksturKur("MIF");
  try {
    await bolum1ila5(f);
    await bolum6ve7(f);
  } finally {
    await prisma.item.updateMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } }, data: { yarnWastePct: null } });
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
