// =============================================================================
// MALİYET GİRDİ DERLEYİCİSİ BEKÇİSİ (MAL-2) — kaynak önceliği (plan §2.1), fotoğraf ve hash
// =============================================================================
// `assembleCostInputTx` motor girdisinin TEK kurucusudur; her değer kaynağıyla yazılır. DB'li
// (yalnız test DB — `assertGelistirmeVeritabani`). Ölçülenler:
//   §1 kart: take-up/tarak eni KART; yapı yokken fire/devir/randıman PARAMETRE
//   §2 yapı: fire, devir, randıman, atkı boyu, levent boyu, çekme YAPI'dan
//   §3 ezme: ELLE her katmanı yener; ölçülmüş fire OLCULMUS kaynağıyla
//   §4 atkı boyu yedeği: tarak eni yok → ham en + pay (uyarı bayrağı); o da yok → null
//   §5 take-up yedeği: kart boş → parametre; ikisi boş → null
//   §6 fiyatlar: yalnız aktif (damgalı satır okunmaz); 90 gün → PRICE_STALE; tarife çözülmez → null
//   §7 kapılar: kumaş değil 400 COST_FABRIC_ONLY · ürün yok 404
//   §8 elle yapı (adHoc) ELLE kaynaklı; fotoğraf gidiş-dönüş + hash kararlılığı; DB ürünü = altın
// Koşum: npx tsx scripts/test_maliyet_girdi.ts
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const asm = (ref: Parameters<typeof assembleCostInputTx>[1], o?: Parameters<typeof assembleCostInputTx>[2]) =>
  prisma.$transaction((tx) => assembleCostInputTx(tx, ref, o));
const sv = (s: { value: Prisma.Decimal | null; source: string } | undefined) => `${s?.value?.toString() ?? "null"}/${s?.source}`;

async function bolum1(f: MaliyetFikstur): Promise<void> {
  const i = await asm({ itemId: f.fabricId });
  check("§1a Take-up kartın (6/KART)", sv(i.warp?.takeUpPct) === "6/KART", sv(i.warp?.takeUpPct));
  check("§1b Atkı boyu tarak eninden (310/KART), bayraksız", sv(i.weft?.lengthCm) === "310/KART" && !i.weft?.lengthCm.flag, sv(i.weft?.lengthCm));
  check("§1c Yapı yok: çözgü firesi PARAMETRE", sv(i.warp?.wastePct) === "2/PARAMETRE", sv(i.warp?.wastePct));
  check("§1d Yapı yok: devir/randıman PARAMETRE", sv(i.loom.rpm) === "500/PARAMETRE" && sv(i.loom.efficiencyPct) === "80/PARAMETRE");
  check("§1e Denye kartın (resolveDenier), atkı sırası korunur", i.warp?.yarn.denier.value?.eq(75) === true && i.weft?.yarns.map((y) => y.denier.value?.toString()).join(",") === "150,300");
  check("§1f Yapı yok → tarife yok (ham satış)", i.finishing === null);
}

async function bolum2(f: MaliyetFikstur): Promise<void> {
  await altinYapiYaz(f);
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { weftLengthCm: D(305), beamLengthM: D(2500) } });
  const i = await asm({ itemId: f.fabricId });
  check("§2a Yapı fireleri YAPI", sv(i.warp?.wastePct) === "2.5/YAPI" && sv(i.weft?.wastePct) === "3/YAPI" && sv(i.fabricWastePct) === "2/YAPI");
  check("§2b Yapı devir/randıman YAPI", sv(i.loom.rpm) === "600/YAPI" && sv(i.loom.efficiencyPct) === "85/YAPI");
  check("§2c Yapı atkı boyu tarak enini yener", sv(i.weft?.lengthCm) === "305/YAPI", sv(i.weft?.lengthCm));
  check("§2d Yapı levent boyu YAPI, hazırlık PARAMETRE", sv(i.beam.lengthM) === "2500/YAPI" && sv(i.beam.prepCostTry) === "4500/PARAMETRE");
  check("§2e Yapı çekmesi tarifeninkini yener; tarife çözüldü", sv(i.lengthShrinkPct) === "4/YAPI" && i.finishing?.price?.amount.eq(18) === true);
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { weftLengthCm: null, beamLengthM: null, lengthShrinkPct: null } });
  const j = await asm({ itemId: f.fabricId });
  check("§2f Yapıda çekme boş → tarifenin tipik çekmesi (KART)", sv(j.lengthShrinkPct) === "4/KART", sv(j.lengthShrinkPct));
}

async function bolum3(f: MaliyetFikstur): Promise<void> {
  const i = await asm({ itemId: f.fabricId }, { warpWastePct: D("1.7"), loomRpm: D(650), takeUpPct: D(7), finishingRateCode: null });
  check("§3a ELLE ezme yapıyı/kartı yener", sv(i.warp?.wastePct) === "1.7/ELLE" && sv(i.loom.rpm) === "650/ELLE" && sv(i.warp?.takeUpPct) === "7/ELLE");
  check("§3b Tarife ezmeyle kaldırılır (ham satış önizlemesi)", i.finishing === null);
  const m = await asm({ itemId: f.fabricId }, { warpWastePct: D("3.1"), warpWasteMeasured: true });
  check("§3c Ölçülmüş fire OLCULMUS kaynağıyla", sv(m.warp?.wastePct) === "3.1/OLCULMUS");
}

async function bolum4(f: MaliyetFikstur): Promise<void> {
  await prisma.warpSpec.update({ where: { id: f.warpSpecId }, data: { reedWidthCm: null } });
  const i = await asm({ itemId: f.fabricId });
  check("§4a Tarak eni yok → ham en + pay (300+4), WEFT_LENGTH_FROM_WIDTH bayrağı", sv(i.weft?.lengthCm) === "304/KART" && i.weft?.lengthCm.flag === "WEFT_LENGTH_FROM_WIDTH", sv(i.weft?.lengthCm));
  await prisma.item.update({ where: { id: f.fabricId }, data: { rawWidthCm: null } });
  const j = await asm({ itemId: f.fabricId });
  check("§4b Ham en de yok → atkı boyu null (motor WEFT_LENGTH_MISSING)", j.weft?.lengthCm.value === null && computeFabricCost(j, { USD: D(34) }).missing.includes("WEFT_LENGTH_MISSING"));
  await prisma.item.update({ where: { id: f.fabricId }, data: { rawWidthCm: D(300) } });
  await prisma.warpSpec.update({ where: { id: f.warpSpecId }, data: { reedWidthCm: D(310) } });
}

async function bolum5(f: MaliyetFikstur): Promise<void> {
  await prisma.warpSpec.update({ where: { id: f.warpSpecId }, data: { takeUpPct: null } });
  const i = await asm({ itemId: f.fabricId });
  check("§5a Kart take-up boş → parametre varsayılanı (5/PARAMETRE)", sv(i.warp?.takeUpPct) === "5/PARAMETRE");
  await prisma.costParameterSet.update({ where: { id: f.paramId }, data: { defaultTakeUpPct: null } });
  const j = await asm({ itemId: f.fabricId });
  check("§5b İkisi de boş → null (motor TAKEUP_MISSING)", j.warp?.takeUpPct.value === null && computeFabricCost(j, { USD: D(34) }).missing.includes("TAKEUP_MISSING"));
  await prisma.costParameterSet.update({ where: { id: f.paramId }, data: { defaultTakeUpPct: D(5) } });
  await prisma.warpSpec.update({ where: { id: f.warpSpecId }, data: { takeUpPct: D(6) } });
}

async function bolum6(f: MaliyetFikstur): Promise<void> {
  const old = await prisma.yarnCostPrice.findFirst({ where: { yarnItemId: f.warpYarnId, revokedAt: null } });
  await prisma.yarnCostPrice.update({ where: { id: old!.id }, data: { revokedAt: new Date(), revokeReason: "test" } });
  await prisma.yarnCostPrice.create({ data: { yarnItemId: f.warpYarnId, currency: "USD", pricePerKg: D("9.99"), note: f.tag, createdAt: new Date(Date.now() - 100 * 86_400_000) } });
  const i = await asm({ itemId: f.fabricId });
  check("§6a Damgalı (eski) fiyat okunmaz, aktif olan okunur", i.warp?.yarn.price?.amount.eq("9.99") === true);
  check("§6b 90 günden eski fiyat → PRICE_STALE bayrağı", i.warp?.yarn.price?.flag === "PRICE_STALE" && computeFabricCost(i, { USD: D(34) }).warnings.includes("PRICE_STALE"));
  await prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: f.warpYarnId, pricePerKg: D("9.99") } });
  await prisma.yarnCostPrice.update({ where: { id: old!.id }, data: { revokedAt: null, revokeReason: null } });
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: "YOK-BOYLE-KOD" } });
  const j = await asm({ itemId: f.fabricId });
  check("§6c Tarife kodu çözülmüyor → FINISHING_RATE_MISSING (terbiye sessizce 0 olmaz)", j.finishing?.price === null && computeFabricCost(j, { USD: D(34) }).missing.includes("FINISHING_RATE_MISSING"));
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: f.rateCode, lengthShrinkPct: D(4) } });
}

async function bolum7(f: MaliyetFikstur): Promise<void> {
  const err = async (fn: () => Promise<unknown>) => fn().then(() => null, (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode}/${e.details?.code ?? ""}`);
  check("§7a Kumaş değil → 400 COST_FABRIC_ONLY", (await err(() => asm({ itemId: f.warpYarnId }))) === "400/COST_FABRIC_ONLY");
  check("§7b Ürün yok → 404", (await err(() => asm({ itemId: "00000000-0000-4000-8000-000000000000" })))?.startsWith("404") === true);
}

async function bolum8(f: MaliyetFikstur): Promise<void> {
  const fromDb = await asm({ itemId: f.fabricId });
  const out = computeFabricCost(fromDb, { USD: D(34) });
  check("§8a ⭐ DB'deki §2.3 ürünü altın standardı verir (77,0395)", out.result?.totalCostPerMTry.toDecimalPlaces(4).toFixed(4) === "77.0395", `${out.result?.totalCostPerMTry.toFixed(6)} ${out.missing.join(",")}`);
  const snap = serializeCostInput(fromDb);
  const back = parseCostInputSnapshot(JSON.parse(JSON.stringify(snap)));
  check("§8b Fotoğraf gidiş-dönüş: aynı hash, aynı sonuç", costInputHash(back) === costInputHash(fromDb) && computeFabricCost(back, { USD: D(34) }).result?.totalCostPerMTry.eq(out.result!.totalCostPerMTry) === true);
  check("§8c Hash 64 hex, girdi değişince değişir", /^[0-9a-f]{64}$/.test(costInputHash(fromDb)) && costInputHash({ ...fromDb, overheadPct: { value: D(13), source: "PARAMETRE" } }) !== costInputHash(fromDb));
  check("§8d Hash ölçekten bağımsız (6.00 = 6), bayraktan bağımsız", costInputHash({ ...fromDb, overheadPct: { value: D("12.00"), source: "PARAMETRE", flag: "PRICE_STALE" } }) === costInputHash(fromDb));
  let threw = false;
  try {
    parseCostInputSnapshot({ ...snap, gizli: 1 });
  } catch {
    threw = true;
  }
  check("§8e Katı şema: tanınmayan alan reddedilir", threw);
  const ad = await asm({
    adHoc: {
      warp: { endsCount: 9600, takeUpPct: D(6), yarn: { name: "PES 75", denier: D(75), pricePerKg: D("88.4"), currency: "TRY" } },
      weft: { picksPerCm: D(28), rawWidthCm: D(306), yarns: [{ name: "A", denier: D(150), pricePerKg: D("81.6"), currency: "TRY", picksInRepeat: 1 }] },
    },
  });
  check("§8f Elle yapı ELLE kaynaklı; atkı boyu ham en + pay", sv(ad.warp?.takeUpPct) === "6/ELLE" && ad.warp?.yarn.price?.source === "ELLE" && sv(ad.weft?.lengthCm) === "310/KART" && ad.weft?.lengthCm.flag === "WEFT_LENGTH_FROM_WIDTH");
  check("§8g Elle yapı hesaplanır (TRY, kur istemez)", computeFabricCost(ad, {}).result !== null);
}

async function main(): Promise<void> {
  console.log("=== MALİYET GİRDİ DERLEYİCİSİ BEKÇİSİ (MAL-2) ===");
  assertGelistirmeVeritabani("test_maliyet_girdi");
  const f = await fiksturKur("MGT");
  try {
    await bolum1(f);
    await bolum2(f);
    await bolum3(f);
    await bolum4(f);
    await bolum5(f);
    await bolum6(f);
    await bolum7(f);
    await bolum8(f);
  } finally {
    await fiksturSil(f);
  }
  check("§9 Fikstür temizlendi", (await prisma.item.count({ where: { code: { startsWith: f.tag } }, })) === 0 && ItemType.FABRIC === "FABRIC");
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
