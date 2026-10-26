// =============================================================================
// KK1 DOĞUŞUNDA MUAYENE (K4P-KK1, 2026-10-25) — top ve RAW muayene AYNI tx'te doğar
// =============================================================================
// NEDEN: çevrimdışı kuyrukta "top + ayrı muayene isteği" iki kimlik ve sıra sorunu doğurur; tek token
// topun token'ıdır. Muayene yalnız `createInspectionTx` (tek yazar) ile yazılır; kapı (modül + izin)
// `resolveInspectionOnBirth`te — kapalıysa top YİNE doğar ve yanıt uyarı taşır (kalıcı düşüş yok).
//
// Bölümler:
//   §0 statik + zod (alan LİSTEDE; metre ≤ metraj; ≤500 hata; servis çağrısı tx içinde)
//   §1 inspection'lı doğuş → top + RAW muayene + INSPECTION hata satırları tek commit'te, yanıt `data.inspection`
//   §2 aynı token replay → tek top, tek muayene; yanıt aynı muayeneyi taşır
//   §3 modül kapalı → top var, muayene yok, `inspectionNotSaved.code` + `warnings` metni
//   §4 izinsiz kullanıcı → aynı (reason PERMISSION_DENIED)
//   §5 bilinmeyen tür → 400 UNKNOWN_DEFECT_TYPE, top YOK · §5d yeteneksiz istasyon (K4P-KK1b) → top DOĞAR,
//      muayene YOK, `inspectionNotSaved.reason = STATION_NO_QUALITY`
//   §6 alansız gövde → yanıt anahtar kümesi eskisiyle aynı (`inspection`/`inspectionNotSaved` yok)
//   §7 mükerrer tuzağı açıkken inspection'lı ikinci giriş → 409 POSSIBLE_DUPLICATE, muayene yazılmaz
//   §8 KK1 doğuşu (`machineCode`) ile birlikte → top + doff + muayene
//   §9 oturum yanıtı: `inspectionEnabled` true/false istasyonda `canInspect`, oturumsuz `false`
//
// NEGATİF SONDA (2026-10-25, geri alındı):
//   · `createInspectionTx` çağrısı tx dışına (commit sonrasına) taşındı → §5 "top YOK" kırmızı
//   · `initialEntryReplay` `.run(...)` yerine doğrudan `createInitialEntryFresh` → §2 kırmızı
//   · (K4P-KK1b) `resolveInspectionOnBirth` istasyon dalı silindi → §5d/§5d2/§5d3/§5d4 kırmızı
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner. Fikstür `TST-KM-<ek>` önekli.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, RollEntrySource, StationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { initialEntrySchema } from "../src/controllers/inventory.controller";
import { WorkSessionService } from "../src/services/work-session.service";
import { AppError } from "../src/utils/app-error";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
function kod(e: unknown): string {
  return e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 160);
}
async function bekle<T>(p: Promise<T>): Promise<{ ok: boolean; v?: T; e?: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}
const uuid = (): string => crypto.randomUUID();
const ROOT = path.resolve(__dirname, "..");
const TAG = `TST-KM-${Date.now().toString(36).toUpperCase()}`;
const KG = "kaliteGuvence.enabled";
const FLAGS = [KG, SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_ENABLED];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
const ALL = ["inspection:write", "roll:write"];

type Sonuc = {
  success: boolean;
  data: { id: string; doffEventId: string | null; inspection?: { id: string; pointsPer100M2: unknown; suggestedGradeCode: string | null } | null };
  message?: string;
  warnings?: string[];
  idempotent?: boolean;
  inspectionNotSaved?: { code: string; reason: string; message: string };
};

function statik(): void {
  console.log("── §0 Statik + zod ──");
  const taban = { itemId: uuid(), initialQty: 50 };
  const parse = (b: Record<string, unknown>) => initialEntrySchema.safeParse({ ...taban, ...b });
  const ok = parse({ inspection: { defects: [{ defectTypeId: uuid(), sizeClass: "UP_TO_3IN", startMeter: 10 }], note: "x" } });
  check("§0a zod: `inspection` LİSTEDE (parse sonrası düşmez)", ok.success && Boolean((ok.data as { inspection?: unknown }).inspection));
  check("§0b zod: metre > metraj · uzunluk > metraj · negatif metre · 501 hata · not > 500 → red",
    !parse({ inspection: { defects: [{ defectTypeId: uuid(), startMeter: 51 }] } }).success &&
    !parse({ inspection: { defects: [], inspectedLengthM: 51 } }).success &&
    !parse({ inspection: { defects: [{ defectTypeId: uuid(), startMeter: -1 }] } }).success &&
    !parse({ inspection: { defects: Array.from({ length: 501 }, () => ({ defectTypeId: uuid() })) } }).success &&
    !parse({ inspection: { defects: [], note: "x".repeat(501) } }).success &&
    !parse({ inspection: { defects: [{ defectTypeId: uuid(), sizeClass: "BOGUS" }] } }).success);
  const svc = readFileSync(path.join(ROOT, "src/services/inventory.service.ts"), "utf8");
  const tx = svc.indexOf("roll = await prisma.$transaction(async (tx) => {");
  const call = svc.indexOf("await createInspectionTx(tx, {");
  const end = svc.indexOf("    await AuditService.log({", tx);
  check("§0c `createInspectionTx(tx, …)` doğuş tx'inin İÇİNDE (tek çağrı)", tx > 0 && call > tx && call < end && svc.split("createInspectionTx(").length === 2);
  const writers = ["src/services/inventory.service.ts"].map((f) => readFileSync(path.join(ROOT, f), "utf8"));
  check("§0d inventory.service muayeneyi doğrudan YAZMAZ (`rollInspection.create` yok — tek yazar)", writers.every((s) => !/rollInspection\.create/.test(s)));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("=== KK1 DOĞUŞUNDA MUAYENE BEKÇİSİ (K4P-KK1) ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const admin = { id: await testActorId() };
  const user = await prisma.user.create({ data: { username: `${TAG}-u`.toLowerCase(), passwordHash: "x", fullName: `${TAG} operatör` }, select: { id: true } });
  // Fikstür kuralı: KK1 istasyonlarında `inspectionEnabled` AÇIK yazılır (D1 türetmesi RAW_QC'ye false verir).
  const stOn = await prisma.station.create({ data: { name: `${TAG}-KK1-ON`, code: `${TAG}-ON`.slice(0, 32), type: StationType.INTERNAL, kind: "RAW_QC", inspectionEnabled: true }, select: { id: true } });
  const stOff = await prisma.station.create({ data: { name: `${TAG}-KK1-OFF`, code: `${TAG}-OF`.slice(0, 32), type: StationType.INTERNAL, kind: "RAW_QC", inspectionEnabled: false }, select: { id: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING" }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-L1`, code: `${TAG}-L1`.slice(0, 32), isActive: true }, select: { id: true, code: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const dtA = await prisma.defectType.create({ data: { code: `${TAG}-A`.slice(0, 32), name: `${TAG} delik` }, select: { id: true } });
  const dtF = await prisma.defectType.create({ data: { code: `${TAG}-F`.slice(0, 32), name: `${TAG} sabit`, fixedPoints: 4 } as Prisma.DefectTypeCreateInput, select: { id: true } });
  const run = await prisma.machineRun.create({ data: { machineId: loom.id, productionLineNo: 1, startedAt: new Date(), itemId: fabric.id }, select: { id: true } });
  const dev = await prisma.device.create({ data: { deviceId: `${TAG}-dev`, name: `${TAG} tablet`, status: "APPROVED" } as Prisma.DeviceCreateInput, select: { id: true } });
  const dev2 = await prisma.device.create({ data: { deviceId: `${TAG}-dev2`, name: `${TAG} tablet2`, status: "APPROVED" } as Prisma.DeviceCreateInput, select: { id: true } });
  const sessionIds: string[] = [];

  const inventory = new InventoryService();
  const rollIds: string[] = [];
  const insp = (extra: Record<string, unknown> = {}) => ({
    defects: [{ defectTypeId: dtA.id, sizeClass: "IN_3_TO_6" as const, startMeter: 5 }, { defectTypeId: dtF.id, startMeter: 20 }],
    note: "KK1 doğuş muayenesi",
    permissions: ALL,
    ...extra,
  });
  const gir = async (
    o: { token?: string; inspection?: ReturnType<typeof insp> | null; stationId?: string | null; userId?: string; qty?: number; guard?: boolean; machineId?: string | null; kk1Birth?: { machineCode: string; weavingOrderId: null; warpBeamId: null; productionLineNo: null } } = {},
  ): Promise<Sonuc> => {
    const r = (await inventory.createInitialEntry(
      { itemId: fabric.id, initialQty: o.qty ?? 100, clientToken: o.token },
      o.userId ?? admin.id,
      o.machineId ?? null,
      true,
      {
        entryStationId: o.stationId === undefined ? stOn.id : o.stationId,
        ...(o.guard ? { duplicateGuard: { confirmed: false } } : {}),
        ...(o.kk1Birth ? { forcedEntrySource: RollEntrySource.WEAVING, kk1Birth: o.kk1Birth } : {}),
        ...(o.inspection ? { inspection: o.inspection } : {}),
      },
    )) as unknown as Sonuc;
    if (!rollIds.includes(r.data.id)) rollIds.push(r.data.id);
    return r;
  };
  const rollCount = () => prisma.roll.count({ where: { itemId: fabric.id } });
  const inspOf = (rollId: string) => prisma.rollInspection.findMany({ where: { rollId }, select: { id: true, phase: true, stationId: true, defectCount: true, totalPoints: true, inspectedLengthM: true } });
  const errOf = (rollId: string) => prisma.rollError.findMany({ where: { rollId }, select: { origin: true, inspectionId: true, points: true } });

  try {
    await setFlag(KG, true);
    await setFlag(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, false);

    console.log("\n── §1 inspection'lı doğuş ──");
    const t1 = uuid();
    const r1 = await gir({ token: t1, inspection: insp() });
    const i1 = await inspOf(r1.data.id);
    const e1 = await errOf(r1.data.id);
    check("§1a top doğdu + tek RAW muayene (istasyon = giriş istasyonu, 2 hata, uzunluk = metraj)",
      i1.length === 1 && i1[0]!.phase === "RAW" && i1[0]!.stationId === stOn.id && i1[0]!.defectCount === 2 && Number(i1[0]!.inspectedLengthM) === 100,
      JSON.stringify(i1));
    check("§1b INSPECTION hata satırları muayeneye bağlı (2 satır, puan 2+4)", e1.length === 2 && e1.every((e) => e.origin === "INSPECTION" && e.inspectionId === i1[0]?.id) && e1.reduce((s, e) => s + (e.points ?? 0), 0) === 6, JSON.stringify(e1));
    check("§1c yanıt `data.inspection {id, pointsPer100M2, suggestedGradeCode}` taşır, uyarı yok", r1.data.inspection?.id === i1[0]?.id && "pointsPer100M2" in (r1.data.inspection ?? {}) && "suggestedGradeCode" in (r1.data.inspection ?? {}) && !r1.warnings && !r1.inspectionNotSaved);
    const audit = await prisma.systemLog.count({ where: { recordId: i1[0]?.id ?? "", tableName: "ROLL_INSPECTION" } });
    check("§1d muayene audit izi (tx dışı, ROLL_INSPECTION)", audit === 1, String(audit));

    console.log("\n── §2 replay ──");
    const x2 = await bekle(gir({ token: t1, inspection: insp() }));
    const r2 = x2.v;
    check("§2a aynı token → aynı top, `idempotent`", r2?.data.id === r1.data.id && r2?.idempotent === true, x2.ok ? "" : kod(x2.e));
    check("§2b tek muayene (replay yeniden YAZMAZ), yanıt aynı muayeneyi taşır", (await inspOf(r1.data.id)).length === 1 && (await errOf(r1.data.id)).length === 2 && r2?.data.inspection?.id === i1[0]?.id);
    const x2b = await bekle(gir({ token: t1 }));
    check("§2c alansız replay → `inspection` anahtarı YOK", x2b.v?.data.id === r1.data.id && !("inspection" in (x2b.v?.data ?? { inspection: 1 })), x2b.ok ? "" : kod(x2b.e));

    console.log("\n── §3 modül kapalı ──");
    await setFlag(KG, false);
    const r3 = await gir({ token: uuid(), inspection: insp() });
    check("§3a top doğdu, muayene YOK", (await inspOf(r3.data.id)).length === 0 && (await errOf(r3.data.id)).length === 0);
    check("§3b `inspectionNotSaved {code INSPECTION_NOT_SAVED, reason MODULE_DISABLED}` + `warnings` metni", r3.inspectionNotSaved?.code === "INSPECTION_NOT_SAVED" && r3.inspectionNotSaved.reason === "MODULE_DISABLED" && (r3.warnings ?? []).some((w) => w.startsWith("Muayene kaydedilmedi")) && r3.data.inspection === null, JSON.stringify({ n: r3.inspectionNotSaved, w: r3.warnings }));
    await setFlag(KG, true);

    console.log("\n── §4 izinsiz kullanıcı ──");
    const r4 = await gir({ token: uuid(), inspection: insp({ permissions: ["roll:write", "mobile:kk1"] }), userId: user.id });
    check("§4 top doğdu, muayene YOK, reason PERMISSION_DENIED", (await inspOf(r4.data.id)).length === 0 && r4.inspectionNotSaved?.code === "INSPECTION_NOT_SAVED" && r4.inspectionNotSaved.reason === "PERMISSION_DENIED", JSON.stringify(r4.inspectionNotSaved));

    console.log("\n── §5 yapısal hata → hiçbir şey yazılmaz ──");
    const once5 = await rollCount();
    const tok5 = uuid();
    const x5 = await bekle(gir({ token: tok5, inspection: insp({ defects: [{ defectTypeId: uuid(), sizeClass: "UP_TO_3IN" }] }) }));
    check("§5a bilinmeyen tür → 400 UNKNOWN_DEFECT_TYPE", !x5.ok && kod(x5.e) === "UNKNOWN_DEFECT_TYPE", x5.ok ? "YAZILDI" : kod(x5.e));
    check("§5b top YOK (tx geri alındı; barkod numarası yanmış olabilir)", (await rollCount()) === once5 && (await prisma.roll.count({ where: { clientToken: tok5 } })) === 0);
    const x5c = await bekle(gir({ token: uuid(), inspection: insp({ defects: [{ defectTypeId: dtA.id, sizeClass: "UP_TO_3IN", startMeter: 3 }, { defectTypeId: dtA.id, sizeClass: "UP_TO_3IN", startMeter: 3 }] }) }));
    check("§5c payload içi tekrar → 400 DUPLICATE_DEFECT_IN_PAYLOAD, top YOK", !x5c.ok && kod(x5c.e) === "DUPLICATE_DEFECT_IN_PAYLOAD" && (await rollCount()) === once5, x5c.ok ? "YAZILDI" : kod(x5c.e));
    // K4P-KK1b (patron 2026-10-25): yetenek sonradan kapatılmış istasyonun kuyruk kaydı 400'le kaybolmaz.
    const x5d = await bekle(gir({ token: uuid(), inspection: insp(), stationId: stOff.id }));
    const r5d = x5d.v;
    check("§5d muayenesi kapalı istasyonda inspection → 400 DEĞİL, top DOĞAR", x5d.ok && !!r5d?.data.id && (await rollCount()) === once5 + 1, x5d.ok ? "" : kod(x5d.e));
    check("§5d2 muayene + INSPECTION hata satırı YOK, `data.inspection` null",
      !!r5d && (await inspOf(r5d.data.id)).length === 0 && (await errOf(r5d.data.id)).length === 0 && r5d.data.inspection === null);
    check("§5d3 `inspectionNotSaved {INSPECTION_NOT_SAVED, STATION_NO_QUALITY}` + `warnings` metni",
      r5d?.inspectionNotSaved?.code === "INSPECTION_NOT_SAVED" && r5d.inspectionNotSaved.reason === "STATION_NO_QUALITY" && (r5d.warnings ?? []).some((w) => w.startsWith("Muayene kaydedilmedi")),
      JSON.stringify({ n: r5d?.inspectionNotSaved, w: r5d?.warnings }));
    const x5d4 = await bekle(gir({ token: uuid(), inspection: insp({ defects: [{ defectTypeId: uuid(), sizeClass: "UP_TO_3IN" }] }), stationId: stOff.id }));
    check("§5d4 yeteneksiz istasyonda muayene YAZILMADIĞI için bozuk tür doğrulanmaz → top doğar (kapı önce)", x5d4.ok && x5d4.v?.inspectionNotSaved?.reason === "STATION_NO_QUALITY", x5d4.ok ? "" : kod(x5d4.e));
    const r5e = await gir({ token: uuid(), inspection: insp(), stationId: null });
    check("§5e istasyonsuz giriş → muayene yazılır (yazma kapısı istasyona bağlı DEĞİL)", (await inspOf(r5e.data.id)).length === 1 && (await inspOf(r5e.data.id))[0]!.stationId === null);

    console.log("\n── §6 alansız gövde ──");
    const r6 = await gir({ token: uuid(), stationId: stOff.id });
    check("§6 yanıt anahtarları eskisi: {success,data,message}; data'da inspection yok", JSON.stringify(Object.keys(r6).sort()) === JSON.stringify(["data", "message", "success"]) && !("inspection" in r6.data) && (await inspOf(r6.data.id)).length === 0, JSON.stringify(Object.keys(r6)));

    console.log("\n── §7 mükerrer tuzağı ──");
    await setFlag(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, true);
    const r7a = await gir({ token: uuid(), qty: 77, guard: true });
    const x7 = await bekle(gir({ token: uuid(), qty: 77, guard: true, inspection: insp() }));
    check("§7 ikinci giriş → 409 POSSIBLE_DUPLICATE, muayene yazılmaz", !x7.ok && kod(x7.e) === "POSSIBLE_DUPLICATE" && (await inspOf(r7a.data.id)).length === 0 && (await prisma.roll.count({ where: { itemId: fabric.id, initialQty: 77 } })) === 1, x7.ok ? "YAZILDI" : kod(x7.e));
    await setFlag(SETTING_KEYS.KK1_DUPLICATE_GUARD_ENABLED, false);

    console.log("\n── §8 KK1 doğuşu (machineCode) ile ──");
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, false);
    const r8 = await gir({ token: uuid(), inspection: insp(), kk1Birth: { machineCode: loom.code, weavingOrderId: null, warpBeamId: null, productionLineNo: null } });
    check("§8 top + doff + muayene tek tx'te", Boolean(r8.data.doffEventId) && (await inspOf(r8.data.id)).length === 1 && r8.data.inspection?.id != null, JSON.stringify({ doff: r8.data.doffEventId, insp: r8.data.inspection }));

    console.log("\n── §9 oturum yanıtı `canInspect` ──");
    const s1 = await prisma.workSession.create({ data: { userId: admin.id, deviceId: dev.id, stationId: stOn.id, lastActivityAt: new Date() }, select: { id: true } });
    sessionIds.push(s1.id);
    const c1 = (await WorkSessionService.current(dev.id, admin.id)).data as { active: { station: { canInspect: boolean } } | null; canInspect: boolean };
    check("§9a `inspectionEnabled=true` istasyonda canInspect=true (station + üst düzey)", c1.active?.station.canInspect === true && c1.canInspect === true, JSON.stringify(c1.active?.station));
    await prisma.workSession.update({ where: { id: s1.id }, data: { endedAt: new Date() } });
    const s2 = await prisma.workSession.create({ data: { userId: admin.id, deviceId: dev.id, stationId: stOff.id, lastActivityAt: new Date() }, select: { id: true } });
    sessionIds.push(s2.id);
    const c2 = (await WorkSessionService.current(dev.id, admin.id)).data as { active: { station: { canInspect: boolean } } | null; canInspect: boolean };
    check("§9b `inspectionEnabled=false` istasyonda canInspect=false", c2.active?.station.canInspect === false && c2.canInspect === false);
    const c3 = (await WorkSessionService.current(dev2.id, admin.id)).data as { active: unknown; canInspect: boolean };
    check("§9c oturumsuz cihaz → active null, canInspect=false", c3.active === null && c3.canInspect === false);
    void run;
  } finally {
    const insIds = (await prisma.rollInspection.findMany({ where: { rollId: { in: rollIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollInspection.deleteMany({ where: { id: { in: insIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...insIds, ...sessionIds] } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { OR: [{ id: { in: rollIds } }, { itemId: fabric.id }] } });
    await prisma.doffEvent.deleteMany({ where: { machineId: loom.id } });
    await prisma.machineRun.deleteMany({ where: { machineId: loom.id } });
    await prisma.workSession.deleteMany({ where: { deviceId: { in: [dev.id, dev2.id] } } });
    await prisma.device.deleteMany({ where: { id: { in: [dev.id, dev2.id] } } });
    await prisma.defectType.deleteMany({ where: { id: { in: [dtA.id, dtF.id] } } });
    await prisma.item.deleteMany({ where: { id: fabric.id } });
    await prisma.machine.deleteMany({ where: { id: loom.id } });
    await prisma.station.deleteMany({ where: { id: { in: [stOn.id, stOff.id, stLoom.id] } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
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
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
