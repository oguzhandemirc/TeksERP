// =============================================================================
// İPLİK İHTİYACI — EK ÇÖZGÜ KATMANI HAZIR LEVENT DÜŞÜMÜ (Seyitoğlu SY-N2; SY-B2 #375 kalanı)
// =============================================================================
// Fikstür: ALTIN kumaş (zemin %6) + döner katman (%14), 1000 m brüt talep; döner kartında READY
// levent 500 m, zemin kartında READY levent 1000 m.
//   §1 SEPARATE_BEAM: döner katman KENDİ leventinden düşer — 500 × (1 − 0,14) = 430 m kumaş →
//      döner kg = kg/m × 570 (el hesabı); levent beyanında döner kartı 430 m düşüldü
//   §2 zemin düşümü katmandan etkilenmez (1000 × 0,94 = 940 m; ayrı kipte ortak grup yok)
//   §3 leventDus=false: döner kg = kg/m × 1000 (bugünkü)
//   §4 SHARED_BEAM: döner zeminin düşümünü izler, kendi kartının leventi düşülmez (bugünkü)
//   §5 CREEL: döner tam talep, levent beyanında döner kartı YOK (bugünkü)
//   §6 tek katmanlı (katmansız) ürün: döner leventi rapora girmez; zemin bugünkü gibi
// NEGATİF SONDA: rapor SEPARATE katmanda `own ?? r.d.meters` yerine `r.d.meters` alırsa §1 kırmızı;
// `fabricMetersFromWarpM` katmanı yok sayarsa (zemin take-up'ı) §1 kırmızı.
// Koşum: npx tsx scripts/test_iplik_ihtiyaci_katman.ts (kendi _test DB'n)
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { yarnNeedReport, type YarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const kg3 = (v: Prisma.Decimal) => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
const FLAGS: Record<string, boolean> = { [SETTING_KEYS.MALIYET_ENABLED]: true, [SETTING_KEYS.DEVERE_ENABLED]: true };

interface Fx { f: MaliyetFikstur; customerId: string; lenoYarnId: string; lenoSpecId: string }

async function beam(tag: string, warpSpecId: string, lengthM: number): Promise<void> {
  const b = await prisma.warpBeam.create({
    data: { beamNo: tag, warpSpecId, status: WarpBeamStatus.READY, plannedLengthM: D(lengthM), originKind: WarpBeamOrigin.IN_HOUSE },
    select: { id: true },
  });
  await prisma.warpBeamEvent.create({
    data: { beamId: b.id, kind: "WOUND", fromStatus: WarpBeamStatus.PLANNED, toStatus: WarpBeamStatus.READY, lengthM: D(lengthM), endsCount: 2720, denier: D(50), theoreticalKg: D(10), kgSource: WarpKgSource.THEORETICAL },
  });
}

async function kur(f: MaliyetFikstur): Promise<Fx> {
  await altinYapiYaz(f);
  const leno = await prisma.item.create({ data: { code: `${f.tag}-ID`, name: `${f.tag} döner iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 50 }, select: { id: true } });
  const lenoSpec = await prisma.warpSpec.create({ data: { code: `${f.tag}-CD`, name: `${f.tag} döner`, yarnItemId: leno.id, endsCount: 2720, takeUpPct: 14 }, select: { id: true } });
  const cust = await prisma.customer.create({ data: { code: `${f.tag}-M`, name: `${f.tag} müşteri` }, select: { id: true } });
  await prisma.order.create({ data: { orderNumber: `${f.tag}-S`, customerId: cust.id, lines: { create: [{ itemId: f.fabricId, quantity: D(1000) }] } } });
  await beam(`${f.tag}-LD`, lenoSpec.id, 500);
  await beam(`${f.tag}-LZ`, f.warpSpecId, 1000);
  return { f, customerId: cust.id, lenoYarnId: leno.id, lenoSpecId: lenoSpec.id };
}

async function temizle(x: Fx | null, f: MaliyetFikstur): Promise<void> {
  const tag = { startsWith: `${f.tag}-` };
  await replaceItemWarpLayers(f.fabricId, []).catch(() => undefined);
  await prisma.warpBeamEvent.deleteMany({ where: { beam: { beamNo: tag } } });
  await prisma.warpBeam.deleteMany({ where: { beamNo: tag } });
  await prisma.orderLine.deleteMany({ where: { order: { orderNumber: tag } } });
  await prisma.order.deleteMany({ where: { orderNumber: tag } });
  await prisma.customer.deleteMany({ where: { code: tag } });
  if (x) {
    await prisma.warpSpec.deleteMany({ where: { id: x.lenoSpecId } });
    await prisma.item.deleteMany({ where: { id: x.lenoYarnId } });
  }
  await fiksturSil(f);
}

const row = (r: YarnNeedReport, id: string) => r.satirlar.find((s) => s.iplikId === id);
const lv = (r: YarnNeedReport, id: string) => r.meta.leventler.find((l) => l.cozguKartiId === id);

async function bolumler(x: Fx): Promise<void> {
  const { f } = x;
  const rep = (leventDus: boolean, urunId = f.fabricId) => yarnNeedReport({ musteriId: x.customerId, urunId, netle: false, leventDus });

  console.log("\n── §1–§3 SEPARATE_BEAM ──");
  await replaceItemWarpLayers(f.fabricId, [{ warpSpecId: x.lenoSpecId, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
  const u = yarnUsagePerM(await assembleCostInputTx(prisma as unknown as Prisma.TransactionClient, { itemId: f.fabricId }));
  const lenoKgPerM = u.warpLayers.find((l) => l.warpSpecId === x.lenoSpecId)?.kgPerM;
  check("§0 fikstür: döner katman kg/m hesaplandı (yapı tam)", !!lenoKgPerM && u.missing.length === 0, u.missing.join(","));
  if (!lenoKgPerM) return;
  const sep = await rep(true);
  check("§1a ⭐ döner kendi leventinden: kg = kg/m × (1000 − 500 × 0,86 = 570)", row(sep, x.lenoYarnId)?.cozguKg === kg3(lenoKgPerM.mul(570)), `${row(sep, x.lenoYarnId)?.cozguKg} / ${kg3(lenoKgPerM.mul(570))}`);
  check("§1b levent beyanı: döner kartı 1 levent, 500 m kalan, 430 m kumaş düşüldü", JSON.stringify(lv(sep, x.lenoSpecId)) === JSON.stringify({ cozguKartiId: x.lenoSpecId, leventSayisi: 1, kalanCozguM: "500.0", dusulenKumasM: "430.0" }), JSON.stringify(lv(sep, x.lenoSpecId)));
  check("§2 zemin düşümü katmandan bağımsız: 1000 × 0,94 = 940 m; zemin kg = kg/m × 60", lv(sep, f.warpSpecId)?.dusulenKumasM === "940.0" && row(sep, f.warpYarnId)?.cozguKg === kg3(u.warp!.kgPerM.mul(60)), `${lv(sep, f.warpSpecId)?.dusulenKumasM} / ${row(sep, f.warpYarnId)?.cozguKg}`);
  const off = await rep(false);
  check("§3 leventDus=false: döner kg = kg/m × 1000 (bugünkü), levent beyanı boş", row(off, x.lenoYarnId)?.cozguKg === kg3(lenoKgPerM.mul(1000)) && off.meta.leventler.length === 0, row(off, x.lenoYarnId)?.cozguKg);

  console.log("\n── §4 SHARED_BEAM ──");
  await replaceItemWarpLayers(f.fabricId, [{ warpSpecId: x.lenoSpecId, role: "LENO", beamMode: "SHARED_BEAM" }]);
  const sh = await rep(true);
  // Ortak levent en hızlı grup (%14) ile: 1000 × 0,86 = 860 m kumaş → kalan 140 m talep iki gruba.
  check("§4 ⭐ döner zemin düşümünü izler (kg/m × 140); kendi kartının leventi düşülmez/beyan edilmez",
    row(sh, x.lenoYarnId)?.cozguKg === kg3(lenoKgPerM.mul(140)) && lv(sh, x.lenoSpecId) === undefined && lv(sh, f.warpSpecId)?.dusulenKumasM === "860.0",
    `${row(sh, x.lenoYarnId)?.cozguKg} / ${lv(sh, f.warpSpecId)?.dusulenKumasM}`);

  console.log("\n── §5 CREEL ──");
  await replaceItemWarpLayers(f.fabricId, [{ warpSpecId: x.lenoSpecId, role: "LENO", beamMode: "CREEL" }]);
  const cr = await rep(true);
  check("§5 ⭐ cağlık: döner tam talep (kg/m × 1000), döner kartı beyanda yok, zemin 940", row(cr, x.lenoYarnId)?.cozguKg === kg3(lenoKgPerM.mul(1000)) && lv(cr, x.lenoSpecId) === undefined && lv(cr, f.warpSpecId)?.dusulenKumasM === "940.0", row(cr, x.lenoYarnId)?.cozguKg);

  console.log("\n── §6 katmansız ──");
  await replaceItemWarpLayers(f.fabricId, []);
  const pl = await rep(true);
  check("§6 ⭐ katmansız: döner ipliği/leventi rapora girmez; zemin 940 m düşüm (bugünkü)", !row(pl, x.lenoYarnId) && pl.meta.leventler.length === 1 && lv(pl, f.warpSpecId)?.dusulenKumasM === "940.0", JSON.stringify(pl.meta.leventler));
}

async function withFlags<T>(fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(FLAGS);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: FLAGS[k] }, update: { value: FLAGS[k] } });
    return await fn();
  } finally {
    for (const k of keys) {
      const b = before.find((y) => y.key === k);
      if (b) await prisma.systemSetting.update({ where: { key: k }, data: { value: b.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.delete({ where: { key: k } });
    }
  }
}

async function main(): Promise<void> {
  console.log("=== İPLİK İHTİYACI — EK KATMAN HAZIR LEVENT DÜŞÜMÜ (SY-N2) ===");
  assertGelistirmeVeritabani("test_iplik_ihtiyaci_katman");
  const f = await fiksturKur("SYN2");
  let x: Fx | null = null;
  try {
    x = await kur(f);
    const fx = x;
    await withFlags(() => bolumler(fx));
  } finally {
    await temizle(x, f);
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
