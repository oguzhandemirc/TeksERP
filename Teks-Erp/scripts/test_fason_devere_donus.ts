// =============================================================================
// FASON DEVERE — devereciden DÖNEN LEVENT KABULÜ · iplik dağıtımı · kabul stornosu (D5a)
// =============================================================================
// Fikstür: kart x/y/z (3000×150, 2400×150, 1800×300 den) → 1000 m'de 50 / 40 / 60 kg; MONO (165 den × 5250 + 70 den × 5250).
//   S7/K6 2 levent × farklı boy (1000 + 600 m) tek işlemde: READY, köken SUBCONTRACT, kgSource THEORETICAL, kırılım Σ = WOUND
//   FIFO  tüketim sevk sırasına dağılır (önce eski sevk) · yetmeyince DEVİR (kapanmış C siparişinin aynı devereci/iplik kalanı)
//   S25  tartı saklanır, tüketimi değiştirmez; fark mutabakatta · S9 metre/levent adedi plan ↔ gelen
//   S24  deverecideki iplikten fazla nominal tüketim: dağıtılmaz, uyarı, bakiye eksiye inmez
//   S22  replay (aynı yanıt, çift levent yok; farklı gövde 409; geri alınmış kabulün token'ı 409)
//   S18  kabul stornosu LIFO (eski kabul / eski levent 409) · dağıtım düşer, tutma geri gelir · kapanmış siparişte 409
//   S28  MONO emanet: levent sahibi kalıtır · LIFO sevk iptali 409 · eski iade ucu tavanı dağıtılanı düşer
//   Yarış açık tx'te iade kalemi tutarken kabul taze okur · iki sipariş aynı devri birlikte aşamaz
//   DB   CHECK (kg > 0, devere doğumu ⇒ SUBCONTRACT) · uçların `requireIplikEnabled`'ı
// NEGATİF SONDA (koşuldu 2026-11-18): bkz. arşiv notu "Fason devere D5a".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { listYarnItems, returnYarn, returnYarnTx } from "../src/services/subcontractor-yarn.service";
import { cancelWound } from "../src/services/warp-beam-wind.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch, previewCancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { listWarpingYarnHoldings } from "../src/services/warping-order/yarn-return";
import { previewWarpingReceive, receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt, previewCancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { listWarpingReceipts } from "../src/services/warping-order/receipts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDR-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 120)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const R = "KALAN_IPLIK";

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE DÖNÜŞ KABULÜ (D5a) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const custA = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  if (!custA) throw new Error("Fikstür eksik: MUS-001 (npm run seed:fixtures)");
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.EMANET_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await reconcileReasonPresets();

    const mkYarn = async (k: string, den: number) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
      yarnIds.push(y.id);
      return y.id;
    };
    const mkLot = async (itemId: string, k: string, ownerCustomerId: string | null = null) => {
      const l = await prisma.yarnLot.create({ data: { itemId, lotNo: `${TAG}-${k}`, ownerCustomerId }, select: { id: true } });
      lotIds.push(l.id);
      return l.id;
    };
    const stockIn = (itemId: string, lotId: string | null, qtyKg: number) =>
      prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg, lotId, reason: `${TAG} giriş` }));
    const mkSpec = async (k: string, lines: Array<[string, number]>) => {
      const s = await prisma.warpSpec.create({
        data: { code: `${TAG}-${k}`, name: `${TAG} ${k}`, yarnItemId: lines[0]![0], endsCount: lines.reduce((a, l) => a + l[1], 0), yarns: { create: lines.map(([yarnItemId, endsCount], sortOrder) => ({ yarnItemId, endsCount, sortOrder })) } },
        select: { id: true },
      });
      specIds.push(s.id);
      return s.id;
    };
    const X = await mkYarn("X", 150);
    const Y = await mkYarn("Y", 150);
    const Z = await mkYarn("Z", 300);
    const M1 = await mkYarn("M165", 165);
    const M2 = await mkYarn("M70", 70);
    const lx = await mkLot(X, "XL");
    const ly = await mkLot(Y, "YL");
    const lz = await mkLot(Z, "ZL");
    const lm1 = await mkLot(M1, "M1E", custA.id);
    const lm2 = await mkLot(M2, "M2E", custA.id);
    for (const [y, l] of [[X, lx], [Y, ly], [Z, lz], [M1, lm1], [M2, lm2]] as const) await stockIn(y, l, 1000);
    const xyz = await mkSpec("XYZ", [[X, 3000], [Y, 2400], [Z, 1800]]);
    const mono = await mkSpec("MONO", [[M1, 5250], [M2, 5250]]);
    const newOrder = async (warpSpecId: string, beamLines: Array<{ beamCount: number; beamLengthM: number }>) => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId, beamLines }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, lines: Array<[string, string, number]>) =>
      dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines: lines.map(([yarnItemId, lotId, qtyKg]): WarpingDispatchLineInput => ({ yarnItemId, warehouseId: whId, lotId, qtyKg })) }, U);
    const receive = (orderId: string, beams: WarpingReceiveBeamInput[], clientToken: string = randomUUID(), deliveryNoteNo = "IRS-1") => receiveWarpingOrder(orderId, { clientToken, deliveryNoteNo, beams }, U);
    const holds = async (orderId: string, yarn: string) => (await listWarpingYarnHoldings(orderId)).filter((h) => h.yarnItemId === yarn).reduce((s, h) => s + Number(h.holdingKg), 0);
    const setStatus = (id: string, status: WarpingOrderStatus) => prisma.warpingOrder.update({ where: { id }, data: status === WarpingOrderStatus.COMPLETED ? { status, completedAt: new Date(), completedById: U } : { status, completedAt: null, completedById: null } });
    const allocOf = async (itemId: string) => Number((await prisma.warpBeamYarnAllocation.aggregate({ where: { dispatchItemId: itemId, eventYarn: { event: { reversal: null } } }, _sum: { kg: true } }))._sum.kg ?? 0);

    // ── Devir kaynağı: kapanmış C (Y 20, Z 40) ───────────────────────────
    const C = await newOrder(xyz, [{ beamCount: 1, beamLengthM: 1000 }]);
    await send(C, [[Y, ly, 20], [Z, lz, 40]]);
    await setStatus(C, WarpingOrderStatus.COMPLETED);
    // ── A: iki sevk, sonra 2 levent (1000 + 600 m) ────────────────────────
    const A = await newOrder(xyz, [{ beamCount: 2, beamLengthM: 1000 }]);
    const d1 = await send(A, [[X, lx, 40], [Y, ly, 30], [Z, lz, 70]]);
    const d2 = await send(A, [[X, lx, 40], [Y, ly, 30]]);
    const it = (d: typeof d1, y: string) => d.yarnItems.find((i) => i.yarnItemId === y)!.dispatchItemId;
    const pv = await previewWarpingReceive(A, { deliveryNoteNo: "IRS-1", beams: [{ lengthM: 1000, grossKg: 165, tareKg: 10 }, { lengthM: 600 }] });
    check("Önizleme yazmaz: levent yok, beam0 nominal 150, beam1 90; devirli satır var", (await prisma.warpBeam.count({ where: { warpingOrderId: A } })) === 0 && pv.beams[0]!.nominalKg === "150.000" && pv.beams[1]!.nominalKg === "90.000" && pv.allocations.some((a) => a.carryOver), JSON.stringify(pv.beams.map((b) => b.nominalKg)));
    const tokA = randomUUID();
    const r1 = await receive(A, [{ lengthM: 1000, physicalBeamNo: `${TAG}-G1`, grossKg: 165, tareKg: 10 }, { lengthM: 600, physicalBeamNo: `${TAG}-G2` }], tokA);
    const beams = await prisma.warpBeam.findMany({ where: { warpingOrderId: A }, select: { id: true, status: true, originKind: true, subcontractorId: true, plannedLengthM: true, events: { where: { kind: "WOUND" }, select: { id: true, lengthM: true, theoreticalKg: true, kgSource: true, grossKg: true, deliveryNoteNo: true, yarns: { select: { theoreticalKg: true } } } } }, orderBy: { beamNo: "asc" } });
    check("S7/K6 2 levent tek işlemde: READY · SUBCONTRACT · devereci · boylar 1000/600", beams.length === 2 && beams.every((b) => b.status === "READY" && b.originKind === "SUBCONTRACT" && b.subcontractorId === sub.id) && Number(beams[0]!.events[0]!.lengthM) === 1000 && Number(beams[1]!.events[0]!.lengthM) === 600);
    check("WOUND: kgSource THEORETICAL, irsaliye no, kırılım 3 satır ve Σ = theoreticalKg (150 / 90)", beams.every((b) => { const e = b.events[0]!; return e.kgSource === "THEORETICAL" && e.deliveryNoteNo === "IRS-1" && e.yarns.length === 3 && e.yarns.reduce((s, y) => s + Number(y.theoreticalKg), 0) === Number(e.theoreticalKg); }) && Number(beams[0]!.events[0]!.theoreticalKg) === 150 && Number(beams[1]!.events[0]!.theoreticalKg) === 90);
    const beam0AllocKg = Number((await prisma.warpBeamYarnAllocation.aggregate({ where: { eventYarn: { eventId: beams[0]!.events[0]!.id } }, _sum: { kg: true } }))._sum.kg ?? 0);
    check("S25 tartı saklanır (brüt 165) ama tüketim hesaptan: X d1 40 + d2 40 dağıtıldı, tartılı levent Σ dağıtım = nominal 150", Number(beams[0]!.events[0]!.grossKg) === 165 && (await allocOf(it(d1, X))) === 40 && (await allocOf(it(d2, X))) === 40 && beam0AllocKg === 150, String(beam0AllocKg));
    const yRows = await prisma.warpBeamYarnAllocation.findMany({ where: { warpingOrderId: A, dispatchItem: { yarnItemId: Y } }, select: { kg: true, dispatchItemId: true, holderWarpingOrderId: true, eventYarn: { select: { event: { select: { beam: { select: { beamNo: true } } } } } } }, orderBy: { createdAt: "asc" } });
    check("FIFO: Y önce d1 (30) sonra d2 (30), kalan 4 kg DEVİR (tutan = C)", (await allocOf(it(d1, Y))) === 30 && (await allocOf(it(d2, Y))) === 30 && yRows.some((r) => r.holderWarpingOrderId === C && Number(r.kg) === 4), JSON.stringify(yRows.map((r) => [Number(r.kg), r.holderWarpingOrderId === C])));
    check("Devir: Z 70 d1 + 26 C'den; C tutması Y 16 · Z 14; A tutması 0", (await allocOf(it(d1, Z))) === 70 && (await holds(C, Y)) === 16 && (await holds(C, Z)) === 14 && (await holds(A, X)) === 0 && (await holds(A, Y)) === 0, `${await holds(C, Y)} ${await holds(C, Z)}`);
    const st = r1.settlement;
    const sy = (y: string) => st.yarns.find((v) => v.yarnItemId === y)!;
    check("S9 mutabakat: hedef 2000 ↔ gelen 1600 (−400, −20%), levent 2 ↔ 2", st.metre.targetM === "2000.000" && st.metre.receivedM === "1600.000" && st.metre.diffM === "-400.000" && st.metre.diffPct === "-20.00" && st.metre.receivedBeamCount === 2, JSON.stringify(st.metre));
    check("Mutabakat iplik: Z sarılan 96 = kendi 70 + devir 26, dağıtılamayan 0; tartı farkı +5", sy(Z).woundKg === "96.000" && sy(Z).fromOwnKg === "70.000" && sy(Z).carryOverUsedKg === "26.000" && sy(Z).unallocatedKg === "0.000" && st.weighing?.diffKg === "5.000", JSON.stringify(st.weighing));
    const li = await listYarnItems(prisma, d1.dispatch.id);
    check("Fason kalem okuyucusu (listYarnItems) dağıtımı sarılan sayar: d1 X kalan 0", li.items.find((i) => i.item.id === X)?.remainingKg === 0 && li.items.find((i) => i.item.id === X)?.sarilanKg === 40);
    // ── Replay ───────────────────────────────────────────────────────────
    const rp = await receive(A, [{ lengthM: 1000, physicalBeamNo: `${TAG}-G1`, grossKg: 165, tareKg: 10 }, { lengthM: 600, physicalBeamNo: `${TAG}-G2` }], tokA);
    check("S22 replay: aynı kabul, çift levent yok", rp.replayed && rp.receiptKey === r1.receiptKey && (await prisma.warpBeam.count({ where: { warpingOrderId: A } })) === 2);
    const eCol = await errOf(() => receive(A, [{ lengthM: 999 }], tokA));
    check("S22 aynı token farklı gövde → 409 CLIENT_TOKEN_COLLISION", eCol?.status === 409 && eCol.code === "CLIENT_TOKEN_COLLISION", show(eCol));
    // ── LIFO kapıları ────────────────────────────────────────────────────
    const eRet = await errOf(() => returnYarn(d1.dispatch.id, { dispatchItemId: it(d1, X), qtyKg: 1, reasonCode: R }, U));
    check("Eski iade ucu tavanı levente sarılanı düşer → 400 YARN_RETURN_EXCEEDS", eRet?.status === 400 && eRet.code === "YARN_RETURN_EXCEEDS", show(eRet));
    const eDc = await errOf(() => cancelWarpingDispatch(A, d2.dispatch.id, `${TAG} iptal`, U));
    const dcPv = await previewCancelWarpingDispatch(A, d2.dispatch.id);
    check("Dağıtılmış kalemli sevk iptali → 409 YARN_ITEM_ALLOCATED (LIFO), önizleme engelli", eDc?.status === 409 && eDc.code === "YARN_ITEM_ALLOCATED" && !dcPv.canCancel && /dağıtılmış/.test(dcPv.blockedReason ?? ""), `${show(eDc)} | ${dcPv.blockedReason}`);
    const tokB = randomUUID();
    const r2 = await receive(A, [{ lengthM: 400 }], tokB, "IRS-2");
    check("S24 ikinci kabul: X 20 dağıtılamadı (uyarı), Y 16 devirden, Z 14 devir + 10 dağıtılamadı; bakiye eksiye inmedi", r2.warnings.length === 2 && (await holds(C, Y)) === 0 && (await holds(C, Z)) === 0 && r2.settlement.yarns.find((v) => v.yarnItemId === X)!.unallocatedKg === "20.000", JSON.stringify(r2.warnings));
    check("S24 uyarı metni günlük dilde: 'deverecideki iplikten 20 kg fazla görünüyor', teknik terim yok", r2.warnings.some((w) => w.includes("deverecideki iplikten 20 kg fazla görünüyor")) && !r2.warnings.some((w) => /nominal|denye/.test(w)), JSON.stringify(r2.warnings));
    const eOld = await errOf(() => cancelWarpingReceipt(A, r1.receiptKey, `${TAG} geri`, U));
    const eOldB = await errOf(() => cancelWound(beams[1]!.id, `${TAG} geri`, U));
    const cpv = await previewCancelWarpingReceipt(A, r1.receiptKey);
    check("S18 LIFO: eski kabul ve eski levent stornosu → 409 WARPING_RECEIPT_LIFO (önizleme engelli)", eOld?.code === "WARPING_RECEIPT_LIFO" && eOldB?.code === "WARPING_RECEIPT_LIFO" && cpv.blockers.length > 0, `${show(eOld)} | ${show(eOldB)}`);
    await setStatus(A, WarpingOrderStatus.COMPLETED);
    const eComp = await errOf(() => cancelWarpingReceipt(A, r2.receiptKey, `${TAG} geri`, U));
    const eRecv = await errOf(() => receive(A, [{ lengthM: 10 }]));
    await setStatus(A, WarpingOrderStatus.IN_PROGRESS);
    check("Kapanmış siparişte kabul stornosu 409 WARPING_ORDER_COMPLETED · yeni kabul 409 NOT_RECEIVABLE", eComp?.code === "WARPING_ORDER_COMPLETED" && eRecv?.code === "WARPING_ORDER_NOT_RECEIVABLE", `${show(eComp)} | ${show(eRecv)}`);
    const c2 = await cancelWarpingReceipt(A, r2.receiptKey, `${TAG} geri`, U);
    check("S18 en yeni kabul geri alındı: devir C'ye döner (Y 16 · Z 14), levent CANCELLED", c2.cancelledBeams.length === 1 && (await holds(C, Y)) === 16 && (await holds(C, Z)) === 14 && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: c2.cancelledBeams[0]!.id }, select: { status: true } })).status === "CANCELLED");
    const eDead = await errOf(() => receive(A, [{ lengthM: 400 }], tokB, "IRS-2"));
    check("S22 geri alınmış kabulün token'ı → 409 WARP_BEAM_CANCELLED", eDead?.status === 409 && eDead.code === "WARP_BEAM_CANCELLED", show(eDead));
    await cancelWound(beams[1]!.id, `${TAG} geri`, U);
    check("Tekil levent stornosu (en yeni canlı): 600 m'nin dağıtımı düşer — A X 30 · Y 20 tutar, C Y 20 · Z 40", (await holds(A, X)) === 30 && (await holds(A, Y)) === 20 && (await holds(C, Y)) === 20 && (await holds(C, Z)) === 40, `${await holds(A, X)} ${await holds(A, Y)} ${await holds(C, Y)} ${await holds(C, Z)}`);
    const list = await listWarpingReceipts(A);
    check("Kabul listesi: 2 kabul (IRS-1 1 canlı / IRS-2 0 canlı), gelen 1000 m", list.receipts.length === 2 && list.receipts[0]!.liveBeamCount === 1 && list.receipts[1]!.liveBeamCount === 0 && list.settlement.metre.receivedM === "1000.000");
    // ── MONO emanet ──────────────────────────────────────────────────────
    const M = await newOrder(mono, [{ beamCount: 2, beamLengthM: 2500 }]);
    await send(M, [[M1, lm1, 490], [M2, lm2, 210]]);
    const rm = await receive(M, [{ lengthM: 2500 }, { lengthM: 2500 }]);
    const mb = await prisma.warpBeam.findMany({ where: { warpingOrderId: M }, select: { ownerCustomerId: true, events: { where: { kind: "WOUND" }, select: { yarns: { select: { yarnItemId: true, theoreticalKg: true } } } } } });
    const k1 = mb.map((b) => Number(b.events[0]!.yarns.find((y) => y.yarnItemId === M1)!.theoreticalKg));
    const k2 = mb.map((b) => Number(b.events[0]!.yarns.find((y) => y.yarnItemId === M2)!.theoreticalKg));
    check("S2 MONO: levent başına 240,625 + 102,083 kg; M tutması 165 → 8,75 · 70 → 5,834", k1.every((v) => v === 240.625) && k2.every((v) => v === 102.083) && Math.abs((await holds(M, M1)) - 8.75) < 1e-9 && Math.abs((await holds(M, M2)) - 5.834) < 1e-9, `${k1} ${k2} ${await holds(M, M1)} ${await holds(M, M2)}`);
    check("S28 emanet: dönen leventler ipliğin sahibini kalıtır", mb.every((b) => b.ownerCustomerId === custA.id) && rm.beams.every((b) => b.ownerCustomerId === custA.id));
    // ── Yarış ────────────────────────────────────────────────────────────
    const F1 = await newOrder(xyz, [{ beamCount: 1, beamLengthM: 1000 }]);
    const F2 = await newOrder(xyz, [{ beamCount: 1, beamLengthM: 1000 }]);
    const yBefore = await holds(C, Y);
    await Promise.all([receive(F1, [{ lengthM: 300 }]), receive(F2, [{ lengthM: 300 }])]);
    const used = Number((await prisma.warpBeamYarnAllocation.aggregate({ where: { warpingOrderId: { in: [F1, F2] }, holderWarpingOrderId: C, dispatchItem: { yarnItemId: Y }, eventYarn: { event: { reversal: null } } }, _sum: { kg: true } }))._sum.kg ?? 0);
    check(`Yarış b: iki sipariş aynı devri (Y ${yBefore}) birlikte aşamaz, C eksiye inmez`, used === yBefore && (await holds(C, Y)) === 0, `${used} ${await holds(C, Y)}`);
    const E = await newOrder(xyz, [{ beamCount: 1, beamLengthM: 1000 }]);
    const dE = await send(E, [[X, lx, 50]]);
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let inTx!: () => void;
    const entered = new Promise<void>((res) => { inTx = res; });
    const holder = prisma.$transaction(async (tx) => {
      await returnYarnTx(tx, dE.dispatch.id, { dispatchItemId: it(dE, X), qtyKg: 30, reasonCode: R }, U);
      inTx();
      await gate;
    }, { timeout: 20_000 });
    await entered;
    const racing = receive(E, [{ lengthM: 1000 }]);
    await new Promise((r) => setTimeout(r, 400));
    release();
    await holder;
    const rE = await racing;
    check("Yarış a: açık tx 30 kg iade ederken kabul kalem kilidinde bekler, TAZE okur — X 20 dağıtılır, 30 uyarı", (await allocOf(it(dE, X))) === 20 && rE.settlement.yarns.find((v) => v.yarnItemId === X)!.unallocatedKg === "30.000" && (await holds(E, X)) === 0);
    // ── DB seddi + kapılar ───────────────────────────────────────────────
    const ey = await prisma.warpBeamEventYarn.findFirstOrThrow({ where: { event: { beam: { warpingOrderId: M } } }, select: { id: true } });
    const e1 = await errOf(() => prisma.warpBeamYarnAllocation.create({ data: { eventYarnId: ey.id, dispatchItemId: it(d1, X), warpingOrderId: M, holderWarpingOrderId: M, kg: 0 } }));
    const e2 = await errOf(() => prisma.warpBeam.create({ data: { beamNo: `${TAG}-BAD`, warpSpecId: xyz, plannedLengthM: 1, originKind: "IN_HOUSE", warpingOrderId: M, warpingReceiptKey: randomUUID() } }));
    const e3 = await errOf(() => prisma.warpBeam.create({ data: { beamNo: `${TAG}-BAD2`, warpSpecId: xyz, plannedLengthM: 1, originKind: "SUBCONTRACT", subcontractorId: sub.id, warpingOrderId: M } }));
    check("DB: dağıtım kg 0 · devere doğumlu IN_HOUSE levent · kabul anahtarsız devere leventi reddedilir", [e1, e2, e3].every((e) => e !== null), [e1, e2, e3].map((e) => (e ? "✗" : "geçti")).join(","));
    const eDup = await errOf(() => previewWarpingReceive(A, { beams: [{ lengthM: 1, physicalBeamNo: "G" }, { lengthM: 1, physicalBeamNo: "G" }] }));
    const eTare = await errOf(() => previewWarpingReceive(A, { beams: [{ lengthM: 1, grossKg: 10, tareKg: 10 }] }));
    check("Gövde: aynı kabulde iki kez gövde no → 400 · dara ≥ brüt → 400", eDup?.code === "WARPING_RECEIVE_DUPLICATE_PHYSICAL" && eTare?.code === "WARPING_RECEIVE_TARE_EXCEEDS", `${show(eDup)} | ${show(eTare)}`);
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order-receive.routes.ts"), "utf8");
    const ends = ["get\\(\"/:id/receipts\"", "post\\(\"/:id/receive/preview\"", "post\\(\"/:id/receive\"", "get\\(\"/:id/receipts/:receiptKey/cancel-preview\"", "post\\(\"/:id/receipts/:receiptKey/cancel\""];
    const gated = ends.map((p) => new RegExp(`router\\.${p}[^\\n]*requireIplikEnabled`).test(routes));
    const mainR = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order.routes.ts"), "utf8");
    // D1: tablet bağlamı (`/tablet-context`) iplik okumaz/yazmaz → iplik kapısı almaz; sayımdan bilerek düşülür.
    const counted = (routes.match(/^router\.(get|post)\("(?!\/tablet-context")/gm) ?? []).length;
    check("Modül: beş dönüş ucu `requireIplikEnabled` uç başına; alt router devere kapısının arkasında, `/:id`den önce", gated.every(Boolean) && counted === ends.length
      && mainR.indexOf("router.use(verifyToken, requireDevereEnabled)") < mainR.indexOf('router.use("/", warpingOrderReceiveRoutes)') && mainR.indexOf('router.use("/", warpingOrderReceiveRoutes)') < mainR.indexOf('router.get("/:id"'), JSON.stringify(gated));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { beamNo: { startsWith: TAG } }] }, select: { id: true } })).map((b) => b.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
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
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds] } } });
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
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
