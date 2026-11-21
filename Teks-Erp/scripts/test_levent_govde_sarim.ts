// =============================================================================
// LEVENT GÖVDESİ ↔ SARIM BAĞI — devere ek B3 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §0 sabit ↔ CHECK: `BEAM_BODY_WARP_KINDS` (+_CANCEL) = `beam_body_events_warp_ck` · dolu durumlar = `beam_bodies_current_warp_ck`
//   §1 OFF: gövdesiz kabul bayt-aynı (beamBodyId NULL, gövde olayı yok) · gövdeli satır 403 BEAM_BODY_MODE_OFF
//   §2 REQUIRED: gövdesiz satır 400 BEAM_BODY_REQUIRED
//   §3 deverecideki gövde okutulur → sarım beamBodyId + physicalBeamNo = gövde no · gövde FULL_STOCK, üstündeki sarım, FILLED
//   §4 depoda boş gövde + yerinde tanım (newBody) aynı kabulde · önizleme gövdeyi gösterir, yazmaz
//   §5 dolu gövde 409 BEAM_BODY_BUSY · aynı kabulde iki kez 400 · gövde no uyuşmazlığı 400
//   §6 müşteri gövdesi → sarım emanet sahipliğini kalıtır
//   §7 takma: uyumsuz tezgâh WARN → uyarı + MOUNTED · BLOCK → 409 BEAM_BODY_MACHINE_MISFIT (sarım takılmaz)
//   §8 söküm → DISMOUNTED (FULL_STOCK) · söküm geri al → gövde tezgâhta
//   §9 bitiş → EMPTIED (EMPTY_STOCK, sarım boş) · müşteri gövdesi sahibine iade adayı · §10 bitiş iptali → gövde geri tezgâhta
//   §11 kabul stornosu → FILLED_CANCEL: gövdeler önceki durum/yerine, ters satır sarımı taşır
// NEGATİF SONDA: §11 — `WARP_EVENT_BODY_RULES.WOUND_CANCEL` satırı çıkarılınca §11a kırmızı (2026-11-21).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, StationType, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { previewWarpingReceive, receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { createBeamBody, type BeamBodyOwnerInput } from "../src/services/beam-body/write";
import { getBeamBody } from "../src/services/beam-body/read";
import { applyBeamBodyTransition } from "../src/services/beam-body/transition";
import { cancelStatusEvent, dismountBeam, mountBeam } from "../src/services/warp-beam-mount.service";
import { exhaustBeam } from "../src/services/warp-beam-consume.service";
import { BEAM_BODY_FULL_STATUSES, BEAM_BODY_WARP_KINDS, BEAM_BODY_WARP_OPTIONAL_KINDS } from "../src/constants/beam-body";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LGS${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, SETTING_KEYS.DEVERE_MOUNT_TRACKING,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const checkDef = async (name: string) =>
  ((await prisma.$queryRaw<Array<{ def: string }>>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`)[0]?.def ?? "");

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== LEVENT GÖVDESİ ↔ SARIM BAĞI (devere ek B3) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const customerIds: string[] = [];
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const stationIds: string[] = [];
  const machineIds: string[] = [];
  let n = 0;
  const body = async (owner: BeamBodyOwnerInput = { kind: "OURS" }, fits: string[] = []) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${++n}`, owner, warehouseId: W, machineIds: fits }, U)).data;
  const st = (id: string) => getBeamBody(id);
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "WARN");
    await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, "true");

    const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    yarnIds.push(yarn.id);
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L` }, select: { id: true } });
    lotIds.push(lot.id);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id, reason: `${TAG} giriş` }));
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn.id, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } });
    specIds.push(spec.id);
    const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
    stationIds.push(stLoom.id);
    const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
    const loom2 = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T2`, code: `${TAG}-T2`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
    machineIds.push(loom.id, loom2.id);
    const c1 = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} MUSTERI 1` }, select: { id: true } });
    const c2 = await prisma.customer.create({ data: { code: `${TAG}-C2`, name: `${TAG} FIRMA 2` }, select: { id: true } });
    customerIds.push(c1.id, c2.id);

    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 2, beamLengthM: 100 }] }, U);
      orderIds.push(r.data.id);
      await dispatchWarpingOrder(r.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn.id, warehouseId: W, lotId: lot.id, qtyKg: 20 }] }, U);
      return r.data.id;
    };
    const receive = (orderId: string, beams: WarpingReceiveBeamInput[]) => receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-DV`, beams }, U);
    const beamsOf = (receiptKey: string) => prisma.warpBeam.findMany({ where: { warpingReceiptKey: receiptKey }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true, beamBodyId: true, physicalBeamNo: true, ownerCustomerId: true } });
    const bodyEvents = (bodyId: string) => prisma.beamBodyEvent.findMany({ where: { bodyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, warpBeamId: true, toStatus: true } });
    const L = (extra: Partial<WarpingReceiveBeamInput> = {}): WarpingReceiveBeamInput => ({ lengthM: 100, ...extra });

    // ── §0 sabit ↔ CHECK ──────────────────────────────────────────────────
    const warpDef = await checkDef("beam_body_events_warp_ck");
    const warpKinds = [...BEAM_BODY_WARP_KINDS.flatMap((k) => [k, `${k}_CANCEL`])];
    const inDef = [...warpDef.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    check("§0a BEAM_BODY_WARP_KINDS (+_CANCEL) = beam_body_events_warp_ck (iki yönlü)", inDef.length === warpKinds.length && warpKinds.every((k) => inDef.includes(k)), `${inDef.length}/${warpKinds.length}`);
    const allowDef = await checkDef("beam_body_events_warp_allowed_ck");
    const allowKinds = [...warpKinds, ...BEAM_BODY_WARP_OPTIONAL_KINDS.flatMap((k) => [k, `${k}_CANCEL`])];
    const allowIn = [...allowDef.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    check("§0a2 WARP_KINDS ∪ WARP_OPTIONAL_KINDS (+_CANCEL) = beam_body_events_warp_allowed_ck (iki yönlü)", allowIn.length === allowKinds.length && allowKinds.every((k) => allowIn.includes(k)), `${allowIn.length}/${allowKinds.length}`);
    const curDef = await checkDef("beam_bodies_current_warp_ck");
    const curIn = [...curDef.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
    check("§0b BEAM_BODY_FULL_STATUSES = beam_bodies_current_warp_ck", curIn.length === BEAM_BODY_FULL_STATUSES.length && BEAM_BODY_FULL_STATUSES.every((s) => curIn.includes(s)), curDef);

    // ── §1 OFF ────────────────────────────────────────────────────────────
    const A = await body({ kind: "OURS" }, [loom2.id]);
    await applyBeamBodyTransition(A.id, { kind: "SHIP_EMPTY", subcontractorId: sub.id }, U);
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const o1 = await newOrder();
    const evBefore = await prisma.beamBodyEvent.count();
    const plain = await receive(o1, [L({ physicalBeamNo: `${TAG}-P1` })]);
    const plainBeams = await beamsOf(plain.receiptKey);
    check("§1a OFF: gövdesiz kabul açılır · beamBodyId NULL · gövde olayı yazılmaz (bayt-aynı)", plainBeams.length === 1 && plainBeams[0]!.beamBodyId === null && plainBeams[0]!.physicalBeamNo === `${TAG}-P1` && (await prisma.beamBodyEvent.count()) === evBefore);
    const off = await errOf(() => receive(o1, [L({ beamBodyId: A.id })]));
    check("§1b OFF: gövdeli satır → 403 BEAM_BODY_MODE_OFF", off?.status === 403 && off.code === "BEAM_BODY_MODE_OFF", show(off));

    // ── §2 REQUIRED ───────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "REQUIRED");
    const req = await errOf(() => receive(o1, [L({ beamBodyId: A.id }), L()]));
    check("§2 REQUIRED: gövdesiz satır → 400 BEAM_BODY_REQUIRED", req?.status === 400 && req.code === "BEAM_BODY_REQUIRED", show(req));
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");

    // ── §3 deverecideki gövde ─────────────────────────────────────────────
    const o2 = await newOrder();
    const r2 = await receive(o2, [L({ beamBodyId: A.id })]);
    const [beamA] = await beamsOf(r2.receiptKey);
    let a = await st(A.id);
    const aEv = await bodyEvents(A.id);
    check("§3a sarım gövdeye bağlı · physicalBeamNo = gövde no", beamA?.beamBodyId === A.id && beamA.physicalBeamNo === A.bodyNo, JSON.stringify(beamA));
    check("§3b gövde FULL_STOCK · üstündeki sarım · yer boş", a.status === BeamBodyStatus.FULL_STOCK && a.currentWarpBeam?.id === beamA?.id && a.place.subcontractor === null, `${a.status} ${a.currentWarpBeam?.beamNo}`);
    check("§3c son olay FILLED (sarımı taşır)", aEv.at(-1)?.kind === "FILLED" && aEv.at(-1)?.warpBeamId === beamA?.id, aEv.map((e) => e.kind).join(","));

    // ── §4 depoda boş + yerinde tanım ────────────────────────────────────
    const B = await body({ kind: "OURS" }, [loom2.id]);
    const o3 = await newOrder();
    const newNo = `${TAG}-NEW`;
    const evB = await prisma.beamBodyEvent.count();
    const pv = await previewWarpingReceive(o3, { beams: [L({ beamBodyId: B.id }), L({ physicalBeamNo: newNo, newBody: { owner: { kind: "OTHER", customerId: c2.id }, tareKg: 40 }, grossKg: 50 })] });
    check("§4a önizleme gövdeyi gösterir (kayıtlı + yeni), YAZMAZ", pv.beams[0]?.body?.beamBodyId === B.id && pv.beams[1]?.body?.isNew === true && pv.beams[1]?.body?.bodyNo === newNo && (await prisma.beamBodyEvent.count()) === evB);
    check("§4b darasız tartıda gövde darası bilgi uyarısı", pv.warnings.some((w) => w.includes("gövde darası")), pv.warnings.join(" | "));
    const r3 = await receive(o3, [L({ beamBodyId: B.id }), L({ physicalBeamNo: newNo, newBody: { owner: { kind: "OTHER", customerId: c2.id }, tareKg: 40 } })]);
    const beams3 = await beamsOf(r3.receiptKey);
    const N = await prisma.beamBody.findUnique({ where: { bodyNo: newNo }, select: { id: true, status: true, ownerCustomerId: true, currentWarpBeamId: true } });
    const nEv = N ? await bodyEvents(N.id) : [];
    const b = await st(B.id);
    check("§4c depoda boş gövde de dolar (EMPTY_STOCK → FULL_STOCK)", b.status === BeamBodyStatus.FULL_STOCK && beams3.some((x) => x.beamBodyId === B.id));
    check("§4d yerinde tanım: REGISTER (Deverecide) + FILLED · sahip başka firma · sarım bağlı", !!N && N.ownerCustomerId === c2.id && N.status === BeamBodyStatus.FULL_STOCK && nEv.map((e) => e.kind).join(",") === "REGISTER,FILLED" && nEv[0]?.toStatus === BeamBodyStatus.AT_SUBCONTRACTOR && beams3.some((x) => x.beamBodyId === N.id && x.id === N.currentWarpBeamId), nEv.map((e) => e.kind).join(","));
    check("§4e başka firma gövdesi sarıma sahip VERMEZ", beams3.every((x) => x.ownerCustomerId === null));

    // ── §5 engeller ───────────────────────────────────────────────────────
    const o4 = await newOrder();
    const busy = await errOf(() => receive(o4, [L({ beamBodyId: A.id })]));
    check("§5a dolu gövde → 409 BEAM_BODY_BUSY", busy?.status === 409 && busy.code === "BEAM_BODY_BUSY", show(busy));
    const C = await body({ kind: "CUSTOMER", customerId: c1.id });
    const dup = await errOf(() => receive(o4, [L({ beamBodyId: C.id }), L({ beamBodyId: C.id })]));
    check("§5b aynı gövde iki satırda → 400 WARPING_RECEIVE_DUPLICATE_BODY", dup?.status === 400 && dup.code === "WARPING_RECEIVE_DUPLICATE_BODY", show(dup));
    const mis = await errOf(() => receive(o4, [L({ beamBodyId: C.id, physicalBeamNo: "BASKA-NO" })]));
    check("§5c gövde no uyuşmazlığı → 400 BEAM_BODY_PHYSICAL_MISMATCH", mis?.status === 400 && mis.code === "BEAM_BODY_PHYSICAL_MISMATCH", show(mis));

    // ── §6 müşteri gövdesi → emanet kalıtımı ─────────────────────────────
    const r4 = await receive(o4, [L({ beamBodyId: C.id })]);
    const [beamC] = await beamsOf(r4.receiptKey);
    check("§6 müşteri gövdesindeki sarım emanet sahibini kalıtır", beamC?.ownerCustomerId === c1.id, String(beamC?.ownerCustomerId));

    // ── §7 takma + uyum ──────────────────────────────────────────────────
    const m1 = await mountBeam(beamA!.id, { machineId: loom.id, position: 1 }, U);
    a = await st(A.id);
    check("§7a WARN: uyumsuz tezgâh uyarı verir, takılır · gövde MOUNTED + tezgâh", (m1.warnings ?? []).some((w) => w.includes("uyumlu tezgâh")) && a.status === BeamBodyStatus.MOUNTED && a.place.machine?.id === loom.id, `${a.status} ${JSON.stringify(m1.warnings)}`);
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "BLOCK");
    const beamB = beams3.find((x) => x.beamBodyId === B.id)!;
    const blk = await errOf(() => mountBeam(beamB.id, { machineId: loom.id, position: 2 }, U));
    const bAfter = await st(B.id);
    const beamBRow = await prisma.warpBeam.findUnique({ where: { id: beamB.id }, select: { status: true } });
    check("§7b BLOCK: uyumsuz tezgâh → 409 BEAM_BODY_MACHINE_MISFIT · sarım READY · gövde FULL_STOCK", blk?.status === 409 && blk.code === "BEAM_BODY_MACHINE_MISFIT" && beamBRow?.status === "READY" && bAfter.status === BeamBodyStatus.FULL_STOCK, show(blk));
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MACHINE_FIT, "WARN");

    // ── §8 söküm + geri al ───────────────────────────────────────────────
    await dismountBeam(beamA!.id, {}, U);
    a = await st(A.id);
    check("§8a söküm → gövde FULL_STOCK (DISMOUNTED), tezgâh boş", a.status === BeamBodyStatus.FULL_STOCK && a.place.machine === null && (await bodyEvents(A.id)).at(-1)?.kind === "DISMOUNTED");
    const dis = await prisma.warpBeamEvent.findFirst({ where: { beamId: beamA!.id, kind: "DISMOUNTED" }, select: { id: true } });
    await cancelStatusEvent(beamA!.id, dis!.id, `${TAG} söküm yanlış`, U);
    a = await st(A.id);
    check("§8b söküm geri al → gövde MOUNTED + aynı tezgâh (DISMOUNTED_CANCEL)", a.status === BeamBodyStatus.MOUNTED && a.place.machine?.id === loom.id && (await bodyEvents(A.id)).at(-1)?.kind === "DISMOUNTED_CANCEL");

    // ── §9 bitiş ─────────────────────────────────────────────────────────
    await exhaustBeam(beamA!.id, {}, U);
    a = await st(A.id);
    check("§9a bitiş → gövde EMPTY_STOCK · üstündeki sarım yok · EMPTIED", a.status === BeamBodyStatus.EMPTY_STOCK && a.currentWarpBeam === null && a.place.machine === null && (await bodyEvents(A.id)).at(-1)?.kind === "EMPTIED");
    await exhaustBeam(beamC!.id, {}, U);
    const c = await st(C.id);
    check("§9b müşteri gövdesi boşalınca sahibine iade adayı", c.status === BeamBodyStatus.EMPTY_STOCK && c.ownerReturnDue, `${c.status} ${c.ownerReturnDue}`);

    // ── §10 bitiş iptali ─────────────────────────────────────────────────
    const ex = await prisma.warpBeamEvent.findFirst({ where: { beamId: beamA!.id, kind: "EXHAUSTED" }, select: { id: true } });
    await cancelStatusEvent(beamA!.id, ex!.id, `${TAG} bitiş yanlış`, U);
    a = await st(A.id);
    check("§10 bitiş iptali → gövde MOUNTED + tezgâh + sarım geri (EMPTIED_CANCEL)", a.status === BeamBodyStatus.MOUNTED && a.place.machine?.id === loom.id && a.currentWarpBeam?.id === beamA!.id);

    // ── §11 kabul stornosu ──────────────────────────────────────────────
    await cancelWarpingReceipt(o3, r3.receiptKey, `${TAG} storno`, U);
    const b2 = await st(B.id);
    const n2 = N ? await st(N.id) : null;
    const bCancel = (await bodyEvents(B.id)).at(-1);
    check("§11a storno → depodaki gövde EMPTY_STOCK + depo W · üstündeki sarım yok", b2.status === BeamBodyStatus.EMPTY_STOCK && b2.place.warehouse?.id === W && b2.currentWarpBeam === null, `${b2.status} ${b2.place.warehouse?.id}`);
    check("§11b yerinde tanımlı gövde Deverecide kalır (kayıt silinmez)", n2?.status === BeamBodyStatus.AT_SUBCONTRACTOR && n2.place.subcontractor?.id === sub.id && n2.isActive);
    check("§11c ters satır FILLED_CANCEL sarımı taşır", bCancel?.kind === "FILLED_CANCEL" && bCancel.warpBeamId === beamB.id);
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { beamBodyId: { in: ids } }] }, select: { id: true } })).map((x) => x.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...ids, ...beamIds] } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    await cleanupTestCustomers(customerIds);
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
