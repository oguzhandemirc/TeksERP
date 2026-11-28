// =============================================================================
// test_tezgah_tahari — T2/T3: tezgâhın takılı taharı (otomatik/elle) + çerçeve kapasitesi + uyum okumaları
// =============================================================================
//   §0 statik: `mountedDrawingIn*` kolonlarını YALNIZ `machine-drawing-in.helper` yazar; genel gövdede kapalı
//   §1 levent takma DRAWING_IN + işin kumaşında plan → takılı tahar o (AUTO) + audit izi
//   §2 ⭐ düğüm (TYING_IN) / yöntemsiz takma taharı DEĞİŞTİRMEZ
//   §3 koşum açılışı: kumaşın planı → AUTO; planı olmayan kumaş dokunmaz; aynı özetli başka plan dokunmaz
//   §4 elle düzeltme: MANUAL + kim; aynı plan → changed=false; pasif plan 400; çerçeve yetmezse uyarı; null kaldırır
//   §5 uyum okumaları: tezgâh kartı (aynı özetli kumaşlar) · ürün kartı (bu taharın takılı olduğu tezgâhlar)
//   §6 çerçeve sayısı: middleware 1..16 tam sayı, DB CHECK 17'yi reddeder; genel gövde takılı taharı yazamaz
//   §7 geri alma: MOUNT_CANCEL / koşum geri alma o işlemin değiştirdiği taharı geri koyar; arada elle ya da başka
//      otomatik değişim varsa dokunmaz (claim: AUTO + aynı an)
//   §8 Tezgâh Salonu DTO'su: takılı tahar kodu + çerçeve + kaynak; boşsa null
// Negatif sonda (elle, geri alındı): `TAHAR_CHANGING_MOUNT`a TYING_IN eklenince §2a kırmızı; özet eşitliği
// kontrolü kaldırılınca §3c kırmızı; geri yükleme claim'inden `mountedDrawingInAt` çıkarılınca §7e/§7f kırmızı
// (2026-11-28; `AUTO` koşulu tek başına çıkarılınca yeşil kalır — elle düzeltme anı da değiştirir, koşul savunmadır).
// Çalıştır: npx tsx scripts/test_tezgah_tahari.ts (yalnız test DB; global ayar yazar → hedefDbEngeli)
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelStatusEvent, mountBeam } from "../src/services/warp-beam-mount.service";
import { openMachineRun, revokeMachineRun } from "../src/services/machine-run.service";
import { getLoomFloor } from "../src/services/loom-floor.service";
import { readMachineDrawingInFit, readMachinesForDrawingInPlan, setMountedDrawingInManual } from "../src/services/helpers/machine-drawing-in.helper";
import { machinePlanFields } from "../src/middlewares/machine-plan-fields.middleware";
import { machineService } from "../src/routes/station.routes";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-THR2-${Date.now().toString(36).toUpperCase()}`;
const KEYS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.PRODUCTION_ENABLED];
const saved = new Map<string, unknown>();
const made = { station: "", looms: [] as string[], items: [] as string[], specs: [] as string[], beams: [] as string[], weaving: [] as string[], plans: [] as string[], salon: { D: "", E: "" } };
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

function srcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function statik(): void {
  const root = path.join(__dirname, "..", "src");
  const writers = srcFiles(root).filter((f) => /mountedDrawingInSource:\s*"/.test(readFileSync(f, "utf8")));
  const rel = writers.map((f) => path.relative(root, f));
  check("§0a takılı taharı yazan TEK dosya machine-drawing-in.helper", rel.length === 1 && rel[0] === path.join("services", "helpers", "machine-drawing-in.helper.ts"), rel.join(","));
  const guard = readFileSync(path.join(root, "constants", "write-guard.ts"), "utf8");
  check("§0b genel CRUD gövdesinde mountedDrawingIn* kapalı (write-guard)", ["mountedDrawingInPlanId", "mountedDrawingInSource", "mountedDrawingInAt", "mountedDrawingInById"].every((k) => guard.includes(`"${k}"`)));
}

const plan = async (s: string, threadingKey: string, frameCount: number, isActive = true) => {
  const r = await prisma.drawingInPlan.create({ data: { code: `${TAG}-${s}`.slice(0, 32), name: `${TAG} ${s}`, frameCount, threading: [1, 2, 3, 4].map((v) => Math.min(v, frameCount)), notation: "1-2-3-4", threadingKey: `${TAG}-${threadingKey}`, isActive }, select: { id: true, code: true } });
  made.plans.push(r.id);
  return r;
};

async function fixtures() {
  made.station = (await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;
  const loom = async (s: string, frameCount: number | null = null) => {
    const id = (await prisma.machine.create({ data: { stationId: made.station, name: `${TAG}-${s}`, code: `${TAG}-${s}`.slice(0, 32), warpBeamSlots: 2, frameCount }, select: { id: true } })).id;
    made.looms.push(id);
    return id;
  };
  const yarn = (await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } })).id;
  made.items.push(yarn);
  const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-G`, name: `${TAG} G`, yarnItemId: yarn, endsCount: 4000, takeUpPct: 8 }, select: { id: true } })).id;
  made.specs.push(spec);
  const P1 = await plan("P1", "K1", 4), P1b = await plan("P1B", "K1", 4), P2 = await plan("P2", "K2", 8), OFF = await plan("OFF", "K3", 4, false);
  const fabric = async (s: string, drawingInPlanId: string | null) => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC", warpSpecId: spec, drawingInPlanId }, select: { id: true } })).id;
    made.items.push(id);
    return id;
  };
  const X = await fabric("X", P1.id), Xb = await fabric("XB", P1b.id), Y = await fabric("Y", P2.id), N = await fabric("N", null);
  const sub = await ensureTestDyeHouse();
  const beamFor = async (itemId: string) => {
    const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-${made.weaving.length}`, itemId, executionKind: "IN_HOUSE", plannedM: 500 }, select: { id: true } });
    made.weaving.push(wo.id);
    const p = await createWarpBeam({ warpSpecId: spec, plannedLengthM: 1000, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    made.beams.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 1000, kgSource: WarpKgSource.THEORETICAL });
    await prisma.warpBeam.update({ where: { id: p.data.id }, data: { weavingOrderId: wo.id } });
    return p.data.id;
  };
  return { P1, P1b, P2, OFF, X, Xb, Y, N, A: await loom("A", 8), B: await loom("B", 2), C: await loom("C"), beamFor };
}

const mounted = (id: string) => prisma.machine.findUniqueOrThrow({ where: { id }, select: { mountedDrawingInPlanId: true, mountedDrawingInSource: true, mountedDrawingInById: true, mountedDrawingInAt: true } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== TEZGÂH TAHARI (T2/T3) ===\n");
  statik();
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, false);
  const admin = await ensureTestAdmin();
  const f = await fixtures();

  console.log("\n── §1 levent takma DRAWING_IN ──");
  await mountBeam(await f.beamFor(f.X), { machineId: f.A, position: 1, mountMethod: "DRAWING_IN" }, admin.id);
  const a1 = await mounted(f.A);
  check("§1a ⭐ DRAWING_IN → takılı tahar = kumaşın planı, kaynak AUTO, kim dolu", a1.mountedDrawingInPlanId === f.P1.id && a1.mountedDrawingInSource === "AUTO" && a1.mountedDrawingInById === admin.id && a1.mountedDrawingInAt != null, JSON.stringify(a1));
  const log = await prisma.systemLog.count({ where: { tableName: "MACHINE", recordId: f.A, action: "UPDATE" } });
  check("§1b değişim izi audit'e düştü (MACHINE UPDATE)", log >= 1, String(log));

  console.log("\n── §2 düğüm taharı korur ──");
  await mountBeam(await f.beamFor(f.Y), { machineId: f.A, position: 2, mountMethod: "TYING_IN" }, admin.id);
  check("§2a ⭐ TYING_IN farklı planlı kumaşta bile taharı DEĞİŞTİRMEZ", (await mounted(f.A)).mountedDrawingInPlanId === f.P1.id);
  await mountBeam(await f.beamFor(f.Y), { machineId: f.C, position: 1 }, admin.id);
  check("§2b yöntem beyanı yoksa dokunulmaz (bilinmiyor kalır)", (await mounted(f.C)).mountedDrawingInPlanId === null);
  await mountBeam(await f.beamFor(f.Y), { machineId: f.B, position: 1, mountMethod: "HARNESS_CHANGE" }, admin.id);
  check("§2c HARNESS_CHANGE da taharı çeker", (await mounted(f.B)).mountedDrawingInPlanId === f.P2.id);

  console.log("\n── §3 koşum açılışı ──");
  await openMachineRun({ machineId: f.C, productionLineNo: 1, itemId: f.X }, admin.id);
  const c3 = await mounted(f.C);
  check("§3a ⭐ koşum açılışında kumaşın planı → AUTO", c3.mountedDrawingInPlanId === f.P1.id && c3.mountedDrawingInSource === "AUTO", JSON.stringify(c3));
  await prisma.machineRun.updateMany({ where: { machineId: f.C, endedAt: null }, data: { endedAt: new Date() } });
  await openMachineRun({ machineId: f.C, productionLineNo: 1, itemId: f.N }, admin.id);
  check("§3b planı olmayan kumaşın koşumu taharı silmez", (await mounted(f.C)).mountedDrawingInPlanId === f.P1.id);
  await prisma.machineRun.updateMany({ where: { machineId: f.C, endedAt: null }, data: { endedAt: new Date() } });
  await openMachineRun({ machineId: f.C, productionLineNo: 1, itemId: f.Xb }, admin.id);
  check("§3c ⭐ aynı özetli başka plan → aynı fiziksel tahar, dokunulmaz", (await mounted(f.C)).mountedDrawingInPlanId === f.P1.id);

  console.log("\n── §4 elle düzeltme ──");
  const m1 = await setMountedDrawingInManual(f.B, f.P1.id, admin.id);
  const b4 = await mounted(f.B);
  check("§4a MANUAL + kim; 4 çerçeveli plan 2 çerçeveli tezgâhta UYARI (engel değil)", m1.changed && b4.mountedDrawingInSource === "MANUAL" && b4.mountedDrawingInPlanId === f.P1.id && m1.warnings.length === 1, JSON.stringify(m1));
  const m2 = await setMountedDrawingInManual(f.B, f.P1.id, admin.id);
  check("§4b aynı plan → changed=false", m2.changed === false);
  const bad = await setMountedDrawingInManual(f.B, f.OFF.id, admin.id).then(() => "OK", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode} ${e.details?.code}`);
  check("§4c pasif plan 400 DRAWING_IN_PLAN_NOT_FOUND", bad === "400 DRAWING_IN_PLAN_NOT_FOUND", bad);
  await setMountedDrawingInManual(f.B, null, admin.id);
  check("§4d null kaldırır (kaynak MANUAL kalır — kim kaldırdı izi)", (await mounted(f.B)).mountedDrawingInPlanId === null && (await mounted(f.B)).mountedDrawingInSource === "MANUAL");

  console.log("\n── §5 uyum okumaları ──");
  const fit = await readMachineDrawingInFit(f.A);
  const codes = fit.items.map((i) => i.id);
  check("§5a ⭐ tezgâh kartı: aynı özetli kumaşlar (X + XB), farklı tahar (Y) ve plansız (N) yok", codes.includes(f.X) && codes.includes(f.Xb) && !codes.includes(f.Y) && !codes.includes(f.N), String(codes.length));
  const onB = await readMachineDrawingInFit(f.B);
  check("§5b takılı taharı olmayan tezgâhta liste boş", onB.machine.mountedDrawingInPlan === null && onB.items.length === 0);
  const ms = (await readMachinesForDrawingInPlan(f.P1b.id)).machines.map((m) => m.id);
  check("§5c ⭐ ürün kartı: aynı özetli plan için A ve C, taharı kaldırılan B yok", ms.includes(f.A) && ms.includes(f.C) && !ms.includes(f.B), String(ms.length));

  console.log("\n── §6 çerçeve sayısı + genel gövde ──");
  check("§6a middleware 17'yi ve 2,5'i reddeder, '12'yi ve null'u kabul eder", !machinePlanFields.safeParse({ frameCount: 17 }).success && !machinePlanFields.safeParse({ frameCount: 2.5 }).success
    && machinePlanFields.safeParse({ frameCount: "12" }).data?.frameCount === 12 && machinePlanFields.safeParse({ frameCount: null }).success);
  const chk = await prisma.machine.update({ where: { id: f.C }, data: { frameCount: 17 } }).then(() => "OK", () => "RED");
  check("§6b DB CHECK machines_frame_count_range 17'yi reddeder", chk === "RED");
  await machineService.update(f.C, { mountedDrawingInPlanId: f.P2.id, mountedDrawingInSource: "MANUAL", frameCount: 12 } as never, admin.id);
  const c6 = await prisma.machine.findUniqueOrThrow({ where: { id: f.C }, select: { frameCount: true, mountedDrawingInPlanId: true } });
  check("§6c ⭐ genel gövde frameCount'u yazar, takılı taharı SESSİZCE düşürür", c6.frameCount === 12 && c6.mountedDrawingInPlanId === f.P1.id, JSON.stringify(c6));

  await geriAlma(f, admin.id);
  await salon(f);
}

type Fx = Awaited<ReturnType<typeof fixtures>>;
const mountedEvent = (beamId: string) => prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId, kind: "MOUNTED" }, select: { id: true, drawingInPrevPlanId: true, drawingInPrevSource: true, drawingInSetAt: true } });

/** §7 geri alma: takma/koşum geri alınınca o işlemin değiştirdiği tahar geri gelir; arada değişim varsa dokunulmaz. */
async function geriAlma(f: Fx, userId: string): Promise<void> {
  console.log("\n── §7 geri alma taharı geri yükler ──");
  const D = (await prisma.machine.create({ data: { stationId: made.station, name: `${TAG}-D`, code: `${TAG}-D`.slice(0, 32), warpBeamSlots: 2, frameCount: 8 }, select: { id: true } })).id;
  const E = (await prisma.machine.create({ data: { stationId: made.station, name: `${TAG}-E`, code: `${TAG}-E`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } })).id;
  made.looms.push(D, E);
  await setMountedDrawingInManual(D, f.P2.id, userId);
  const b1 = await f.beamFor(f.X);
  await mountBeam(b1, { machineId: D, position: 1, mountMethod: "DRAWING_IN" }, userId);
  const ev1 = await mountedEvent(b1);
  check("§7a MOUNTED satırı eski taharı taşır (P2 · MANUAL · an dolu)", ev1.drawingInPrevPlanId === f.P2.id && ev1.drawingInPrevSource === "MANUAL" && ev1.drawingInSetAt != null, JSON.stringify(ev1));
  await cancelStatusEvent(b1, ev1.id, "test geri alma", userId);
  const d1 = await mounted(D);
  check("§7b ⭐ takma geri alınınca önceki tahar (P2, MANUAL) geri gelir", d1.mountedDrawingInPlanId === f.P2.id && d1.mountedDrawingInSource === "MANUAL", JSON.stringify(d1));

  const b2 = await f.beamFor(f.X);
  await mountBeam(b2, { machineId: D, position: 1, mountMethod: "DRAWING_IN" }, userId);
  await setMountedDrawingInManual(D, f.P1b.id, userId);
  await cancelStatusEvent(b2, (await mountedEvent(b2)).id, "test geri alma", userId);
  const d2 = await mounted(D);
  check("§7c ⭐ takmadan SONRA elle düzeltme varsa geri alma ezmez (P1B, MANUAL kalır)", d2.mountedDrawingInPlanId === f.P1b.id && d2.mountedDrawingInSource === "MANUAL", JSON.stringify(d2));

  const r1 = (await openMachineRun({ machineId: E, productionLineNo: 1, itemId: f.X }, userId)).data;
  await revokeMachineRun(r1.id, "test geri alma", userId);
  const e1 = await mounted(E);
  check("§7d ⭐ koşum geri alınınca tahar eski hâline (hiç yok) döner", e1.mountedDrawingInPlanId === null && e1.mountedDrawingInSource === null, JSON.stringify(e1));

  const r2 = (await openMachineRun({ machineId: E, productionLineNo: 1, itemId: f.X }, userId)).data;
  await prisma.machineRun.updateMany({ where: { id: r2.id }, data: { endedAt: new Date() } });
  const r3 = (await openMachineRun({ machineId: E, productionLineNo: 1, itemId: f.Y }, userId)).data;
  await revokeMachineRun(r2.id, "test geri alma", userId);
  check("§7e ⭐ arada başka koşum taharı değiştirdiyse eski koşumun geri alınması dokunmaz (P2 kalır)", (await mounted(E)).mountedDrawingInPlanId === f.P2.id);
  await revokeMachineRun(r3.id, "test geri alma", userId);
  const e3 = await mounted(E);
  check("§7f son koşum geri alınınca kendi önceki taharı (P1, AUTO) geri gelir", e3.mountedDrawingInPlanId === f.P1.id && e3.mountedDrawingInSource === "AUTO", JSON.stringify(e3));
  const audits = await prisma.systemLog.count({ where: { tableName: "MACHINE", recordId: E, action: "UPDATE" } });
  check("§7g geri yüklemeler audit izine düştü", audits >= 4, String(audits));
  made.salon = { D, E };
}

/** §8 Tezgâh Salonu DTO'su: takılı tahar kodu + çerçeve + kaynak; boşsa null. */
async function salon(f: Fx): Promise<void> {
  console.log("\n── §8 Tezgâh Salonu tahar bilgisi ──");
  const looms = (await getLoomFloor()).data.looms;
  const d = looms.find((l) => l.id === made.salon.D), b = looms.find((l) => l.id === f.B);
  check("§8a ⭐ kartta tahar kodu, plan çerçevesi, kaynak ve tezgâh çerçevesi", d?.drawingIn?.planCode === `${TAG}-P1B`.slice(0, 32) && d.drawingIn.planFrameCount === 4 && d.drawingIn.source === "MANUAL" && d.frameCount === 8, JSON.stringify(d?.drawingIn));
  check("§8b taharı olmayan tezgâhta drawingIn null", b !== undefined && b.drawingIn === null, JSON.stringify(b?.drawingIn));
}

async function cleanup(): Promise<void> {
  const t = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.machineRun.deleteMany({ where: { machineId: { in: made.looms } } }));
  await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } }));
  await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } }));
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: made.weaving } } }));
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.beams, ...made.items, ...made.looms] } } }));
  await t(() => prisma.machine.updateMany({ where: { id: { in: made.looms } }, data: { mountedDrawingInPlanId: null } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: made.items } }, data: { warpSpecId: null, drawingInPlanId: null } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { id: { in: made.specs } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: made.items } } }));
  await t(() => prisma.drawingInPlan.deleteMany({ where: { id: { in: made.plans } } }));
  await t(() => prisma.machine.deleteMany({ where: { id: { in: made.looms } } }));
  if (made.station) await t(() => prisma.station.deleteMany({ where: { id: made.station } }));
  for (const [key, value] of saved) {
    if (value === undefined) await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
    else await t(() => setSetting(key, value));
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
