// =============================================================================
// ÇÖZGÜ KATMANI SARIM KİPİ — levent otomatik tüketimi (Seyitoğlu SY-B1; 2026-10-31 beamMode kararı)
// =============================================================================
// Kabul fikstürü (karar bloğu): zemin 5250 tel %8 + döner 2720 tel %14, 1000 m kumaş.
//   §1 SHARED_BEAM: zemin leventinin kalanı EN HIZLI tükenen (döner) grupla düşer → 1000 ÷ 0,86 =
//      1162,791 m (el hesabı); tek CONSUMED satırı; gerekçe "ortak levent"
//   §2 SEPARATE_BEAM: zemin leventi kendi take-up'ıyla → 100 ÷ 0,92 = 108,696 m (bugünkü davranış)
//   §3 CREEL: levent yok — zemin leventi bugünkü gibi 108,696 m; ek satır YOK
//   §4 katmansız ürün: bugünkü davranış (108,696 m)
//   §5 maliyet önizlemesi iplik fiyatı önerisi katman ipliğini kapsar
// NEGATİF SONDA: `fastestGroupTakeUpPct` kipe bakmadan zemin döndürünce (SEPARATE'e dönüş) §1 kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner.
// =============================================================================
import { MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { previewCost } from "../src/services/cost-calc.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-SYB1-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const kalan = async (id: string) => (await getWarpBeam(id)).data.remainingM;
const consumedOf = (rollId: string) => prisma.warpBeamEvent.findMany({ where: { rollId, kind: "CONSUMED" }, select: { beamId: true, lengthM: true, reason: true } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== ÇÖZGÜ KATMANI SARIM KİPİ — LEVENT TÜKETİMİ (SY-B1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stDv = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } });
  const ground = await prisma.warpSpec.create({ data: { code: `${TAG}-CZ`, name: `${TAG} zemin`, yarnItemId: yarn.id, endsCount: 5250, takeUpPct: 8 }, select: { id: true } });
  const lenoYarn = await prisma.item.create({ data: { code: `${TAG}-ID`, name: `${TAG} döner iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 50 }, select: { id: true } });
  const leno = await prisma.warpSpec.create({ data: { code: `${TAG}-CD`, name: `${TAG} döner`, yarnItemId: lenoYarn.id, endsCount: 2720, takeUpPct: 14 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} devereci` }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} tül`, itemType: "FABRIC", warpSpecId: ground.id }, select: { id: true } });
  const plain = await prisma.item.create({ data: { code: `${TAG}-KZ`, name: `${TAG} katmansız`, itemType: "FABRIC", warpSpecId: ground.id }, select: { id: true } });
  const inventory = new InventoryService();
  const beamIds: string[] = [];
  const rollIds: string[] = [];
  const top = async (itemId: string, m: number) => {
    const d = (await openDoff({ machineId: loom.id, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
    const r = await inventory.createInitialEntry({ itemId, initialQty: m }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d });
    const id = (r.data as { id: string }).id;
    rollIds.push(id);
    return id;
  };
  try {
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
    await setFlag(SETTING_KEYS.DEVERE_AUTO_CONSUME, true);
    const p = await createWarpBeam({ warpSpecId: ground.id, plannedLengthM: 3000, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 3000, kgSource: WarpKgSource.THEORETICAL });
    await mountBeam(p.data.id, { machineId: loom.id, position: 1 });
    const beam = p.data.id;

    console.log("\n── §1 SHARED_BEAM ──");
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
    const r1 = await top(fabric.id, 1000);
    const c1 = await consumedOf(r1);
    check("§1a ⭐ 1000 m kumaş → zemin leventinden 1000 ÷ 0,86 = 1162,791 m (döner grup en hızlı), kalan 1837,209",
      c1.length === 1 && c1[0]!.beamId === beam && c1[0]!.lengthM?.equals("1162.791") === true && (await kalan(beam)) === 1837.209, `${c1.map((c) => c.lengthM).join(",")} · kalan ${await kalan(beam)}`);
    check("§1b gerekçe ortak leventi adıyla söyler", /ortak levent/.test(c1[0]?.reason ?? ""), c1[0]?.reason ?? "");

    console.log("\n── §2 SEPARATE_BEAM (bugünkü) ──");
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
    const r2 = await top(fabric.id, 100);
    const c2 = await consumedOf(r2);
    check("§2 ⭐ zemin leventi kendi take-up'ıyla: 100 ÷ 0,92 = 108,696 m", c2.length === 1 && c2[0]!.lengthM?.equals("108.696") === true && !/ortak/.test(c2[0]!.reason ?? ""), String(c2[0]?.lengthM));

    console.log("\n── §3 CREEL ──");
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO", beamMode: "CREEL" }]);
    const r3 = await top(fabric.id, 100);
    const c3 = await consumedOf(r3);
    check("§3 ⭐ cağlık: levent satırı yalnız zemin (108,696 m), döner için levent düşümü YOK", c3.length === 1 && c3[0]!.beamId === beam && c3[0]!.lengthM?.equals("108.696") === true, String(c3[0]?.lengthM));

    console.log("\n── §4 Katmansız ürün ──");
    const r4 = await top(plain.id, 100);
    const c4 = await consumedOf(r4);
    check("§4 katmansız ürün bugünkü gibi 108,696 m", c4.length === 1 && c4[0]!.lengthM?.equals("108.696") === true, String(c4[0]?.lengthM));

    console.log("\n── §5 Maliyet önizlemesi iplik fiyatı önerisi ──");
    const pv = await previewCost({ itemId: fabric.id });
    const suggested = pv.oneriler.yarnPrices.map((y) => y.iplikId);
    check("§5 öneri listesi katman (döner) ipliğini de kapsar", suggested.includes(lenoYarn.id) && suggested.includes(yarn.id), suggested.join(","));
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, fabric.id] } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: loom.id } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.itemWarpLayer.deleteMany({ where: { itemId: fabric.id } });
    await prisma.item.deleteMany({ where: { id: { in: [fabric.id, plain.id] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [ground.id, leno.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, lenoYarn.id] } } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: loom.id } });
    await prisma.station.deleteMany({ where: { id: { in: [stDv.id, stLoom.id] } } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
