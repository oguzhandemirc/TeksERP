// =============================================================================
// MALİYET GİRDİLERİ BEKÇİSİ (MAL-1) — parametre seti sürümü, damgalı iplik fiyatı
// ve apre tarifesi, kumaş maliyet yapısı, partial unique seddi, modül kapısı.
// =============================================================================
// Servis düzeyi + DB (`assertGelistirmeVeritabani` kapısı). Ölçülenler:
//   §1 parametre seti: ilk taslakta zorunlu alan 400; tek taslak; etkinleştirme
//      eski ACTIVE'i SUPERSEDED yapar (her an tek ACTIVE); yalnız taslak silinir.
//   §2 iplik fiyatı: aynı değer no-op; değişimde eski satır SİLİNMEZ damgalanır;
//      liste varsayılan yalnız aktif; iplik olmayana 400.
//   §3 apre tarifesi: aynı damgalı sürüm deseni + aktif çözümleme.
//   §4 maliyet yapısı: yalnız FABRIC; bilinmeyen tarife kodu 400.
//   §5 DB seddi: ikinci aktif fiyat satırı partial unique'e çarpar.
//   §6 modül kapalıyken `requireMaliyetEnabled` 403 `MODULE_DISABLED`.
// Koşum: npx tsx scripts/test_maliyet_girdileri.ts
//
// NEGATİF SONDALAR — 2026-10-25 koşuldu (cp + shasum / CREATE INDEX ile geri alındı):
//   ① activateDraft'ta ACTIVE→SUPERSEDED updateMany atlanınca → §1e/f 409 ile düşer (çıkış 1)
//   ② changeYarnCostPrice damga yerine fiziksel delete yapınca          → §2 ❌
//   ③ listYarnCostPrices'tan ACTIVE süzgeci kalkınca                   → §2 ❌
//   ④ DROP INDEX yarn_cost_prices_active_uq                            → §5 ❌
//   ⑤ maliyetEnabled kapısı middleware'den sökülünce                   → §6 ❌
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as params from "../src/services/cost-parameter.service";
import * as yarnPrice from "../src/services/yarn-cost-price.service";
import * as rates from "../src/services/finishing-rate.service";
import * as structure from "../src/services/cost-structure.service";
import { requireMaliyetEnabled } from "../src/middlewares/module.middleware";
import { SETTING_KEYS } from "../src/services/system-setting.service";
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

const FULL_DRAFT = {
  loomHourRateTry: "120",
  laborHourRateTry: "180",
  loomsPerOperator: "6",
  energyKwhPerLoomHour: "4.5",
  energyPriceTryPerKwh: "3.2",
  overheadPct: "12",
  defaultWarpWastePct: "2",
  defaultWeftWastePct: "3",
  defaultFabricWastePct: "1.5",
  defaultEfficiencyPct: "85",
  beamPrepCostTry: "2500",
  defaultBeamLengthM: "3000",
  weftSelvedgeAllowanceCm: "4",
  defaultMarkupPct: "20",
};
const TAG = `MLT${Date.now().toString(36).toUpperCase()}`;

async function temizle(): Promise<void> {
  await prisma.costStructure.deleteMany({ where: { finishingRateCode: { startsWith: "MLT" } } });
  await prisma.finishingRate.deleteMany({ where: { code: { startsWith: "MLT" } } });
  await prisma.yarnCostPrice.deleteMany({ where: { note: { startsWith: "MLT" } } });
  await prisma.costParameterSet.deleteMany({});
}

async function bolum1(): Promise<void> {
  console.log("\n§1 Parametre seti sürümü");
  const e1 = await hata(() => params.createDraft({ loomHourRateTry: "100" }));
  check("§1a İlk taslakta zorunlu alan eksikse 400 COST_PARAMETER_REQUIRED", e1?.status === 400 && e1.code === "COST_PARAMETER_REQUIRED", JSON.stringify(e1));
  const d1 = await params.createDraft(FULL_DRAFT);
  check("§1b Taslak doğdu", d1.status === "DRAFT");
  const e2 = await hata(() => params.createDraft(FULL_DRAFT));
  check("§1c İkinci taslak reddedilir (tek taslak)", e2?.status === 409, JSON.stringify(e2));
  const a1 = await params.activateDraft(d1.id);
  check("§1d Etkinleştirilen taslak ACTIVE", a1.status === "ACTIVE");
  const d2 = await params.createDraft({ overheadPct: "15" });
  check("§1e Yeni taslak aktifin kopyası (değişmeyen alan taşındı)", d2.loomHourRateTry.equals(new Prisma.Decimal("120")) && d2.overheadPct.equals(new Prisma.Decimal("15")));
  await params.activateDraft(d2.id);
  const actives = await prisma.costParameterSet.count({ where: { status: "ACTIVE" } });
  const eski = await prisma.costParameterSet.findUnique({ where: { id: d1.id }, select: { status: true, supersededAt: true } });
  check("§1f ⭐ Etkinleştirme eski ACTIVE'i SUPERSEDED yapar; tek ACTIVE", actives === 1 && eski?.status === "SUPERSEDED" && eski.supersededAt !== null, `active=${actives} eski=${eski?.status}`);
  const e3 = await hata(() => params.deleteDraft(d1.id));
  check("§1g Taslak olmayan set silinemez", e3 !== null && (e3.status ?? 0) >= 400, JSON.stringify(e3));
  const d3 = await params.createDraft({});
  await params.deleteDraft(d3.id);
  check("§1h Taslak silinir (deftere hiç yazmamış taslak)", (await prisma.costParameterSet.count({ where: { id: d3.id } })) === 0);
}

async function bolum2(yarnId: string, fabricId: string): Promise<void> {
  console.log("\n§2 İplik maliyet fiyatı (damgalı sürüm)");
  const note = `${TAG} iplik`;
  const r1 = await yarnPrice.changeYarnCostPrice({ yarnItemId: yarnId, currency: "TRY", pricePerKg: "100", note });
  const r2 = await yarnPrice.changeYarnCostPrice({ yarnItemId: yarnId, currency: "TRY", pricePerKg: "100", note });
  check("§2a Aynı değer no-op", r1.wrote && !r2.wrote && r2.row.id === r1.row.id);
  const r3 = await yarnPrice.changeYarnCostPrice({ yarnItemId: yarnId, currency: "TRY", pricePerKg: "110", note });
  const eski = await prisma.yarnCostPrice.findUnique({ where: { id: r1.row.id }, select: { revokedAt: true } });
  check("§2b ⭐ Değişimde eski satır SİLİNMEZ, damgalanır", r3.wrote && r3.previousId === r1.row.id && eski !== null && eski.revokedAt !== null, `eski=${JSON.stringify(eski)}`);
  const aktif = await yarnPrice.listYarnCostPrices({ yarnItemId: yarnId });
  const hepsi = await yarnPrice.listYarnCostPrices({ yarnItemId: yarnId, includeRevoked: true });
  check("§2c ⭐ Liste varsayılan YALNIZ aktif; geçmiş açıkça istenir", aktif.length === 1 && aktif[0].id === r3.row.id && hepsi.length >= 2, `aktif=${aktif.length} hepsi=${hepsi.length}`);
  const e = await hata(() => yarnPrice.changeYarnCostPrice({ yarnItemId: fabricId, currency: "TRY", pricePerKg: "5" }));
  check("§2d İplik olmayan kaleme fiyat 400 COST_YARN_NOT_YARN", e?.status === 400 && e.code === "COST_YARN_NOT_YARN", JSON.stringify(e));
  await yarnPrice.revokeYarnCostPrice(r3.row.id);
  check("§2e Kaldırma sonrası aktif fiyat yok, satır duruyor", (await yarnPrice.listYarnCostPrices({ yarnItemId: yarnId })).length === 0 && (await prisma.yarnCostPrice.count({ where: { id: r3.row.id } })) === 1);
}

async function bolum3(): Promise<string> {
  console.log("\n§3 Apre tarifesi (damgalı sürüm)");
  const code = `${TAG}A`;
  const base = { code, name: "Test apre", basis: "RAW_M" as const, currency: "TRY" as const, pricePerM: "7.5" };
  const r1 = await rates.changeFinishingRate(base);
  const r2 = await rates.changeFinishingRate(base);
  check("§3a Aynı değer no-op", r1.wrote && !r2.wrote);
  const r3 = await rates.changeFinishingRate({ ...base, pricePerM: "8" });
  const aktif = await rates.resolveActiveFinishingRate(code);
  const toplam = await prisma.finishingRate.count({ where: { code } });
  check("§3b ⭐ Yeni sürüm aktif, eski satır duruyor", aktif?.id === r3.row.id && toplam === 2, `aktif=${aktif?.id === r3.row.id} toplam=${toplam}`);
  return code;
}

async function bolum4(yarnId: string, fabricId: string, rateCode: string): Promise<void> {
  console.log("\n§4 Kumaş maliyet yapısı");
  const e1 = await hata(() => structure.putCostStructure(yarnId, { loomRpm: "500" }));
  check("§4a Kumaş olmayan karta 400 COST_STRUCTURE_FABRIC_ONLY", e1?.status === 400 && e1.code === "COST_STRUCTURE_FABRIC_ONLY", JSON.stringify(e1));
  const e2 = await hata(() => structure.putCostStructure(fabricId, { finishingRateCode: `${TAG}YOK` }));
  check("§4b Aktif tarifeye çözülmeyen kod 400 COST_FINISHING_RATE_UNKNOWN", e2?.status === 400 && e2.code === "COST_FINISHING_RATE_UNKNOWN", JSON.stringify(e2));
  const row = await structure.putCostStructure(fabricId, { loomRpm: "550", finishingRateCode: rateCode });
  const okunan = await structure.getCostStructure(fabricId);
  check("§4c Yapı yazılır ve okunur", row.finishingRateCode === rateCode && okunan.structure?.id === row.id);
}

async function bolum5(yarnId: string): Promise<void> {
  console.log("\n§5 DB seddi — tek aktif fiyat");
  const note = `${TAG} sed`;
  await yarnPrice.changeYarnCostPrice({ yarnItemId: yarnId, currency: "TRY", pricePerKg: "50", note });
  let carpti = false;
  try {
    await prisma.yarnCostPrice.create({ data: { yarnItemId: yarnId, currency: "TRY", pricePerKg: new Prisma.Decimal("51"), source: "MANUAL", note } });
  } catch (e) {
    carpti = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
  }
  check("§5 ⭐ İkinci aktif satır partial unique'e çarpar (yarn_cost_prices_active_uq)", carpti);
}

async function bolum6(): Promise<void> {
  console.log("\n§6 Modül kapısı");
  const key = SETTING_KEYS.MALIYET_ENABLED;
  const onceki = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const kos = async (): Promise<unknown> =>
    new Promise((resolve) => {
      void requireMaliyetEnabled({} as never, {} as never, (err?: unknown) => resolve(err ?? null));
    });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: false }, update: { value: false } });
    const err = (await kos()) as { statusCode?: number; details?: { code?: string } } | null;
    check("§6 ⭐ Modül kapalıyken 403 MODULE_DISABLED", err?.statusCode === 403 && err.details?.code === "MODULE_DISABLED", JSON.stringify(err?.details));
  } finally {
    if (onceki) await prisma.systemSetting.update({ where: { key }, data: { value: onceki.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.delete({ where: { key } });
  }
}

async function main(): Promise<void> {
  console.log("=== MALİYET GİRDİLERİ BEKÇİSİ (MAL-1) ===");
  // Bekçi parametre setlerini toplu temizler: hedef geliştirme ya da test DB değilse süreç düşer.
  assertGelistirmeVeritabani("test_maliyet_girdileri");
  // Fikstürde iplik kalemi yok: bekçi kendi ipliğini doğurur, sonda siler (yalnız test DB).
  const yarn = await prisma.item.upsert({
    where: { code: "MLT-TEST-IPLIK" },
    create: { code: "MLT-TEST-IPLIK", name: "Maliyet bekçisi ipliği", itemType: ItemType.YARN },
    update: { isActive: true },
    select: { id: true },
  });
  const fabric = await prisma.item.findFirst({ where: { itemType: ItemType.FABRIC, isActive: true }, select: { id: true } });
  check("§0 Fikstür: aktif iplik ve kumaş kalemi var", !!yarn && !!fabric);
  if (!yarn || !fabric) process.exit(1);
  await prisma.costStructure.deleteMany({ where: { itemId: fabric.id } });
  await temizle();
  try {
    await bolum1();
    await bolum2(yarn.id, fabric.id);
    const code = await bolum3();
    await bolum4(yarn.id, fabric.id, code);
    await bolum5(yarn.id);
    await bolum6();
  } finally {
    await prisma.costStructure.deleteMany({ where: { itemId: fabric.id } });
    await temizle();
    await prisma.yarnCostPrice.deleteMany({ where: { yarnItemId: yarn.id } });
    await prisma.item.delete({ where: { id: yarn.id } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
