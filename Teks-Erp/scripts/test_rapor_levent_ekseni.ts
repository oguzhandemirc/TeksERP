// =============================================================================
// RAPORLARDA LEVENT / LOT EKSENİ (raporlar fazı R5b-b) — süzgeçli ↔ süzgeçsiz SAYI FARKI, gerçek DB
// =============================================================================
// NEDEN: "bu levent/lot hangi vardiyada, hangi topta" sorusu yeni doğal eksendir (RAPORLAR-FAZ-PLANI §0b).
// Bağ DEFTERDEN okunur: top ← `WarpBeamEvent.CONSUMED.rollId` (Faz 4), levent ← lot `YarnMovement.WARP_ISSUE.lotId`
// (Faz 2), tezgah ← `beamsMountedDuring` penceresi ∩ vardiya penceresi. Süzgeç yoksa sorgu BAYT BAYT eski
// (`meta.suzgec` anahtarı bile yok); levent bilinmiyorsa 404; lot leventsizse rapor BOŞ (hata değil).
// §0 statik · §1 randıman · §2 duruş pareto · §3 vardiya karnesi (+`shiftDefinitionId` DTO) · §4 kalite karnesi ·
// §5 fire karnesi · §6 Zod (bilinmeyen anahtar / bozuk uuid 400).
// NEGATİF SONDALAR (2026-09-15, ölçüldü): `shiftHasBeam` sabit true → §1b/§1c/§1d/§2b/§2c/§3c/§3d ❌ (7) ·
//   `rollsOfBeamsSql` `Prisma.empty` döner → §4b/§4c/§4d/§5b ❌ (4) · `applyBeamFilter` `suzgec`i basmaz → §1b/§1c/§1d/§2a/§3b/§3d ❌ (6).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner. Sentetik gün 1993-06-06 (ufuktan ÖNCE,
//   canlı veriyle çakışmaz); kalite penceresi 2098-06 (kalite/fire bekçileri 2099-03 kullanır).
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, Prisma, RollEntrySource, RollStatus, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { durusParetoReport, efficiencyReport, shiftScorecardReport } from "../src/services/reports/dokuma.report.service";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";
import { qualityQuerySchema } from "../src/routes/reports/quality.routes";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-RLE-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const YOK_UUID = "00000000-0000-4000-8000-000000000000";
const RANGE = { from: new Date("2098-06-01T00:00:00.000Z"), to: new Date("2098-06-30T23:59:59.999Z") };
const IN_WINDOW = new Date("2098-06-15T10:00:00.000Z");
async function hata(fn: () => Promise<unknown>): Promise<{ status: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code } : { status: -1 };
  }
}

function statik(): void {
  console.log("── §0 Statik ──");
  const helper = readFileSync(path.join(ROOT, "src/services/helpers/warp-beam-roll-filter.helper.ts"), "utf8");
  check("§0a top bağı yalnız AKTİF CONSUMED satırından (ters bağı olan satır sayılmaz)", /e\.kind = 'CONSUMED' AND e\."rollId" IS NOT NULL/.test(helper) && /NOT EXISTS \(SELECT 1 FROM warp_beam_events x WHERE x\."reversesEventId" = e\.id\)/.test(helper));
  check("§0b tezgah bağı DEFTERDEN (`beamsMountedDuring`), durum kolonundan değil", /beamsMountedDuring\(client, machineId, window\.from, window\.to\)/.test(helper) && !/currentMachineId|mountedBeamsOnMachineTx/.test(helper));
  const rotalar = readFileSync(path.join(ROOT, "src/routes/reports/dokuma.report.routes.ts"), "utf8") + readFileSync(path.join(ROOT, "src/routes/reports/quality.routes.ts"), "utf8");
  check("§0c rotalar prisma import ETMEZ (süzgeç çözümü serviste)", !/from "\.\.\/\.\.\/lib\/prisma"/.test(rotalar));
  const dokuma = readFileSync(path.join(ROOT, "src/services/reports/dokuma.report.service.ts"), "utf8");
  check("§0d üç dokuma raporu da `applyBeamFilter`dan geçer ve `suzgec`i meta'ya basar", (dokuma.match(/applyBeamFilter\(collected\.rows, filter\)/g) ?? []).length === 3 && (dokuma.match(/buildMeta\([^)]*suzgec\)/g) ?? []).length === 3);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== RAPORLARDA LEVENT / LOT EKSENİ BEKÇİSİ (R5b-b) ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const mk = (n: number) => prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T${n}`, code: `${TAG}-T${n}`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true } });
  const t1 = (await mk(1)).id;
  const t2 = (await mk(2)).id;
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000, takeUpPct: 0 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const LOT = `${TAG}-LOT`;
  const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: LOT }, select: { id: true } });
  const def = await prisma.shiftDefinition.create({ data: { code: `L${process.pid}`.slice(0, 8), name: `${TAG} vardiya`, startMinute: 480, durationMinutes: 480 }, select: { id: true } });
  const gun = new Date(Date.UTC(1993, 5, 6));
  const S0 = new Date(Date.UTC(1993, 5, 6, 5));
  const S1 = new Date(Date.UTC(1993, 5, 6, 13));
  const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: gun, startsAt: S0, endsAt: S1 }, select: { id: true } });
  const ymd = factoryYmd(new Date(gun.getTime() + 12 * 3600_000));
  const inventory = new InventoryService();
  const beamIds: string[] = [];
  const rollIds: string[] = [];
  const stopIds: string[] = [];
  const sar = async (m: number) => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const top = async (machineId: string, m: number, status: RollStatus) => {
    const d = (await openDoff({ machineId, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
    const r = await inventory.createInitialEntry({ itemId: fabric.id, initialQty: m }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: d });
    const id = (r.data as { id: string }).id;
    rollIds.push(id);
    // Fikstür: statü geçişi trigger'a `finalizedAt=now()` yazdırır; damga statüye DOKUNMADAN ham UPDATE ile pencereye taşınır (test_quality_scorecard emsali).
    await prisma.roll.update({ where: { id }, data: { status } });
    await prisma.$executeRaw`UPDATE "rolls" SET "finalizedAt" = ${IN_WINDOW} WHERE "id" = ${id}::uuid`;
    return id;
  };
  const stop = async (machineId: string, startMin: number, durSec: number) => {
    const s = await prisma.machineStopEvent.create({ data: { machineId, stopKey: randomUUID(), factoryDay: factoryDayKeyUtcMidnight(S0), shiftInstanceId: sh.id, source: MachineDataSource.OPERATOR, startedAt: new Date(S0.getTime() + startMin * 60_000), endedAt: new Date(S0.getTime() + startMin * 60_000 + durSec * 1000), durationSec: durSec, beamSlot: 1 }, select: { id: true } });
    stopIds.push(s.id);
  };
  const benim = (rows: Array<{ machineId: string }>) => rows.filter((r) => r.machineId === t1 || r.machineId === t2);
  try {
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
    await setFlag(SETTING_KEYS.DEVERE_AUTO_CONSUME, true);

    // b1 → T1, vardiyadan ÖNCE bağlandı (pencere kesişir); b2 → T2, vardiyadan SONRA bağlandı (kesişmez).
    const b1 = await sar(1000);
    const b2 = await sar(1000);
    await mountBeam(b1, { machineId: t1, position: 1, setupStartedAt: new Date(S0.getTime() - 3600_000) });
    await mountBeam(b2, { machineId: t2, position: 1, setupStartedAt: new Date(S1.getTime() + 3600_000) });
    await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.WARP_ISSUE, qtyKg: 10, lotId: lot.id, warpBeamId: b1 } });
    await stop(t1, 60, 300);
    await stop(t2, 60, 200);
    // Toplar (doff ANINDA ikisi de bağlı): R1 ← b1 (100 m, depo) · R2 ← b2 (60 m, depo) · R3 ← b2 (40 m, FİRE)
    await top(t1, 100, RollStatus.WAREHOUSE);
    await top(t2, 60, RollStatus.WAREHOUSE);
    await top(t2, 40, RollStatus.SCRAP);
    const consumed = await prisma.warpBeamEvent.count({ where: { kind: "CONSUMED", rollId: { in: rollIds } } });
    check("fikstür: üç top üç CONSUMED(rollId) satırı", consumed === 3, String(consumed));

    console.log("\n── §1 Randıman: vardiya penceresi ∩ bağ penceresi ──");
    const r0 = await efficiencyReport({ from: ymd, to: ymd });
    check("§1a süzgeçsiz: iki tezgah satırı, `meta.suzgec` anahtarı YOK (bayt bayt eski)", benim(r0.satirlar).length === 2 && !("suzgec" in r0.meta), JSON.stringify(Object.keys(r0.meta)));
    const r1 = await efficiencyReport({ from: ymd, to: ymd, warpBeamId: b1 });
    check("§1b ⭐ warpBeamId=b1 → yalnız T1 satırı; meta.suzgec {levent 1, dusenSatir ≥ 1}", benim(r1.satirlar).length === 1 && benim(r1.satirlar)[0]!.machineId === t1 && r1.meta.suzgec?.warpBeamId === b1 && r1.meta.suzgec.levent === 1 && r1.meta.suzgec.dusenSatir >= 1, JSON.stringify(r1.meta.suzgec));
    const r2 = await efficiencyReport({ from: ymd, to: ymd, warpBeamId: b2 });
    check("§1c ⭐ b2 vardiyadan SONRA bağlandı → T2 satırı DÜŞER (şu an bağlı olması yetmez, pencere defterden)", benim(r2.satirlar).length === 0 && r2.meta.suzgec?.levent === 1);
    const r3 = await efficiencyReport({ from: ymd, to: ymd, lotNo: ` ${LOT} ` });
    check("§1d ⭐ lotNo (TRIM) → lotun leventi b1 → yalnız T1", benim(r3.satirlar).length === 1 && benim(r3.satirlar)[0]!.machineId === t1 && r3.meta.suzgec?.lotNo === LOT);
    const r4 = await efficiencyReport({ from: ymd, to: ymd, lotNo: `${TAG}-YOK` });
    check("§1e bilinmeyen lot → BOŞ rapor (hata değil), suzgec.levent 0", r4.satirlar.length === 0 && r4.meta.suzgec?.levent === 0 && r4.toplam.rowCount === 0);
    const r5 = await efficiencyReport({ from: ymd, to: ymd, warpBeamId: b2, lotNo: LOT });
    check("§1f levent ∩ lot: b2 lotta yok → kesişim boş, levent 0", r5.satirlar.length === 0 && r5.meta.suzgec?.levent === 0);
    const e404 = await hata(() => efficiencyReport({ from: ymd, to: ymd, warpBeamId: YOK_UUID }));
    check("§1g bilinmeyen levent → 404 WARP_BEAM_NOT_FOUND", e404?.status === 404 && e404.code === "WARP_BEAM_NOT_FOUND", JSON.stringify(e404));

    console.log("\n── §2 Duruş Pareto ──");
    const p0 = await durusParetoReport({ from: ymd, to: ymd });
    const p1 = await durusParetoReport({ from: ymd, to: ymd, warpBeamId: b1 });
    check("§2a süzgeçsiz ≥ 500 sn (T1 300 + T2 200), suzgec YOK; süzgeçli meta.suzgec VAR", p0.toplam.stopSec >= 500 && !("suzgec" in p0.meta) && p1.meta.suzgec?.warpBeamId === b1, `${p0.toplam.stopSec}`);
    check("§2b ⭐ b1 → yalnız T1'in duruşu: 300 sn", p1.toplam.stopSec === 300 && p1.toplam.stopCount === 1, `${p1.toplam.stopSec}`);
    const p2 = await durusParetoReport({ from: ymd, to: ymd, machineId: t2, warpBeamId: b2 });
    check("§2c machineId=T2 + b2 → 0 (bağ penceresi vardiya dışında)", p2.toplam.stopSec === 0 && p2.toplam.stopCount === 0);

    console.log("\n── §3 Vardiya Karnesi + `shiftDefinitionId` DTO ──");
    const v0 = await shiftScorecardReport({ factoryDay: ymd });
    const s0 = v0.vardiyalar.find((v) => v.shiftInstanceId === sh.id);
    check("§3a ⭐ ShiftRow.shiftDefinitionId = vardiya tanımı (panel seçicisi için); iki tezgah; suzgec YOK", s0?.shiftDefinitionId === def.id && benim(s0?.makineler ?? []).length === 2 && !("suzgec" in v0.meta), s0?.shiftDefinitionId);
    const v1 = await shiftScorecardReport({ factoryDay: ymd, shiftDefinitionId: def.id, warpBeamId: b1 });
    const s1 = v1.vardiyalar.find((v) => v.shiftInstanceId === sh.id);
    check("§3b b1 + shiftDefinitionId → vardiya satırı kaldı, meta.suzgec basıldı", !!s1 && v1.meta.suzgec?.warpBeamId === b1 && v1.vardiyalar.every((v) => v.shiftDefinitionId === def.id));
    check("§3c ⭐ vardiyanın makineleri yalnız T1 (T2 düştü), toplamSatir 1", benim(s1?.makineler ?? []).length === 1 && s1?.makineler[0]?.machineId === t1 && s1.ozet.toplamSatir === 1, JSON.stringify(s1?.ozet));
    const v2 = await shiftScorecardReport({ factoryDay: ymd, warpBeamId: b2 });
    check("§3d b2 → vardiya satırı YOK (tüm makineleri düştü), meta.total 0", !v2.vardiyalar.some((v) => v.shiftInstanceId === sh.id) && v2.meta.suzgec?.dusenSatir !== undefined);

    console.log("\n── §4 Kalite Karnesi: top ← CONSUMED.rollId ──");
    const q0 = await getQualityScorecard(RANGE, null);
    const q1 = await getQualityScorecard(RANGE, null, { warpBeamId: b1 });
    const q2 = await getQualityScorecard(RANGE, null, { lotNo: LOT });
    const q3 = await getQualityScorecard(RANGE, null, { warpBeamId: b2 });
    check("§4a süzgeçsiz ≥ 3 top (R1+R2+R3)", q0.summary.rollCount >= 3, String(q0.summary.rollCount));
    check("§4b ⭐ b1 → 1 top / 100 m; lot → aynı (lot ← b1)", q1.summary.rollCount === 1 && q1.summary.totalQty === 100 && q2.summary.rollCount === 1 && q2.summary.totalQty === 100, `${q1.summary.rollCount}/${q1.summary.totalQty} · ${q2.summary.rollCount}`);
    check("§4c ⭐ b2 → 2 top / 100 m (60 + 40); süzgeçli < süzgeçsiz", q3.summary.rollCount === 2 && q3.summary.totalQty === 100 && q3.summary.rollCount < q0.summary.rollCount, `${q3.summary.rollCount}/${q3.summary.totalQty}`);
    const q4 = await getQualityScorecard(RANGE, null, { lotNo: `${TAG}-YOK` });
    check("§4d bilinmeyen lot → 0 top (hata değil)", q4.summary.rollCount === 0 && q4.summary.totalQty === 0);
    const q404 = await hata(() => getQualityScorecard(RANGE, null, { warpBeamId: YOK_UUID }));
    check("§4e bilinmeyen levent → 404", q404?.status === 404 && q404.code === "WARP_BEAM_NOT_FOUND");

    console.log("\n── §5 Fire Karnesi ──");
    const f0 = await getScrapScorecard(RANGE, null);
    const f1 = await getScrapScorecard(RANGE, null, { warpBeamId: b1 });
    const f2 = await getScrapScorecard(RANGE, null, { warpBeamId: b2 });
    check("§5a süzgeçsiz fire ≥ 40 m", f0.summary.scrapQty >= 40, String(f0.summary.scrapQty));
    check("§5b ⭐ b1 → fire 0 / üretim 100; b2 → fire 40 / üretim 100 (60 + 40)", f1.summary.scrapQty === 0 && f1.summary.producedQty === 100 && f2.summary.scrapQty === 40 && f2.summary.producedQty === 100, `${f1.summary.scrapQty}/${f1.summary.producedQty} · ${f2.summary.scrapQty}/${f2.summary.producedQty}`);
    check("§5c kalite ↔ fire üretim payı aynı evren (b2: 100 = 100)", f2.summary.producedQty === q3.summary.totalQty);

    console.log("\n── §6 Zod: rota şeması ──");
    const red = (v: unknown) => !qualityQuerySchema.safeParse(v).success;
    check("§6a kalite şeması: warpBeamId uuid değil → 400; lotNo boş → 400; bilinmeyen anahtar → 400; geçerli geçer", red({ warpBeamId: "x" }) && red({ lotNo: " " }) && red({ levent: b1 }) && !red({ warpBeamId: b1, lotNo: " A " }) && qualityQuerySchema.parse({ lotNo: " A " }).lotNo === "A");
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: [t1, t2] } } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: stopIds } } });
    await prisma.yarnMovement.deleteMany({ where: { OR: [{ warpBeamId: { in: beamIds } }, { lotId: lot.id }] } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.yarnLot.delete({ where: { id: lot.id } }).catch(() => undefined);
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.warpSpec.deleteMany({ where: { id: spec.id } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, fabric.id] } } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.shiftInstance.deleteMany({ where: { id: sh.id } });
    await prisma.shiftDefinition.deleteMany({ where: { id: def.id } });
    await prisma.machine.deleteMany({ where: { id: { in: [t1, t2] } } });
    await prisma.station.deleteMany({ where: { id: stLoom.id } });
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
