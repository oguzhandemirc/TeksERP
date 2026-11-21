// =============================================================================
// FASON DEVERE — devere ek P: KABUL BELGESİ STORNOSU (E6) · gövde boş dönüşü (FULL_OUT) · denye gövde darası (F6)
// =============================================================================
// Fikstür: kart X 3000 tel × 150 den → 1000 m = 50 kg. A ve B aynı deverecinin siparişleri (300'er kg).
//   §0  tek kaynak: belge stornosu parça çekirdeği `cancelReceiptPartTx` (tek kabul stornosuyla ortak), defter beyanı
//   §1  önizleme her sipariş/leventi listeler, YAZMAZ → storno: bütün sarımlar CANCELLED, WOUND satırları DURUR, WOUND_CANCEL
//       bugüne, tutmalar geri gelir, gövde boşalır (kanca) · ikinci storno 409 NOT_OPEN
//   §2  LIFO bozan (B'de sonradan kabul) → önizleme engeli + 409 WARPING_RECEIPT_LIFO, A'ya da DOKUNULMAZ (hep-ya-hiç)
//   §3  sipariş kısmı stornosu serbest; belge stornosu geri alınmış parçayı atlar
//   §4  reddedilmiş sarım → 409 WARPING_RECEIPT_HAS_REJECTION, hiçbir parça değişmez
//   §5  FULL_OUT gövde "Boş döndü": sebepsiz 400, sebepli EMPTY_STOCK + olay sarımı taşır; geri alma FULL_OUT + sarım
//       geri; sarım taşıyamayan türde DB CHECK reddeder
//   §6  denye raporu: darası boş sarımda gövde darası, `bodyTareBeamCount` etiketiyle; ikisi de yoksa örnek dışı
// NEGATİF SONDA (2026-11-22): ① `cancelReceiptPartTx` LIFO throw'u kaldırılınca §2 KIRMIZI · ② `BEAM_BODY_MANUAL_TRANSITIONS.
// RETURN_EMPTY.from`tan FULL_OUT çıkarılınca §5 KIRMIZI · ③ denye servisinde gövde darası dalı kaldırılınca §6 KIRMIZI.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, WarpBeamStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { listWarpingYarnHoldings } from "../src/services/warping-order/yarn-return";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { createWarpingBeamRejection } from "../src/services/warping-order/beam-rejection";
import { createWarpingReceiveDoc, type WarpingReceiveDocOrderInput } from "../src/services/warping-order/receive-doc";
import { getWarpingReceiveDoc } from "../src/services/warping-order/receive-doc-read";
import { cancelWarpingReceiveDoc, previewCancelWarpingReceiveDoc } from "../src/services/warping-order/receive-doc-cancel";
import { applyBeamBodyTransition, undoBeamBodyEvent } from "../src/services/beam-body/transition";
import { transitionBeamBodyTx } from "../src/services/helpers/beam-body.helper";
import { getDenierDeviationReport } from "../src/services/denier-deviation.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDBS-${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string; code?: string };
    return { status: x.statusCode, code: x.details?.code ?? x.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 160)}` : "hata yok");
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_BEAM_BODY_MODE,
  SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, SETTING_KEYS.DEVERE_RECEIVE_WEIGHING,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE — KABUL BELGESİ STORNOSU · GÖVDE BOŞ DÖNÜŞ · DENYE GÖVDE DARASI (devere ek P) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    // ── §0 tek kaynak ────────────────────────────────────────────────────
    const svc = path.join(__dirname, "../src/services/warping-order");
    const src = (f: string) => fs.readFileSync(path.join(svc, f), "utf8");
    const beyan = fs.readFileSync(path.join(__dirname, "lib/defter-beyan.ts"), "utf8");
    check("§0 belge stornosu parça çekirdeğini çağırır, sarım olayını kendisi yazmaz; tek kabul stornosu aynı çekirdek",
      src("receive-doc-cancel.ts").includes("cancelReceiptPartTx(") && !src("receive-doc-cancel.ts").includes("applyWarpBeamEventTx(") && src("receive-cancel.ts").includes("await cancelReceiptPartTx(tx,"));
    check("§0 defter beyanı: WarpBeamEvent ters mekanizmaları arasında cancelWarpingReceiveDoc", beyan.includes('sembol: "cancelWarpingReceiveDoc"'));

    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "false"], [SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "ALLOW"], [SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "OPTIONAL"]] as const) await setSetting(k, v);
    await reconcileReasonPresets();

    const X = (await prisma.item.create({ data: { code: `${TAG}-X`, name: `${TAG} iplik X`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    yarnIds.push(X);
    const lx = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-XL` }, select: { id: true } })).id;
    lotIds.push(lx);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: X, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 2000, lotId: lx, reason: `${TAG} giriş` }));
    const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} zemin`, yarnItemId: X, endsCount: 3000, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    specIds.push(spec);
    const newOrder = async (kg: number) => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec, beamLines: [{ beamCount: 20, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      await dispatchWarpingOrder(r.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: X, warehouseId: whId, lotId: lx, qtyKg: kg }] }, U);
      return r.data.id;
    };
    const holds = async (orderId: string) => (await listWarpingYarnHoldings(orderId)).reduce((s, h) => s + Number(h.holdingKg), 0);
    const L = (n: number, extra: Partial<WarpingReceiveBeamInput> = {}): WarpingReceiveBeamInput[] => Array.from({ length: n }, () => ({ lengthM: 1000, ...extra }));
    const doc = (orders: WarpingReceiveDocOrderInput[], note: string) => createWarpingReceiveDoc({ clientToken: randomUUID(), deliveryNoteNo: note, orders }, U);
    const docBeams = (docId: string) => prisma.warpBeam.findMany({ where: { warpingReceiveDocId: docId }, select: { id: true, status: true, warpingOrderId: true, warpingReceiptKey: true, beamBodyId: true }, orderBy: { beamNo: "asc" } });
    const statusOf = async (docId: string) => (await docBeams(docId)).map((b) => b.status);

    const A = await newOrder(300);
    const B = await newOrder(300);

    // ── §1 önizleme + storno ─────────────────────────────────────────────
    const d1 = await doc([{ warpingOrderId: A, beams: [{ lengthM: 1000, physicalBeamNo: `${TAG}-G1`, newBody: { owner: { kind: "OURS" } } }, { lengthM: 1000 }] }, { warpingOrderId: B, beams: L(1) }], `${TAG}-I1`);
    const pv1 = await previewCancelWarpingReceiveDoc(d1.data.id);
    check("§1 önizleme: 2 sipariş · 3 levent · 3000 m · her levent satırı · serbest kalacak iplik · engel yok · YAZMAZ",
      pv1.cancellable && pv1.totals.orderCount === 2 && pv1.totals.beamCount === 3 && pv1.totals.lengthM === "3000.000"
      && pv1.orders.reduce((s, o) => s + o.beams.length, 0) === 3 && pv1.orders.every((o) => o.released.length > 0 && o.released.every((r) => r.yarnCode === `${TAG}-X`))
      && (await statusOf(d1.data.id)).every((s) => s === WarpBeamStatus.READY), JSON.stringify(pv1.blockers));
    const body1 = (await docBeams(d1.data.id)).find((b) => b.beamBodyId)?.beamBodyId ?? null;
    const holdBefore = [await holds(A), await holds(B)];
    const r1 = await cancelWarpingReceiveDoc(d1.data.id, `${TAG} yanlış irsaliye`, U);
    const beams1 = await docBeams(d1.data.id);
    const evs1 = await prisma.warpBeamEvent.findMany({ where: { beamId: { in: beams1.map((b) => b.id) } }, select: { kind: true, reason: true } });
    check("§1 storno: 3 sarım CANCELLED · WOUND satırları DURUR (3) · 3 WOUND_CANCEL sebepli · sonuç 2 sipariş",
      beams1.every((b) => b.status === WarpBeamStatus.CANCELLED) && evs1.filter((e) => e.kind === "WOUND").length === 3
      && evs1.filter((e) => e.kind === "WOUND_CANCEL" && e.reason === `${TAG} yanlış irsaliye`).length === 3 && r1.orders.length === 2,
      JSON.stringify(evs1.map((e) => e.kind)));
    check("§1 tutmalar geri geldi (A +100, B +50 kg)", (await holds(A)) === holdBefore[0]! + 100 && (await holds(B)) === holdBefore[1]! + 50, `${holdBefore} → ${await holds(A)},${await holds(B)}`);
    const g1 = body1 ? await prisma.beamBody.findUnique({ where: { id: body1 }, select: { status: true, currentWarpBeamId: true } }) : null;
    check("§1 gövde kancayla boşaldı (FILLED geri alındı)", g1 !== null && g1.currentWarpBeamId === null && g1.status !== BeamBodyStatus.FULL_STOCK, JSON.stringify(g1));
    check("§1 belge okuması: 0 canlı levent", (await getWarpingReceiveDoc(d1.data.id)).totals.liveBeamCount === 0);
    const again = await errOf(() => cancelWarpingReceiveDoc(d1.data.id, `${TAG} tekrar`, U));
    check("§1 ikinci storno 409 WARPING_RECEIVE_DOC_NOT_OPEN · önizleme engelli", again?.status === 409 && again.code === "WARPING_RECEIVE_DOC_NOT_OPEN" && !(await previewCancelWarpingReceiveDoc(d1.data.id)).cancellable, show(again));
    check("§1 kısa sebep 400", (await errOf(() => cancelWarpingReceiveDoc(d1.data.id, "x", U)))?.status === 400);

    // ── §2 LIFO bozan → hep-ya-hiç ───────────────────────────────────────
    const d2 = await doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: B, beams: L(1) }], `${TAG}-I2`);
    const later = await receiveWarpingOrder(B, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-I2b`, beams: L(1) }, U);
    const pv2 = await previewCancelWarpingReceiveDoc(d2.data.id);
    const bNo = (await prisma.warpingOrder.findUniqueOrThrow({ where: { id: B }, select: { orderNo: true } })).orderNo;
    check("§2 önizleme: B'de daha yeni kabul → engel (sipariş no önekli), geri alınamaz", !pv2.cancellable && pv2.blockers.some((b) => b.startsWith(`${bNo}:`) && b.includes("LIFO")), JSON.stringify(pv2.blockers));
    const e2 = await errOf(() => cancelWarpingReceiveDoc(d2.data.id, `${TAG} lifo`, U));
    check("§2 storno 409 WARPING_RECEIPT_LIFO ve HİÇBİR parça değişmedi (A dahil READY)", e2?.status === 409 && e2.code === "WARPING_RECEIPT_LIFO" && (await statusOf(d2.data.id)).every((s) => s === WarpBeamStatus.READY), show(e2));
    await cancelWarpingReceipt(B, later.receiptKey, `${TAG} sonraki geri`, U);
    const r2 = await cancelWarpingReceiveDoc(d2.data.id, `${TAG} lifo sonra`, U);
    check("§2 sonraki kabul geri alınınca belge stornosu geçer", r2.orders.length === 2 && (await statusOf(d2.data.id)).every((s) => s === WarpBeamStatus.CANCELLED));

    // ── §3 sipariş kısmı stornosu serbest; belge atlar ───────────────────
    const d3 = await doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: B, beams: L(1) }], `${TAG}-I3`);
    const aKey = (await docBeams(d3.data.id)).find((b) => b.warpingOrderId === A)!.warpingReceiptKey!;
    await cancelWarpingReceipt(A, aKey, `${TAG} yalnız A`, U);
    const pv3 = await previewCancelWarpingReceiveDoc(d3.data.id);
    check("§3 önizleme: A 'zaten geri alınmış' (atlanır), B canlı, toplam 1 sipariş/1 levent",
      pv3.cancellable && pv3.orders.find((o) => o.warpingOrderId === A)?.alreadyCancelled === true && pv3.orders.find((o) => o.warpingOrderId === B)?.alreadyCancelled === false
      && pv3.totals.orderCount === 1 && pv3.totals.beamCount === 1, JSON.stringify(pv3.totals));
    const r3 = await cancelWarpingReceiveDoc(d3.data.id, `${TAG} kalan`, U);
    check("§3 storno yalnız B parçasını yazdı", r3.orders.length === 1 && r3.orders[0]!.warpingOrderId === B && (await statusOf(d3.data.id)).every((s) => s === WarpBeamStatus.CANCELLED));

    // ── §4 reddedilmiş sarım ─────────────────────────────────────────────
    const d4 = await doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: B, beams: L(1) }], `${TAG}-I4`);
    const bBeam = (await docBeams(d4.data.id)).find((b) => b.warpingOrderId === B)!;
    await createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: B, beamIds: [bBeam.id], reasonCode: "TEL_KOPUK", expectRework: false }, U);
    const pv4 = await previewCancelWarpingReceiveDoc(d4.data.id);
    const e4 = await errOf(() => cancelWarpingReceiveDoc(d4.data.id, `${TAG} ret`, U));
    const st4 = await docBeams(d4.data.id);
    check("§4 ret: önizleme engelli · 409 WARPING_RECEIPT_HAS_REJECTION · A READY, B REJECTED kaldı",
      !pv4.cancellable && e4?.status === 409 && e4.code === "WARPING_RECEIPT_HAS_REJECTION"
      && st4.find((b) => b.warpingOrderId === A)?.status === WarpBeamStatus.READY && st4.find((b) => b.warpingOrderId === B)?.status === WarpBeamStatus.REJECTED, show(e4));

    // ── §5 FULL_OUT gövdenin boş dönüşü ──────────────────────────────────
    const r5 = await receiveWarpingOrder(A, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-I5`, beams: [{ lengthM: 1000, physicalBeamNo: `${TAG}-G5`, newBody: { owner: { kind: "OURS" } } }] }, U);
    const w5 = await prisma.warpBeam.findFirstOrThrow({ where: { warpingReceiptKey: r5.receiptKey }, select: { id: true, beamBodyId: true } });
    const G5 = w5.beamBodyId!;
    // Fason dokumacıya dolu gönderim gövde düzeyinde kurulur (kancanın yazdığı olayın aynısı) — sarım sevki bu bekçinin konusu değil.
    await prisma.$transaction((tx) => transitionBeamBodyTx(tx, { bodyId: G5, kind: "SHIPPED_FULL", from: BeamBodyStatus.FULL_STOCK, to: BeamBodyStatus.FULL_OUT, place: { warehouseId: null, subcontractorId: sub.id, machineId: null }, warpBeamId: w5.id, userId: U }));
    const noReason = await errOf(() => applyBeamBodyTransition(G5, { kind: "RETURN_EMPTY" }, U));
    check("§5 FULL_OUT boş dönüşte sebep zorunlu (400 BEAM_BODY_RETURN_REASON_REQUIRED)", noReason?.status === 400 && noReason.code === "BEAM_BODY_RETURN_REASON_REQUIRED", show(noReason));
    const ret = await applyBeamBodyTransition(G5, { kind: "RETURN_EMPTY", warehouseId: whId, reason: `${TAG} dokumacıda bitti` }, U);
    const retEv = await prisma.beamBodyEvent.findFirst({ where: { bodyId: G5, kind: "RETURN_EMPTY" }, select: { id: true, warpBeamId: true, fromStatus: true, reason: true } });
    check("§5 boş döndü: EMPTY_STOCK · sarım bağı boşaldı · olay sarımı + sebebi taşır · sarım durumu değişmedi",
      ret.body.status === BeamBodyStatus.EMPTY_STOCK && ret.body.currentWarpBeam === null && retEv?.warpBeamId === w5.id && retEv.fromStatus === BeamBodyStatus.FULL_OUT && retEv.reason === `${TAG} dokumacıda bitti`
      && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: w5.id }, select: { status: true } })).status === WarpBeamStatus.READY, JSON.stringify(retEv));
    const undone = await undoBeamBodyEvent(G5, retEv!.id, `${TAG} yanlış`, U);
    check("§5 geri alma: FULL_OUT ve aynı sarım gövdede", undone.status === BeamBodyStatus.FULL_OUT && undone.currentWarpBeam?.id === w5.id, JSON.stringify({ s: undone.status, w: undone.currentWarpBeam }));
    const at = new Date();
    const ck = await errOf(() => prisma.$executeRaw`INSERT INTO beam_body_events (id, "bodyId", kind, "fromStatus", "toStatus", "warpBeamId", "createdAt") VALUES (${randomUUID()}::uuid, ${G5}::uuid, 'MAINTENANCE_IN', 'EMPTY_STOCK', 'MAINTENANCE', ${w5.id}::uuid, ${at})`);
    check("§5 DB CHECK: sarım taşıyamayan türde (MAINTENANCE_IN) warpBeamId reddedilir (warp_allowed_ck)", ck !== null && ck.msg.includes("beam_body_events_warp_allowed_ck"), ck?.msg.slice(-300) ?? "hata yok");

    // ── §6 denye: gövde darası yedeği ────────────────────────────────────
    const C = await newOrder(300);
    await receiveWarpingOrder(C, {
      clientToken: randomUUID(), deliveryNoteNo: `${TAG}-I6`,
      beams: [{ lengthM: 1000, grossKg: 81, tareKg: 30 }, { lengthM: 1000, grossKg: 82, physicalBeamNo: `${TAG}-G6`, newBody: { owner: { kind: "OURS" }, tareKg: 31 } }, { lengthM: 1000, grossKg: 80 }],
    }, U);
    const rep = await getDenierDeviationReport({ yarnItemId: X, subcontractorId: sub.id });
    const row = rep.rows.find((r) => r.yarnItemId === X);
    // A/B'deki tartısız sarımlar örnek değil; C: tartılı dara (51) + gövde darası (51) = 2 örnek, darasız ve gövdesiz üçüncü dışarıda.
    check("§6 gövde darası yedek: 2 örnek · 1'i gövde kartından · net 102 kg", row?.beamCount === 2 && row.bodyTareBeamCount === 1 && row.weighedNetKg === "102.000", JSON.stringify(row));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    const docIds = (await prisma.warpingReceiveDoc.findMany({ where: { deliveryNoteNo: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id);
    const rejIds = (await prisma.warpingBeamRejection.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((r) => r.id);
    const bodyIds = (await prisma.beamBody.findMany({ where: { OR: [{ bodyNo: { startsWith: TAG } }, { warpBeams: { some: { id: { in: beamIds } } } }] }, select: { id: true } })).map((b) => b.id);
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((d) => d.id);
    await prisma.warpingBeamRejectionPhoto.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejectionItem.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejection.deleteMany({ where: { id: { in: rejIds } } });
    await prisma.beamBody.updateMany({ where: { id: { in: bodyIds } }, data: { currentWarpBeamId: null, status: BeamBodyStatus.EMPTY_STOCK, subcontractorId: null, machineId: null } }).catch(() => undefined);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.warpBeam.updateMany({ where: { id: { in: beamIds } }, data: { reworkOfBeamId: null, beamBodyId: null } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: bodyIds } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: bodyIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpingReceiveDoc.deleteMany({ where: { id: { in: docIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds, ...rejIds, ...bodyIds, ...docIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.item.deleteMany({ where: { id: { in: yarnIds } } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
