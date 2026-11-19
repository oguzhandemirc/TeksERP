// =============================================================================
// FASON DEVERE — iade penceresinde FİRE + kalan sıfırlanınca OTOMATİK KAPANIŞ (2026-11-19)
// =============================================================================
// Fikstür: kart x/y/z (3000×150, 2400×150, 1800×300 den), sabit fire 50 m → 1 × 1000 m'de sarılan 50/40/60 kg.
//   A  önizleme (fire %, tolerans, tavan, willClose) kapanış planıyla aynı hesap · iade + fire tek tx (fire = kapanış defteri,
//      kaynağı iade hareketi) · token replay / çakışma · son kalem → sipariş KAPANIR (SETTLE, satırsız, audit auto)
//   A' yeniden aç → IN_PROGRESS, iade firesi yerinde · iade stornosu fireyi de geri alır · iptal sonrası replay 409
//   B  levent gelmemiş sipariş: kalan 0 olsa da KAPANMAZ (kapanış yüklemi)
//   C  aktarma kaynağın bütün kalanını taşır → kaynak KAPANIR
//   E  kapanış fire %'si önceden yazılmış iade firesini sayar (priorWasteKg)
//   DB kaynak CHECK (kapanış XOR iade hareketi)
// NEGATİF SONDA (koşuldu 2026-11-19): bkz. arşiv notu "Fason devere iade penceresinde fire + otomatik kapanış".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { listWarpingYarnHoldings } from "../src/services/warping-order/yarn-return";
import { cancelWarpingYarnReturn, previewWarpingYarnReturn, returnWarpingYarn, type WarpingYarnReturnInput } from "../src/services/warping-order/yarn-return-waste";
import { transferWarpingYarn } from "../src/services/warping-order/yarn-transfer";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { previewSettleWarpingOrder } from "../src/services/warping-order/settle";
import { reopenWarpingOrder } from "../src/services/warping-order/reopen";
import { AUTO_SETTLE_REASON } from "../src/services/warping-order/auto-settle";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDIF-${process.pid}`;
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
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const R = "KALAN_IPLIK";
const n = (v: Prisma.Decimal.Value | null | undefined) => Number(v ?? 0);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE İADE + FİRE + OTOMATİK KAPANIŞ ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await reconcileReasonPresets();

    const mkYarn = async (k: string, den: number) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
      yarnIds.push(y.id);
      const l = await prisma.yarnLot.create({ data: { itemId: y.id, lotNo: `${TAG}-${k}L` }, select: { id: true } });
      lotIds.push(l.id);
      await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: y.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: l.id, reason: `${TAG} giriş` }));
      return { id: y.id, lot: l.id };
    };
    const X = await mkYarn("X", 150);
    const Y = await mkYarn("Y", 150);
    const Z = await mkYarn("Z", 300);
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XYZ`, name: `${TAG} XYZ`, yarnItemId: X.id, endsCount: 7200, yarns: { create: [[X.id, 3000], [Y.id, 2400], [Z.id, 1800]].map(([yarnItemId, endsCount], sortOrder) => ({ yarnItemId: yarnItemId as string, endsCount: endsCount as number, sortOrder })) } },
      select: { id: true },
    });
    specIds.push(spec.id);
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 50, wasteTolerancePct: 5, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, lines: Array<[{ id: string; lot: string }, number]>) =>
      dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines: lines.map(([y, qtyKg]): WarpingDispatchLineInput => ({ yarnItemId: y.id, warehouseId: whId, lotId: y.lot, qtyKg })) }, U);
    const receive = (orderId: string) => receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: "IRS-IF", beams: [{ lengthM: 1000 }] }, U);
    const holds = async (orderId: string, y: { id: string }) => (await listWarpingYarnHoldings(orderId)).filter((h) => h.yarnItemId === y.id).reduce((s, h) => s + Number(h.holdingKg), 0);
    const status = async (id: string) => (await prisma.warpingOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    const stockOf = async (y: { id: string }) => n((await prisma.yarnStock.findFirst({ where: { itemId: y.id, warehouseId: whId }, select: { balanceKg: true } }))?.balanceKg);
    const ret = (orderId: string, b: Omit<WarpingYarnReturnInput, "reasonCode">) => returnWarpingYarn(orderId, { reasonCode: R, ...b }, U);
    const full = async () => {
      const id = await newOrder();
      const d = await send(id, [[X, 60], [Y, 50], [Z, 70]]);
      await receive(id);
      const it = (y: { id: string }) => d.yarnItems.find((i) => i.yarnItemId === y.id)!.dispatchItemId;
      return { id, x: it(X), y: it(Y), z: it(Z) };
    };

    // ── A: tutma X 10 · Y 10 · Z 10; levent geldi ────────────────────────────────────────────────
    const A = await full();
    const p1 = await previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 2, reasonCode: R });
    check("Önizleme: X iade 8 + fire 2 → kalır 0, fire %3,85 (< 5) uyarısız; Y/Z tutuluyor → kapanmaz", p1.keepKg === "0.000" && p1.wastePct === "3.85" && !p1.overTolerance && p1.warnings.length === 0 && !p1.willClose, JSON.stringify(p1));
    const p2 = await previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 5, wasteKg: 5, reasonCode: R });
    check("Önizleme: fire 5 → %9,09 > tolerans 5 → overTolerance + kapanışla AYNI uyarı cümlesi", p2.overTolerance && p2.wastePct === "9.09" && p2.warnings.length === 1 && p2.warnings[0]!.includes("fire %9,09 toleransı (%5)"), JSON.stringify(p2));
    const p0 = await previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 5, reasonCode: R });
    check("Önizleme: fire yoksa tolerans uyarısı yok (bugünkü davranış)", !p0.overTolerance && p0.warnings.length === 0 && p0.wasteKg === "0.000", JSON.stringify(p0));
    // Panel canlı özeti sebep seçilmeden önizler: sebepsiz önizleme sebepliyle AYNI sonucu verir (sebep yalnız yazımda zorunlu).
    const pNoReason = await errOf(() => previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 5, wasteKg: 5 }));
    const p2b = await previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 5, wasteKg: 5 }).catch(() => null);
    check("Önizleme: sebepsiz çağrı hata vermez, sebepliyle aynı plan", pNoReason === null && JSON.stringify(p2b) === JSON.stringify(p2), show(pNoReason));
    const xStock0 = await stockOf(X);
    const eEx = await errOf(() => ret(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 3 }));
    const eExP = await errOf(() => previewWarpingYarnReturn(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 3, reasonCode: R }));
    check("Tavan: iade + fire > tutulan → 400 YARN_RETURN_EXCEEDS (önizleme de), hiçbir şey yazılmaz", eEx?.code === "YARN_RETURN_EXCEEDS" && eExP?.code === "YARN_RETURN_EXCEEDS" && (await stockOf(X)) === xStock0 && (await holds(A.id, X)) === 10, `${show(eEx)} | ${show(eExP)}`);

    const T1 = randomUUID();
    const r1 = await ret(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 2, wasteReason: `${TAG} bobin dibi`, clientToken: T1 });
    const w1 = await prisma.warpingYarnWaste.findMany({ where: { warpingOrderId: A.id }, select: { kind: true, qtyKg: true, settlementId: true, returnMovementId: true, reason: true, overTolerance: true } });
    check("İade 8 + fire 2: depo +8, tutma 0, fire satırı kapanış defterinde (kaynak = iade hareketi, kapanış yok)", (await stockOf(X)) === xStock0 + 8 && (await holds(A.id, X)) === 0 && r1.qtyKg === "8.000" && r1.wasteKg === "2.000" && r1.holdingKg === "0.000"
      && w1.length === 1 && w1[0]!.kind === "WASTE" && n(w1[0]!.qtyKg) === 2 && w1[0]!.settlementId === null && w1[0]!.returnMovementId === r1.movementId && w1[0]!.reason === `${TAG} bobin dibi` && !w1[0]!.overTolerance, JSON.stringify({ r1, w1 }));
    check("Y/Z hâlâ deverecide → sipariş KAPANMAZ (IN_PROGRESS, autoClosed false)", !r1.autoClosed && (await status(A.id)) === "IN_PROGRESS");
    const r1b = await ret(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 2, wasteReason: `${TAG} bobin dibi`, clientToken: T1 });
    const moves = await prisma.yarnMovement.count({ where: { dispatchItemId: A.x, kind: YarnMovementKind.SUBCONTRACT_RETURN } });
    check("Replay: aynı token aynı gövde → aynı iade, tek hareket, tek fire", r1b.replayed && r1b.movementId === r1.movementId && moves === 1 && (await prisma.warpingYarnWaste.count({ where: { warpingOrderId: A.id } })) === 1);
    const eCol = await errOf(() => ret(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 1, clientToken: T1 }));
    check("Replay: aynı token farklı gövde (fire) → 409 CLIENT_TOKEN_COLLISION", eCol?.code === "CLIENT_TOKEN_COLLISION", show(eCol));
    const st1 = await previewSettleWarpingOrder(A.id);
    check("Mutabakat: X satırında Fire 2 kg (iade firesi görünür)", st1.settlement.yarns.find((y) => y.yarnItemId === X.id)?.wasteKg === "2.000", JSON.stringify(st1.settlement.yarns.map((y) => [y.code, y.wasteKg])));

    await ret(A.id, { dispatchItemId: A.y, qtyKg: 10 });
    const pZ = await previewWarpingYarnReturn(A.id, { dispatchItemId: A.z, qtyKg: 7, wasteKg: 3, reasonCode: R });
    check("Önizleme: son kalem sıfırlanacak + levent var → willClose", pZ.willClose && pZ.keepKg === "0.000", JSON.stringify(pZ));
    const rZ = await ret(A.id, { dispatchItemId: A.z, qtyKg: 7, wasteKg: 3, clientToken: randomUUID() });
    const sets = await prisma.warpingOrderSettlement.findMany({ where: { warpingOrderId: A.id }, select: { id: true, kind: true, reason: true, wastePct: true, returnMovementIds: true, wastes: { select: { id: true } } } });
    check("Son kalem: kalan 0 → sipariş AYNI tx'te kapandı; kapanış kaydı satırsız (iade/fire kimliği yok), sebep otomatik", rZ.autoClosed && (await status(A.id)) === "COMPLETED" && sets.length === 1 && sets[0]!.kind === "SETTLE" && sets[0]!.reason === AUTO_SETTLE_REASON && sets[0]!.returnMovementIds.length === 0 && sets[0]!.wastes.length === 0, JSON.stringify(sets));
    check("Kapanış fire %'si iade firelerini sayar: 5 / (150 + 5) = %3,23", n(sets[0]?.wastePct) === 3.23, String(sets[0]?.wastePct));
    const logs = await prisma.systemLog.findMany({ where: { recordId: A.id }, select: { newData: true } });
    check("Audit: kapanış satırı `auto: true` + tetikleyici YARN_RETURN", logs.some((l) => { const d = l.newData as Record<string, unknown> | null; return d?.auto === true && d?.trigger === "YARN_RETURN" && d?.status === "COMPLETED"; }));

    // ── A': yeniden aç · iade stornosu fireyi de geri alır ────────────────────────────────────────
    await reopenWarpingOrder(A.id, `${TAG} yeniden aç`, U);
    check("Yeniden aç: IN_PROGRESS; iade fireleri yerinde (kapanışa ait değil), X tutma 0", (await status(A.id)) === "IN_PROGRESS" && (await holds(A.id, X)) === 0 && (await prisma.warpingYarnWaste.count({ where: { warpingOrderId: A.id, kind: "WASTE_CANCEL" } })) === 0);
    const c1 = await cancelWarpingYarnReturn(A.id, r1.movementId, `${TAG} storno`, U);
    const wc = await prisma.warpingYarnWaste.findMany({ where: { warpingOrderId: A.id, kind: "WASTE_CANCEL" }, select: { qtyKg: true, reversesId: true, returnMovementId: true, settlementId: true } });
    const orig = await prisma.warpingYarnWaste.findFirstOrThrow({ where: { returnMovementId: r1.movementId }, select: { id: true } });
    check("İade stornosu: fire ters satırı (WASTE_CANCEL, reversesId, kaynak = storno hareketi); X tutma 10'a döner, depo −8", c1.wasteCancelledKg === "2.000" && wc.length === 1 && wc[0]!.reversesId === orig.id && wc[0]!.returnMovementId === c1.movementId && wc[0]!.settlementId === null && (await holds(A.id, X)) === 10 && (await stockOf(X)) === xStock0, JSON.stringify({ c1, wc }));
    const st2 = await previewSettleWarpingOrder(A.id);
    check("Mutabakat: X fire storno sonrası 0", st2.settlement.yarns.find((y) => y.yarnItemId === X.id)?.wasteKg === "0.000");
    const eDead = await errOf(() => ret(A.id, { dispatchItemId: A.x, qtyKg: 8, wasteKg: 2, wasteReason: `${TAG} bobin dibi`, clientToken: T1 }));
    check("Replay (4. durum): iade sonradan iptal edilmiş → 409 YARN_RETURN_CANCELLED", eDead?.code === "YARN_RETURN_CANCELLED", show(eDead));

    // ── B: levent gelmemiş sipariş — kalan 0 olsa da kapanmaz ────────────────────────────────────
    const B = await newOrder();
    const dB = await send(B, [[X, 10]]);
    const bx = dB.yarnItems[0]!.dispatchItemId;
    const pB = await previewWarpingYarnReturn(B, { dispatchItemId: bx, qtyKg: 7, wasteKg: 3, reasonCode: R });
    const rB = await ret(B, { dispatchItemId: bx, qtyKg: 7, wasteKg: 3 });
    check("Levent yok: kalan 0 ama kapanış yüklemi engeller → kapanmaz (IN_PROGRESS)", !pB.willClose && !rB.autoClosed && (await status(B)) === "IN_PROGRESS" && (await holds(B, X)) === 0, JSON.stringify({ pB, s: await status(B) }));

    // ── C: aktarma kaynağın bütün kalanını taşır → kaynak kapanır ────────────────────────────────
    const C = await full();
    const Dt = await newOrder();
    const tr = await transferWarpingYarn(C.id, { clientToken: randomUUID(), toWarpingOrderId: Dt, lines: [{ yarnItemId: X.id, qtyKg: 10 }, { yarnItemId: Y.id, qtyKg: 10 }, { yarnItemId: Z.id, qtyKg: 10 }] }, U);
    check("Aktarma: kaynakta iplik kalmadı + levent var → kaynak KAPANDI, hedef IN_PROGRESS", tr.sourceAutoClosed === true && (await status(C.id)) === "COMPLETED" && (await status(Dt)) === "IN_PROGRESS", JSON.stringify({ auto: tr.sourceAutoClosed, c: await status(C.id) }));

    // ── E: kapanış fire %'si önceden yazılan iade firesini sayar ─────────────────────────────────
    const E = await full();
    const rE = await ret(E.id, { dispatchItemId: E.x, qtyKg: 5, wasteKg: 5 });
    const wE = await prisma.warpingYarnWaste.findFirstOrThrow({ where: { returnMovementId: rE.movementId }, select: { overTolerance: true } });
    const pvE = await previewSettleWarpingOrder(E.id);
    const ex = pvE.plan.yarns.find((y) => y.yarnItemId === X.id)!;
    check("Tolerans aşan iade firesi satırda `overTolerance`; kapanış planı X için önceki fireyi (5) sayar → %9,09 + uyarı", wE.overTolerance && rE.warnings.length > 0 && ex.priorWasteKg === "5.000" && ex.wastePct === "9.09" && ex.overTolerance && pvE.warnings.some((w) => w.includes("%9,09")), JSON.stringify({ ex, w: pvE.warnings }));

    // ── DB: kaynak CHECK ─────────────────────────────────────────────────────────────────────────
    const anyW = await prisma.warpingYarnWaste.findFirstOrThrow({ where: { returnMovementId: rE.movementId }, select: { dispatchItemId: true } });
    const set = await prisma.warpingOrderSettlement.findFirstOrThrow({ where: { warpingOrderId: A.id }, select: { id: true } });
    const eNone = await errOf(() => prisma.warpingYarnWaste.create({ data: { warpingOrderId: E.id, dispatchItemId: anyW.dispatchItemId, kind: "WASTE", qtyKg: 1 } }));
    const eBoth = await errOf(() => prisma.warpingYarnWaste.create({ data: { warpingOrderId: E.id, dispatchItemId: anyW.dispatchItemId, kind: "WASTE", qtyKg: 1, settlementId: set.id, returnMovementId: rE.movementId } }));
    const ck = (e: Err | null) => e !== null && e.msg.includes("warping_yarn_wastes_source_ck");
    check("DB: fire satırı kaynaksız da çift kaynaklı da reddedilir (warping_yarn_wastes_source_ck)", ck(eNone) && ck(eBoth), `${eNone?.msg.slice(-200)} | ${eBoth?.msg.slice(-200)}`);
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: orderIds }, reversesId: { not: null } } });
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds }, reversesId: { not: null } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }], reversesId: { not: null } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }] } });
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
