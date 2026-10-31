// =============================================================================
// MALİYET BEKÇİ FİKSTÜRÜ (MAL-2) — plan §2.3 ürününü DB'de kurar, sonda siler
// =============================================================================
// `test_maliyet_girdi` ve `test_standart_maliyet_surum` ortak kullanır. Yalnız test DB'de
// koşar (çağıran `assertGelistirmeVeritabani` ile kapılar). Kurulumdan önce yürürlükteki
// parametre seti varsa kenara alınır (SUPERSEDED) ve sonda geri yürürlüğe döner.
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { hedefDbEngeli } from "./hedef-db-kapisi";

/** Yazma/silme yalnız bekçi DB'sinde — çağıranın kapısına ek, fail-closed. */
function kapi(ne: string): void {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`maliyet fikstürü ${ne} durduruldu — ${engel}`);
}

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

export interface MaliyetFikstur {
  tag: string;
  paramId: string;
  warpYarnId: string;
  weftAId: string;
  weftBId: string;
  warpSpecId: string;
  weftSpecId: string;
  fabricId: string;
  rateCode: string;
  parkedActiveId: string | null;
}

export async function fiksturKur(tagPrefix: string): Promise<MaliyetFikstur> {
  kapi("kurulumu");
  const tag = `${tagPrefix}${Date.now().toString(36).toUpperCase()}`;
  const active = await prisma.costParameterSet.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (active) await prisma.costParameterSet.update({ where: { id: active.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
  const maxNo = await prisma.costParameterSet.aggregate({ _max: { versionNo: true } });
  const param = await prisma.costParameterSet.create({
    data: {
      versionNo: (maxNo._max.versionNo ?? 0) + 1,
      status: "ACTIVE",
      activatedAt: new Date(),
      note: tag,
      loomHourRateTry: D(120),
      laborHourRateTry: D(250),
      loomsPerOperator: D(8),
      energyKwhPerLoomHour: D(6),
      energyPriceTryPerKwh: D("3.2"),
      overheadPct: D(12),
      defaultTakeUpPct: D(5),
      defaultWarpWastePct: D(2),
      defaultWeftWastePct: D(3),
      defaultFabricWastePct: D(2),
      defaultLoomRpm: 500,
      defaultEfficiencyPct: D(80),
      beamPrepCostTry: D(4500),
      defaultBeamLengthM: D(3000),
      weftSelvedgeAllowanceCm: D(4),
      defaultMarkupPct: D(18),
    },
  });
  const yarn = (suffix: string, den: number) =>
    prisma.item.create({ data: { code: `${tag}-${suffix}`, name: `${tag} ${suffix}`, itemType: ItemType.YARN, linearDensityDen: D(den) }, select: { id: true } });
  const warpYarn = await yarn("C75", 75);
  const weftA = await yarn("A150", 150);
  const weftB = await yarn("B300", 300);
  const warpSpec = await prisma.warpSpec.create({
    data: { code: `${tag}-W`, name: `${tag} çözgü`, yarnItemId: warpYarn.id, endsCount: 9600, takeUpPct: D(6), reedWidthCm: D(310) },
  });
  const weftSpec = await prisma.weftSpec.create({
    data: {
      code: `${tag}-F`,
      name: `${tag} atkı`,
      picksPerCm: D(28),
      yarns: { create: [{ yarnItemId: weftA.id, picksInRepeat: 1, sortOrder: 1 }, { yarnItemId: weftB.id, picksInRepeat: 1, sortOrder: 2 }] },
    },
  });
  const fabric = await prisma.item.create({
    data: { code: `${tag}-K`, name: `${tag} kumaş`, itemType: ItemType.FABRIC, warpSpecId: warpSpec.id, weftSpecId: weftSpec.id, rawWidthCm: D(300) },
    select: { id: true },
  });
  const price = (yarnItemId: string, usd: string) =>
    prisma.yarnCostPrice.create({ data: { yarnItemId, currency: "USD", pricePerKg: D(usd), note: tag } });
  await price(warpYarn.id, "2.60");
  await price(weftA.id, "2.40");
  await price(weftB.id, "3.10");
  const rateCode = `${tag}-APRE`.slice(0, 32);
  await prisma.finishingRate.create({ data: { code: rateCode, name: `${tag} apre`, basis: "RAW_M", currency: "TRY", pricePerM: D(18), typicalShrinkPct: D(4) } });
  return {
    tag, paramId: param.id, warpYarnId: warpYarn.id, weftAId: weftA.id, weftBId: weftB.id,
    warpSpecId: warpSpec.id, weftSpecId: weftSpec.id, fabricId: fabric.id, rateCode, parkedActiveId: active?.id ?? null,
  };
}

/** §2.3 maliyet yapısı (levent firesi %2,5, devir 600, randıman %85, kalite firesi %2, apre). */
export async function altinYapiYaz(f: MaliyetFikstur): Promise<void> {
  await prisma.costStructure.upsert({
    where: { itemId: f.fabricId },
    create: { itemId: f.fabricId, loomRpm: 600, efficiencyPct: D(85), warpWastePct: D("2.5"), weftWastePct: D(3), fabricWastePct: D(2), finishingRateCode: f.rateCode, lengthShrinkPct: D(4) },
    update: {},
  });
}

/** Standart maliyet sürümleri (donmuş fotoğraf; yalnız test DB'de silinir). */
async function oncekiTemizlik(f: MaliyetFikstur): Promise<void> {
  const versions = await prisma.standardCostVersion.findMany({ where: { itemId: f.fabricId }, select: { id: true } });
  await prisma.standardCostLine.deleteMany({ where: { versionId: { in: versions.map((v) => v.id) } } });
  await prisma.standardCostVersion.updateMany({ where: { itemId: f.fabricId }, data: { restoredFromId: null } });
  await prisma.standardCostVersion.deleteMany({ where: { itemId: f.fabricId } });
}

export async function fiksturSil(f: MaliyetFikstur): Promise<void> {
  kapi("temizliği");
  await oncekiTemizlik(f);
  await prisma.costStructureProcess.deleteMany({ where: { costStructure: { itemId: f.fabricId } } }); // SY-G1 pivotu (RESTRICT FK)
  await prisma.costStructure.deleteMany({ where: { itemId: f.fabricId } });
  await prisma.item.delete({ where: { id: f.fabricId } });
  await prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: f.weftSpecId } });
  await prisma.weftSpec.delete({ where: { id: f.weftSpecId } });
  await prisma.warpSpec.delete({ where: { id: f.warpSpecId } });
  await prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: { in: [f.warpYarnId, f.weftAId, f.weftBId] } } });
  await prisma.finishingRate.deleteMany({ where: { code: f.rateCode } });
  await prisma.item.deleteMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } } });
  await prisma.costParameterSet.delete({ where: { id: f.paramId } });
  if (f.parkedActiveId) await prisma.costParameterSet.update({ where: { id: f.parkedActiveId }, data: { status: "ACTIVE", supersededAt: null } });
}
