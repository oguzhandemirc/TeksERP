// =============================================================================
// LEVENT RAPORU KATMAN KIRILIMI (Seyitoğlu SY-B2; tasarım §3.5 md. 3)
// =============================================================================
// Levent Sonucu satırı, bağlı işin ürününde ek çözgü katmanı VARKEN `katman` etiketi taşır:
//   §1 iki katmanlı iş: zemin leventi "Zemin çözgü", döner leventi "Döner çözgü" (SEPARATE_BEAM)
//   §2 SHARED_BEAM: zemin leventi "… döner tel grubu (aynı levent)"
//   §3 tek katmanlı iş ve işsiz levent: satırda `katman` anahtarı YOK (bayt-aynı)
//   §4 saf helper: kart yapıda yoksa null; CREEL katmanı kip etiketiyle
// NEGATİF SONDA: rapor servisinde `...(katman ? { katman } : {})` satırı düşürülünce §1/§2 kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner.
// =============================================================================
import { Prisma, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { beamResultReport } from "../src/services/reports/levent-sonucu.report.service";
import { beamLayerTag } from "../src/services/helpers/warp-layer-beam.helper";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-SYB2-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== LEVENT RAPORU KATMAN KIRILIMI (SY-B2) ===");

  console.log("\n── §4 Saf helper ──");
  const L = [{ warpSpecId: "L", role: "LENO", beamMode: "CREEL" }];
  check("§4a kart yapıda yok → null", beamLayerTag("X", "G", L) === null);
  check("§4b katmansız → null (zemin kartı olsa bile)", beamLayerTag("G", "G", []) === null);
  check("§4c CREEL katmanı kip etiketiyle", beamLayerTag("L", "G", L)?.etiket === "Döner çözgü · Cağlık (levent yok)", beamLayerTag("L", "G", L)?.etiket);

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 4 }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } });
  const ground = await prisma.warpSpec.create({ data: { code: `${TAG}-CZ`, name: `${TAG} zemin`, yarnItemId: yarn.id, endsCount: 5250, takeUpPct: 8 }, select: { id: true } });
  const leno = await prisma.warpSpec.create({ data: { code: `${TAG}-CD`, name: `${TAG} döner`, yarnItemId: yarn.id, endsCount: 2720, takeUpPct: 14 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} devereci` }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} tül`, itemType: "FABRIC", warpSpecId: ground.id }, select: { id: true } });
  const plain = await prisma.item.create({ data: { code: `${TAG}-KZ`, name: `${TAG} katmansız`, itemType: "FABRIC", warpSpecId: ground.id }, select: { id: true } });
  const wo = (itemId: string, n: number) => prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-W${n}`, itemId, executionKind: "IN_HOUSE" }, select: { id: true } });
  const wo1 = await wo(fabric.id, 1);
  const wo2 = await wo(plain.id, 2);
  const beamIds: string[] = [];
  const beam = async (warpSpecId: string, position: number, weavingOrderId: string | null) => {
    const p = await createWarpBeam({ warpSpecId, plannedLengthM: 1000, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 1000, kgSource: WarpKgSource.THEORETICAL });
    await mountBeam(p.data.id, { machineId: loom.id, position });
    if (weavingOrderId) await prisma.warpBeam.update({ where: { id: p.data.id }, data: { weavingOrderId } });
    return p.data.id;
  };
  try {
    for (const k of FLAGS) await setFlag(k, k !== SETTING_KEYS.IPLIK_ENABLED);
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
    const bGround = await beam(ground.id, 1, wo1.id);
    const bLeno = await beam(leno.id, 2, wo1.id);
    const bPlain = await beam(ground.id, 3, wo2.id);
    const bFree = await beam(ground.id, 4, null);
    const today = factoryYmd();
    const run = async () => (await beamResultReport({ from: today, to: today, machineId: loom.id })).data.acikLeventler;
    const rows = await run();
    const row = (id: string) => rows.find((r) => r.beamId === id);

    console.log("\n── §1 İki katmanlı iş (SEPARATE_BEAM) ──");
    check("§1a ⭐ zemin leventi: rol GROUND, etiket 'Zemin çözgü'", row(bGround)?.katman?.rol === "GROUND" && row(bGround)?.katman?.etiket === "Zemin çözgü", JSON.stringify(row(bGround)?.katman));
    check("§1b ⭐ döner leventi: rol LENO, kip SEPARATE_BEAM, etiket 'Döner çözgü'", row(bLeno)?.katman?.rol === "LENO" && row(bLeno)?.katman?.beamMode === "SEPARATE_BEAM" && row(bLeno)?.katman?.etiket === "Döner çözgü", JSON.stringify(row(bLeno)?.katman));

    console.log("\n── §3 Tek katmanlı / işsiz levent ──");
    check("§3a ⭐ tek katmanlı işin leventinde `katman` anahtarı YOK", !!row(bPlain) && !("katman" in row(bPlain)!), JSON.stringify(row(bPlain)?.katman));
    check("§3b işsiz leventte `katman` anahtarı YOK", !!row(bFree) && !("katman" in row(bFree)!));
    const keys = Object.keys(row(bPlain) ?? {}).join(",");
    check("§3c tek katmanlı satırın anahtar kümesi bugünkü sözleşme", keys === "beamId,beamNo,physicalBeamNo,warpSpec,sarilanM,sarilanKg,kgKaynak,beklenenKumasM,gercekKumasM,gercekKaynak,kalanM,fireM,firePct,status,kapanisAt,tezgahlar,kullanimPct", keys);

    console.log("\n── §2 SHARED_BEAM ──");
    await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
    const rows2 = await run();
    const g2 = rows2.find((r) => r.beamId === bGround)?.katman;
    check("§2a ⭐ zemin leventi ortak grubu söyler", g2?.rol === "GROUND" && g2.etiket === "Zemin çözgü + döner tel grubu (aynı levent)", JSON.stringify(g2));
    const l2 = rows2.find((r) => r.beamId === bLeno)?.katman;
    check("§2b döner kartlı levent kip etiketiyle", l2?.etiket === "Döner çözgü · Zeminle aynı levent", JSON.stringify(l2));
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: [wo1.id, wo2.id] } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...beamIds, fabric.id] } } });
    await prisma.itemWarpLayer.deleteMany({ where: { itemId: fabric.id } });
    await prisma.item.deleteMany({ where: { id: { in: [fabric.id, plain.id] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [ground.id, leno.id] } } });
    await prisma.item.deleteMany({ where: { id: yarn.id } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: loom.id } });
    await prisma.station.deleteMany({ where: { id: stLoom.id } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  if (fail > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
