// =============================================================================
// TOP KK1'DE DOĞAR (S1, `dokuma.rollBirth`) — tezgah etiketi / iş emri ile KK1 doğuşu, sunucu DoffEvent'i aynı tx'te üretir
// =============================================================================
// NEDEN: Tablet doff'u olmayan fabrikada top KK1'de doğar (plan DOKUMA-MANUEL-PLAN § S1; D9–D11, D16–D18). Gövdeye
// `machineCode` XOR `weavingOrderId` (+ `warpBeamId`, `productionLineNo`); mevcut `claimDoffForRollTx` +
// `autoConsumeForRollTx` zinciri AYNEN. Varsayılan `TABLET_DOFF` = bugünkü yol, yanıt bayt bayt aynı.
//   §0 statik+zod · §1 TABLET_DOFF kapısı · §2 B yolu (etiket → doff → top → CONSUMED) · §3 koşumsuz 409 / tezgah değil 400
//   §4 A yolu (tek tezgah doff · çok tezgah doff'suz + kolon + uyarı · rollsOfWeavingOrderWhere ikisini sayar) · §5 KK1_LABEL_ONLY
//   §6 levent beyanı pencere (12 sa) · §7 replay · §8 CHECK XOR · §9 dokuma kapalı 403 · §10 kk1-context.
// NEGATİF SONDALAR (2026-10-21, md5 ile geri yüklendi): ① `createDoffTx` damgası `readDbNow(tx)` → `new Date()`: 4 ❌
//   (§0f statik + §2c/§2e/§10b — Node saati DB saatinden sapınca `beamsMountedDuring(doffedAt)` leventi bulamadı; ±2 sn
//   penceresi §2d aynı makinede ayırt EDEMEZ, statik §0f bu yüzden var) · ② `requireOpenRunTx` 409 kapısı silinir: 1 ❌ (§3a) ·
//   ③ CHECK `rolls_weaving_order_xor_ck` düşürülür: 2 ❌ (§8a/§8b) · ④ `resolveBeamOverrideTx` pencere şartı
//   (`createdAt: { gte: since }`) silinir: 1 ❌ (§6b).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner. Fikstür `TST-KB-<ek>` önekli.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { assertKk1BirthGate, initialEntrySchema } from "../src/controllers/inventory.controller";
import { readKk1Context, type Kk1BirthInput } from "../src/services/helpers/kk1-roll-birth.helper";
import { rollsOfWeavingOrderWhere, weavingOrderOfRoll } from "../src/services/helpers/weaving-order-of-roll.helper";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { dismountBeam, mountBeam } from "../src/services/warp-beam-mount.service";
import { KK1_BEAM_CHANGE_WINDOW_HOURS, KK1_DOFF_NOTE_LABEL, KK1_DOFF_NOTE_ORDER } from "../src/constants/dokuma-kk1";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
function kod(e: unknown): string {
  return e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 120);
}
/** Sonuç tek şekilli (`e?`): ayrıntı dizesinde `kod(x.e)` daraltma istemesin. */
async function bekle<T>(p: Promise<T>): Promise<{ ok: boolean; v?: T; e?: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}
const uuid = (): string => crypto.randomUUID();
const ROOT = path.resolve(__dirname, "..");
const ek = Date.now().toString(36).toUpperCase();
const TAG = `TST-KB-${ek}`;
const FLAGS = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.DOKUMA_ROLL_BIRTH];
const setFlag = (key: string, v: boolean | string) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const dbNow = async (): Promise<Date> => (await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now -- tz-ok: damga karşılaştırması`)[0]!.now;
const consumedOf = (rollId: string) => prisma.warpBeamEvent.findMany({ where: { rollId, kind: "CONSUMED" }, select: { beamId: true, lengthM: true } });
type Sonuc = { success: boolean; data: { id: string; doffEventId: string | null; weavingOrderId: string | null; entrySource: string; doffEvent?: { id: string; code: string } }; warnings?: string[]; idempotent?: boolean };

function statik(): void {
  console.log("── §0 Statik + zod ──");
  const ctrl = readFileSync(path.join(ROOT, "src/controllers/inventory.controller.ts"), "utf8");
  const i = ctrl.indexOf("async createInitialEntry(");
  const govde = ctrl.slice(i, i + 3000);
  const kapi = govde.indexOf("assertKk1BirthGate(");
  const cagri = govde.indexOf("this.service.createInitialEntry(");
  check("§0a controller: KK1 kapısı (`assertKk1BirthGate`) servis çağrısından ÖNCE, `doffEventId` bloğundan AYRI", kapi > 0 && cagri > kapi && /if \(doffEventId && !\(await readDokumaEnabled\(\)\)\)/.test(govde));
  const fn = ctrl.slice(ctrl.indexOf("export async function assertKk1BirthGate("), ctrl.indexOf("// ⚠️ Bu şema BİLEREK strict DEĞİL"));
  check("§0b kapı gövdesi: dokuma kapalı → MODULE_DISABLED(modul dokuma); TABLET_DOFF ve KK1_LABEL_ONLY∧weavingOrderId → ROLL_BIRTH_MODE", /readDokumaEnabled\(\)/.test(fn) && /code: "MODULE_DISABLED",\s*modul: "dokuma"/.test(fn) && (fn.match(/code: "ROLL_BIRTH_MODE"/g) ?? []).length === 2 && /mode === "TABLET_DOFF"/.test(fn) && /mode === "KK1_LABEL_ONLY" && weavingOrderId/.test(fn));
  const taban = { itemId: uuid(), initialQty: 10 };
  const parse = (b: Record<string, unknown>) => initialEntrySchema.safeParse({ ...taban, ...b }).success;
  check("§0c zod: machineCode tek · weavingOrderId tek · machineCode+warpBeamId+productionLineNo GEÇER", parse({ machineCode: "T1" }) && parse({ weavingOrderId: uuid() }) && parse({ machineCode: "T1", warpBeamId: uuid(), productionLineNo: 2 }));
  check("§0d zod: doffEventId+machineCode · machineCode+weavingOrderId · semiFinished+weavingOrderId · warpBeamId tek · productionLineNo tek → 400", !parse({ doffEventId: uuid(), machineCode: "T1" }) && !parse({ machineCode: "T1", weavingOrderId: uuid() }) && !parse({ semiFinished: true, weavingOrderId: uuid() }) && !parse({ warpBeamId: uuid() }) && !parse({ productionLineNo: 1 }));
  check("§0e zod: machineCode ≤32 · boş red · weavingOrderId uuid", !parse({ machineCode: "X".repeat(33) }) && !parse({ machineCode: "  " }) && !parse({ weavingOrderId: "abc" }));
  const doffSvc = readFileSync(path.join(ROOT, "src/services/machine-doff.service.ts"), "utf8");
  const ds = doffSvc.indexOf("export async function createDoffTx(");
  const dsGovde = doffSvc.slice(ds, doffSvc.indexOf("\nexport ", ds + 10) > 0 ? doffSvc.indexOf("\nexport ", ds + 10) : undefined);
  check("§0f `createDoffTx` damgayı DB saatinden okur (`readDbNow(tx)`), Node saati (`new Date()`) YOK, `doffEvent.create` bu dosyada", /readDbNow\(tx\)/.test(dsGovde) && !/new Date\(\)/.test(dsGovde) && /tx\.doffEvent\.create\(/.test(dsGovde));
  const helper = readFileSync(path.join(ROOT, "src/services/helpers/kk1-roll-birth.helper.ts"), "utf8");
  check("§0g helper `doffEvent.create` İÇERMEZ (defter yazıcısı tek dosyada), tx AÇMAZ", !/doffEvent\.create\(/.test(helper) && !/\$transaction\(/.test(helper));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("=== TOP KK1'DE DOĞAR BEKÇİSİ (S1, dokuma.rollBirth) ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });

  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const stQc = await prisma.station.create({ data: { name: `${TAG}-KK1`, code: `${TAG}-QC`.slice(0, 32), type: StationType.INTERNAL, kind: "RAW_QC" }, select: { id: true } });
  const mk = (code: string, stationId: string, extra: Record<string, unknown> = {}) => prisma.machine.create({ data: { stationId, name: code, code: code.slice(0, 32), isActive: true, warpBeamSlots: 2, ...extra }, select: { id: true, code: true } });
  const loom1 = await mk(`${TAG}-L1`, stLoom.id);
  const loom2 = await mk(`${TAG}-L2`, stLoom.id);
  const loom3 = await mk(`${TAG}-L3`, stLoom.id);
  const loomBos = await mk(`${TAG}-L0`, stLoom.id);
  const muayene = await mk(`${TAG}-Q1`, stQc.id);
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500, takeUpPct: 20 }, select: { id: true, code: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const fabric2 = await prisma.item.create({ data: { code: `${TAG}-KM2`, name: `${TAG} kumaş 2`, itemType: "FABRIC" }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const wo = (n: string, extra: Record<string, unknown> = {}) => prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO-${n}`, itemId: fabric.id, executionKind: WeavingExecutionKind.IN_HOUSE, ...extra }, select: { id: true } });
  const woA = await wo("A", { status: WeavingOrderStatus.IN_PROGRESS, warpSpecId: spec.id });
  const woB = await wo("B");
  const woN = await wo("N");
  const woC = await wo("C", { status: WeavingOrderStatus.CANCELLED, cancelledAt: new Date() });
  const woF = await wo("F", { executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: sub.id });
  const woIds = [woA.id, woB.id, woN.id, woC.id, woF.id];
  const loomIds = [loom1.id, loom2.id, loom3.id, loomBos.id, muayene.id];
  const run1 = await prisma.machineRun.create({ data: { machineId: loom1.id, productionLineNo: 1, startedAt: new Date(), weavingOrderId: woA.id, itemId: fabric.id }, select: { id: true } });
  const run2 = await prisma.machineRun.create({ data: { machineId: loom2.id, productionLineNo: 1, startedAt: new Date(), weavingOrderId: woB.id, itemId: fabric.id }, select: { id: true } });
  await prisma.machineRun.create({ data: { machineId: loom3.id, productionLineNo: 1, startedAt: new Date(), weavingOrderId: woB.id, itemId: fabric.id }, select: { id: true } });
  const inventory = new InventoryService();
  const rollIds: string[] = [];
  const beamIds: string[] = [];
  const sar = async (m: number) => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const dogur = async (kk1Birth: Kk1BirthInput, extra: { itemId?: string; initialQty?: number; clientToken?: string } = {}): Promise<Sonuc> => {
    const r = (await inventory.createInitialEntry({ itemId: extra.itemId ?? fabric.id, initialQty: extra.initialQty ?? 100, clientToken: extra.clientToken }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, kk1Birth })) as unknown as Sonuc;
    if (!rollIds.includes(r.data.id)) rollIds.push(r.data.id);
    return r;
  };
  const sayilar = async () => ({ roll: await prisma.roll.count({ where: { itemId: { in: [fabric.id, fabric2.id] } } }), doff: await prisma.doffEvent.count({ where: { machineId: { in: loomIds } } }) });
  const doffRow = (id: string) => prisma.doffEvent.findUniqueOrThrow({ where: { id }, select: { code: true, pieceCount: true, counterAtDoff: true, counterSource: true, machineRunId: true, machineId: true, productionLineNo: true, doffedAt: true, notes: true, clientToken: true, revokedAt: true } });
  const rollRow = (id: string) => prisma.roll.findUniqueOrThrow({ where: { id }, select: { doffEventId: true, weavingOrderId: true, entrySource: true, clientToken: true } });

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
    await setFlag(SETTING_KEYS.DEVERE_AUTO_CONSUME, true);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DOKUMA_ROLL_BIRTH } });
    const b1 = await sar(1000);
    await mountBeam(b1, { machineId: loom1.id, position: 1 });

    console.log("\n── §1 Varsayılan TABLET_DOFF = bugünkü yol ──");
    const g1 = await bekle(assertKk1BirthGate(null));
    check("§1a ⭐ ayar satırı YOK (TABLET_DOFF) + machineCode → 400 ROLL_BIRTH_MODE {mode}", !g1.ok && kod(g1.e) === "ROLL_BIRTH_MODE" && (g1.e as AppError).statusCode === 400 && (g1.e as AppError).details?.mode === "TABLET_DOFF", kod(g1.e));
    const g1b = await bekle(assertKk1BirthGate(woA.id));
    check("§1b TABLET_DOFF + weavingOrderId → 400 ROLL_BIRTH_MODE", !g1b.ok && kod(g1b.e) === "ROLL_BIRTH_MODE");
    const r1 = (await inventory.createInitialEntry({ itemId: fabric.id, initialQty: 10 }, undefined, null, false, {})) as unknown as Sonuc;
    rollIds.push(r1.data.id);
    check("§1c ⭐ alansız gövde: yanıt anahtarları eski ile aynı (success·data·message), `warnings`/`doffEvent` YOK", JSON.stringify(Object.keys(r1).sort()) === JSON.stringify(["data", "message", "success"]) && !("doffEvent" in r1.data), JSON.stringify(Object.keys(r1)));
    await setFlag(SETTING_KEYS.DOKUMA_ROLL_BIRTH, "KK1_LABEL_OR_ORDER");
    check("§1d KK1_LABEL_OR_ORDER: kapı iki yolu da geçirir", (await bekle(assertKk1BirthGate(null))).ok && (await bekle(assertKk1BirthGate(woA.id))).ok);

    console.log("\n── §2 B yolu: etiket → doff → top → CONSUMED ──");
    const t0 = await dbNow();
    const r2 = await dogur({ machineCode: loom1.code });
    const t1 = await dbNow();
    const d2 = r2.data.doffEvent ? await doffRow(r2.data.doffEvent.id) : null;
    const rr2 = await rollRow(r2.data.id);
    check("§2a ⭐ yanıt `data.doffEvent {id, code DF…}` + success; top WEAVING, `doffEventId` dolu, `weavingOrderId` NULL", r2.success && !!r2.data.doffEvent && /^DF/.test(r2.data.doffEvent.code) && rr2.doffEventId === r2.data.doffEvent.id && rr2.weavingOrderId === null && rr2.entrySource === "WEAVING", JSON.stringify(r2.data.doffEvent));
    check("§2b ⭐ doff satırı: pieceCount 1 · counterAtDoff NULL · OPERATOR · machineRunId = açık koşum · hat 1 · not 'KK1 doğuşu (etiket)' · clientToken NULL", d2?.pieceCount === 1 && d2.counterAtDoff === null && d2.counterSource === MachineDataSource.OPERATOR && d2.machineRunId === run1.id && d2.machineId === loom1.id && d2.productionLineNo === 1 && d2.notes === KK1_DOFF_NOTE_LABEL && d2.clientToken === null && d2.revokedAt === null, JSON.stringify(d2));
    const c2 = await consumedOf(r2.data.id);
    check("§2c ⭐ autoConsume açık → bağlı leventten CONSUMED(rollId): 100 m kumaş, take-up %20 → 125 m", c2.length === 1 && c2[0]!.beamId === b1 && c2[0]!.lengthM?.equals(125) === true, JSON.stringify(c2));
    check("§2d ⭐ doffedAt DB saatinden (çağrı penceresi ±2 sn)", !!d2 && d2.doffedAt.getTime() >= t0.getTime() - 2000 && d2.doffedAt.getTime() <= t1.getTime() + 2000, `${d2?.doffedAt.toISOString()} ∈ [${t0.toISOString()}, ${t1.toISOString()}]`);
    check("§2e işsiz koşum/kumaş uyuşmazlığı yok → `warnings` anahtarı YOK", !("warnings" in r2), JSON.stringify(r2.warnings));
    const r2m = await dogur({ machineCode: loom1.code }, { itemId: fabric2.id });
    check("§2f D17: topun kumaşı koşumun kumaşından farklı → RED DEĞİL, uyarı; top doğdu", r2m.success && (r2m.warnings ?? []).some((w) => /kumaşı koşumun\/işin kumaşından farklı/.test(w)), JSON.stringify(r2m.warnings));

    console.log("\n── §3 Koşumsuz 409 · tezgah değil 400 · yok 404 ──");
    const s3 = await sayilar();
    const e3 = await bekle(dogur({ machineCode: loomBos.code }));
    const s3b = await sayilar();
    check("§3a ⭐ açık koşum yok → 409 MACHINE_NO_OPEN_RUN {machineCode}, top ve doff sayıları SABİT (D16)", !e3.ok && kod(e3.e) === "MACHINE_NO_OPEN_RUN" && (e3.e as AppError).statusCode === 409 && (e3.e as AppError).details?.machineCode === loomBos.code && s3.roll === s3b.roll && s3.doff === s3b.doff, `${kod(e3.e)} roll ${s3.roll}→${s3b.roll} doff ${s3.doff}→${s3b.doff}`);
    const e3b = await bekle(dogur({ machineCode: muayene.code }));
    check("§3b tezgah değil (istasyon RAW_QC) → 400 MACHINE_NOT_LOOM", !e3b.ok && kod(e3b.e) === "MACHINE_NOT_LOOM" && (e3b.e as AppError).statusCode === 400, kod(e3b.e));
    const e3c = await bekle(dogur({ machineCode: `${TAG}-YOK` }));
    check("§3c bilinmeyen etiket → 404 MACHINE_NOT_FOUND", !e3c.ok && kod(e3c.e) === "MACHINE_NOT_FOUND", kod(e3c.e));
    const e3d = await bekle(dogur({ machineCode: loom1.code, productionLineNo: 2 }));
    check("§3d hat aralık dışı (tek hatlı tezgahta hat 2) → 400 PRODUCTION_LINE_OUT_OF_RANGE", !e3d.ok && kod(e3d.e) === "PRODUCTION_LINE_OUT_OF_RANGE", kod(e3d.e));
    check("§3e ret yollarında sayılar sabit", JSON.stringify(await sayilar()) === JSON.stringify(s3));

    console.log("\n── §4 A yolu: iş emri ──");
    const r4 = await dogur({ weavingOrderId: woA.id });
    const d4 = r4.data.doffEvent ? await doffRow(r4.data.doffEvent.id) : null;
    const rr4 = await rollRow(r4.data.id);
    check("§4a ⭐ tek tezgahta koşan iş → tezgah çözüldü, doff doğdu (koşum run1, not 'KK1 doğuşu (iş emri)'), kolon NULL", !!d4 && d4.machineRunId === run1.id && d4.notes === KK1_DOFF_NOTE_ORDER && rr4.weavingOrderId === null && rr4.doffEventId === r4.data.doffEvent!.id, JSON.stringify(d4));
    const s4 = await sayilar();
    const r4b = await dogur({ weavingOrderId: woB.id });
    const rr4b = await rollRow(r4b.data.id);
    check("§4b ⭐ iki tezgahta koşan iş → doff YOK, `Roll.weavingOrderId` dolu, CONSUMED yok, uyarı 'N tezgahta koşuyor'", !r4b.data.doffEvent && rr4b.doffEventId === null && rr4b.weavingOrderId === woB.id && (await consumedOf(r4b.data.id)).length === 0 && (r4b.warnings ?? []).some((w) => /2 tezgahta koşuyor/.test(w)) && (await sayilar()).doff === s4.doff, JSON.stringify(r4b.warnings));
    const r4c = await dogur({ machineCode: loom2.code });
    check("§4c `rollsOfWeavingOrderWhere(woB)` doff yoluyla (L2) ve kolon yoluyla doğan İKİ topu sayar; `weavingOrderOfRoll` via ORDER", (await prisma.roll.count({ where: rollsOfWeavingOrderWhere(woB.id) })) === 2 && (await weavingOrderOfRoll(prisma, r4b.data.id))?.via === "ORDER" && (await weavingOrderOfRoll(prisma, r4c.data.id))?.via === "DOFF");
    const e4 = await bekle(dogur({ weavingOrderId: woN.id }));
    check("§4d hiçbir tezgahta koşmayan iş → 409 WEAVING_ORDER_NO_OPEN_RUN", !e4.ok && kod(e4.e) === "WEAVING_ORDER_NO_OPEN_RUN", kod(e4.e));
    const e4b = await bekle(dogur({ weavingOrderId: woC.id }));
    check("§4e iptal iş → 409 WEAVING_ORDER_NOT_OPEN", !e4b.ok && kod(e4b.e) === "WEAVING_ORDER_NOT_OPEN", kod(e4b.e));
    const e4c = await bekle(dogur({ weavingOrderId: woF.id }));
    check("§4f fason iş → 400 WEAVING_ORDER_SUBCONTRACTED", !e4c.ok && kod(e4c.e) === "WEAVING_ORDER_SUBCONTRACTED", kod(e4c.e));
    const e4d = await bekle(dogur({ weavingOrderId: uuid() }));
    check("§4g bilinmeyen iş → 404 WEAVING_ORDER_NOT_FOUND", !e4d.ok && kod(e4d.e) === "WEAVING_ORDER_NOT_FOUND", kod(e4d.e));

    console.log("\n── §5 KK1_LABEL_ONLY ──");
    await setFlag(SETTING_KEYS.DOKUMA_ROLL_BIRTH, "KK1_LABEL_ONLY");
    const g5 = await bekle(assertKk1BirthGate(woA.id));
    check("§5a ⭐ KK1_LABEL_ONLY + weavingOrderId → 400 ROLL_BIRTH_MODE {mode KK1_LABEL_ONLY}", !g5.ok && kod(g5.e) === "ROLL_BIRTH_MODE" && (g5.e as AppError).details?.mode === "KK1_LABEL_ONLY", kod(g5.e));
    check("§5b KK1_LABEL_ONLY + machineCode → kapı geçer", (await bekle(assertKk1BirthGate(null))).ok);
    await setFlag(SETTING_KEYS.DOKUMA_ROLL_BIRTH, "KK1_LABEL_OR_ORDER");

    console.log(`\n── §6 Levent beyanı (warpBeamId) — pencere ${KK1_BEAM_CHANGE_WINDOW_HOURS} sa ──`);
    const b2 = await sar(500);
    await mountBeam(b2, { machineId: loom1.id, position: 2 });
    await dismountBeam(b2, {});
    const r6 = await dogur({ machineCode: loom1.code, warpBeamId: b2 }, { initialQty: 80 });
    const c6 = await consumedOf(r6.data.id);
    check("§6a ⭐ pencere içinde sökülen levent beyanı → tüketim BEYAN EDİLEN leventten (b2, 100 m), bağlı b1'den DEĞİL", c6.length === 1 && c6[0]!.beamId === b2 && c6[0]!.lengthM?.equals(100) === true, JSON.stringify(c6));
    // Açık koşumlu tezgahta son levent sökülemez (WARP_DISMOUNT_OPEN_RUN) → b3 takılı kalır, takma olayı 13 sa yaşlandırılır.
    const b3 = await sar(500);
    await mountBeam(b3, { machineId: loom2.id, position: 1 });
    await prisma.$executeRaw`UPDATE warp_beam_events SET "createdAt" = "createdAt" - interval '13 hours' WHERE "beamId" = ${b3}::uuid AND kind IN ('MOUNTED','DISMOUNTED') -- tz-ok: fikstür yaşlandırma`;
    const s6 = await sayilar();
    const e6 = await bekle(dogur({ machineCode: loom2.code, warpBeamId: b3 }));
    check("§6b ⭐ pencere dışı (13 sa önce takılmış, o gün değişim yok) levent beyanı → 400 WARP_BEAM_NOT_RECENT, top ve doff DOĞMADI", !e6.ok && kod(e6.e) === "WARP_BEAM_NOT_RECENT" && JSON.stringify(await sayilar()) === JSON.stringify(s6), kod(e6.e));
    const e6b = await bekle(dogur({ machineCode: loom2.code, warpBeamId: uuid() }));
    check("§6c bilinmeyen levent → 404 WARP_BEAM_NOT_FOUND", !e6b.ok && kod(e6b.e) === "WARP_BEAM_NOT_FOUND", kod(e6b.e));

    console.log("\n── §7 Replay (clientToken) ──");
    const tok = uuid();
    const r7 = await dogur({ machineCode: loom1.code }, { clientToken: tok });
    const d7 = await prisma.doffEvent.count({ where: { machineId: loom1.id } });
    const r7b = await dogur({ machineCode: loom1.code }, { clientToken: tok });
    check("§7a ⭐ aynı token + aynı machineCode → aynı top, aynı doffEvent, ikinci doff YOK, idempotent", r7b.data.id === r7.data.id && r7b.data.doffEvent?.id === r7.data.doffEvent?.id && (await prisma.doffEvent.count({ where: { machineId: loom1.id } })) === d7 && r7b.idempotent === true, JSON.stringify({ a: r7.data.doffEvent, b: r7b.data.doffEvent, idem: r7b.idempotent }));
    const e7 = await bekle(dogur({ machineCode: loom2.code }, { clientToken: tok }));
    check("§7b aynı token + farklı machineCode → 409 CLIENT_TOKEN_COLLISION", !e7.ok && kod(e7.e) === "CLIENT_TOKEN_COLLISION", kod(e7.e));
    const tok2 = uuid();
    const r7c = await dogur({ weavingOrderId: woA.id }, { clientToken: tok2 });
    const r7d = await dogur({ weavingOrderId: woA.id }, { clientToken: tok2 });
    check("§7c A yolu tek koşum (kolon NULL): replay kimliği işi koşumdan okur → idempotent", r7d.data.id === r7c.data.id && r7d.idempotent === true);
    const e7b = await bekle(dogur({ weavingOrderId: woB.id }, { clientToken: tok2 }));
    check("§7d aynı token + farklı weavingOrderId → 409 CLIENT_TOKEN_COLLISION", !e7b.ok && kod(e7b.e) === "CLIENT_TOKEN_COLLISION", kod(e7b.e));

    console.log("\n── §8 CHECK rolls_weaving_order_xor_ck ──");
    const e8 = await bekle(prisma.$executeRaw`UPDATE rolls SET "weavingOrderId" = ${woA.id}::uuid WHERE id = ${r2.data.id}::uuid`);
    const m8 = e8.ok ? "" : String((e8.e as { meta?: { code?: string } }).meta?.code ?? "") + " " + String((e8.e as Error).message ?? "").replace(/\s+/g, " ");
    check("§8a ⭐ doff'lu topa weavingOrderId yazmak DB'de düşer (23514 rolls_weaving_order_xor_ck)", !e8.ok && /23514|rolls_weaving_order_xor_ck/.test(m8), m8.slice(0, 160));
    check("§8b kolon dokunulmadı", (await rollRow(r2.data.id)).weavingOrderId === null);

    console.log("\n── §9 Dokuma kapalı ──");
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, false);
    const g9 = await bekle(assertKk1BirthGate(null));
    check("§9a ⭐ dokuma kapalı + machineCode → 403 MODULE_DISABLED {modul dokuma} (mod sorgusundan ÖNCE)", !g9.ok && kod(g9.e) === "MODULE_DISABLED" && (g9.e as AppError).statusCode === 403 && (g9.e as AppError).details?.modul === "dokuma", kod(g9.e));
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);

    console.log("\n── §10 kk1-context ön-dolgu ──");
    const ctx = await readKk1Context(loom1.code);
    check("§10a ⭐ 200: machine · run (koşum run1 · iş woA · kumaş · çözgü kartı) · rollBirth", ctx.machine.id === loom1.id && ctx.machine.productionLineCount === 1 && ctx.run.id === run1.id && ctx.run.productionLineNo === 1 && ctx.run.weavingOrder?.id === woA.id && ctx.run.item?.id === fabric.id && ctx.run.warpSpec?.id === spec.id && ctx.run.warpSpec.takeUpPct?.equals(20) === true && ctx.rollBirth === "KK1_LABEL_OR_ORDER", JSON.stringify({ run: ctx.run.id, wo: ctx.run.weavingOrder, spec: ctx.run.warpSpec?.code, rb: ctx.rollBirth }));
    check("§10b takılı leventler: b1 (yuva 1, kalan 1000−125−… = defterden) · son değişim b2 söküm", ctx.beams.mounted.length === 1 && ctx.beams.mounted[0]!.id === b1 && ctx.beams.mounted[0]!.position === 1 && ctx.beams.mounted[0]!.remainingM.lt(1000) && ctx.beams.recentChange?.dismounted?.id === b2 && ctx.beams.recentChange.mounted?.id === b2, JSON.stringify(ctx.beams));
    const e10 = await bekle(readKk1Context(loomBos.code));
    check("§10c koşumsuz tezgah → 409 MACHINE_NO_OPEN_RUN (doğuşla aynı kod)", !e10.ok && kod(e10.e) === "MACHINE_NO_OPEN_RUN", kod(e10.e));
    const e10b = await bekle(readKk1Context(muayene.code));
    const e10c = await bekle(readKk1Context(`${TAG}-YOK`));
    const e10d = await bekle(readKk1Context(loom1.code, 2));
    check("§10d tezgah değil → 400 MACHINE_NOT_LOOM · bilinmeyen → 404 MACHINE_NOT_FOUND · hat 2 → 400 PRODUCTION_LINE_OUT_OF_RANGE", !e10b.ok && kod(e10b.e) === "MACHINE_NOT_LOOM" && !e10c.ok && kod(e10c.e) === "MACHINE_NOT_FOUND" && !e10d.ok && kod(e10d.e) === "PRODUCTION_LINE_OUT_OF_RANGE", `${kod(e10b.e)} · ${kod(e10c.e)} · ${kod(e10d.e)}`);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, false);
    const ctxD = await readKk1Context(loom1.code);
    check("§10e devere kapalı → beams boş, recentChange null; koşum yine dolu", ctxD.beams.mounted.length === 0 && ctxD.beams.recentChange === null && ctxD.run.id === run1.id);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    const ctxB = await readKk1Context(loom3.code);
    check("§10f çok tezgahlı işin tezgahından: iş woB, kumaş koşumdan, çözgü kartı yok (iş/kumaşta yok) → null", ctxB.run.weavingOrder?.id === woB.id && ctxB.run.item?.id === fabric.id && ctxB.run.warpSpec === null);
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { OR: [{ id: { in: rollIds } }, { itemId: { in: [fabric.id, fabric2.id] } }] } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: loomIds } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: loomIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: spec.id } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, fabric.id, fabric2.id] } } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: { in: loomIds } } });
    await prisma.station.deleteMany({ where: { id: { in: [stLoom.id, stQc.id] } } });
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
