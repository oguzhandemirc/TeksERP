// =============================================================================
// FASON DEVERE — sipariş KAPANIŞI (iade / fire / deverecide kalır) · tolerans uyarısı · yeniden açma (D5b)
// =============================================================================
// Fikstür: kart x/y/z (3000×150, 2400×150, 1800×300 den), sabit fire 50 m → 1 × 1000 m'de net 50/40/60, brüt 52,5/42/63.
//   A1-a  varsayılan önizleme: fire = min(kalan, brüt − net) FIFO, fazlası kalır; tolerans içi uyarısız
//   S12/S13 karışık kapanış (iade + fire + kalır); tolerans aşımı gerekçesiz KAPANIR, `overTolerance` + uyarı
//   Tutma okuyucuları fireyi düşer (holding, listYarnItems, eski iade tavanı, sevk iptali LIFO)
//   S22 replay (aynı yanıt; farklı gövde 409; yeniden açılmış kapanışın token'ı 409) · ikinci kapanış 409
//   Kapanmış siparişte kabul / sevk / aktarma (hedef) 409 · S14 devreden bakiye sonraki siparişin önerisinde + dağıtımda
//   S21 yeniden açma: WASTE_CANCEL + iade stornosu, IN_PROGRESS; çift yeniden açma 409; tekrar kapanış
//   Yarış: iki eşzamanlı kapanıştan biri 409 · açık tx iade tutarken kapanış claim'de bekler, TAZE tutmayla planlar
//   DB  CHECK (kg > 0, tür ⇔ ters bağ) + tek ters · uçların `requireIplikEnabled`'ı ve mount sırası
// NEGATİF SONDA (koşuldu 2026-11-18): bkz. arşiv notu "Fason devere D5b".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
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
import { listYarnItems, returnYarn } from "../src/services/subcontractor-yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, previewWarpingDispatch, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { listWarpingYarnHoldings, returnWarpingYarnTx } from "../src/services/warping-order/yarn-return";
import { transferWarpingYarn } from "../src/services/warping-order/yarn-transfer";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { previewSettleWarpingOrder, settleWarpingOrder, type WarpingSettleInput } from "../src/services/warping-order/settle";
import { listWarpingSettlements } from "../src/services/warping-order/settle-record";
import { previewReopenWarpingOrder, reopenWarpingOrder } from "../src/services/warping-order/reopen";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDK-${process.pid}`;
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
  console.log("=== FASON DEVERE KAPANIŞ (D5b) ===");
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
    const newOrder = async (tolerance: number | null = 5) => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 50, wasteTolerancePct: tolerance, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, lines: Array<[{ id: string; lot: string }, number]>) =>
      dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines: lines.map(([y, qtyKg]): WarpingDispatchLineInput => ({ yarnItemId: y.id, warehouseId: whId, lotId: y.lot, qtyKg })) }, U);
    const receive = (orderId: string, beams: WarpingReceiveBeamInput[] = [{ lengthM: 1000 }]) => receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: "IRS-K", beams }, U);
    const holds = async (orderId: string, y: { id: string }) => (await listWarpingYarnHoldings(orderId)).filter((h) => h.yarnItemId === y.id).reduce((s, h) => s + Number(h.holdingKg), 0);
    const settle = (orderId: string, body: Omit<WarpingSettleInput, "clientToken"> = {}, clientToken: string = randomUUID()) => settleWarpingOrder(orderId, { ...body, clientToken }, U);
    const status = async (id: string) => (await prisma.warpingOrder.findUniqueOrThrow({ where: { id }, select: { status: true, completedAt: true } }));
    const stockOf = async (y: { id: string; lot: string }) => n((await prisma.yarnStock.findFirst({ where: { itemId: y.id, warehouseId: whId }, select: { balanceKg: true } }))?.balanceKg);

    // ── A: X iki sevkte (30 + 30), Y 50, Z 70; 1 × 1000 m döner → tutma X 10 (d2), Y 10, Z 10 ─────
    const A = await newOrder(5);
    const d1 = await send(A, [[X, 30], [Y, 50], [Z, 70]]);
    const d2 = await send(A, [[X, 30]]);
    await receive(A);
    const itX2 = d2.yarnItems.find((i) => i.yarnItemId === X.id)!.dispatchItemId;
    const itY = d1.yarnItems.find((i) => i.yarnItemId === Y.id)!.dispatchItemId;
    const pv = await previewSettleWarpingOrder(A);
    const py = (y: { id: string }) => pv.plan.yarns.find((v) => v.yarnItemId === y.id)!;
    check("A1-a önizleme: X fire 2,5 kalır 7,5 · Y 2 / 8 · Z 3 / 7; iade 0; yazmaz", pv.canSettle && pv.plan.isDefault && py(X).wasteKg === "2.500" && py(X).keepKg === "7.500" && py(Y).wasteKg === "2.000" && py(Z).wasteKg === "3.000" && py(Z).keepKg === "7.000" && py(X).returnKg === "0.000" && (await status(A)).completedAt === null, JSON.stringify(pv.plan.yarns.map((y) => [y.code, y.wasteKg, y.keepKg])));
    check("A1-a FIFO: X firesi tutulan tek kaleme (d2) yazılır; fire % 4,76 < tolerans 5 → uyarısız", pv.plan.lines.find((l) => l.dispatchItemId === itX2)?.wasteKg === "2.500" && py(X).wastePct === "4.76" && !pv.plan.overTolerance && pv.warnings.length === 0, `${py(X).wastePct} ${JSON.stringify(pv.warnings)}`);

    // ── Karışık kapanış: X iade 4 + fire 1 (kalır 5) · Y fire 8 (kalır 2; %16,67 > 5) · Z listede yok (kalır 10) ─
    const body = { lines: [{ dispatchItemId: itX2, returnKg: 4, wasteKg: 1, returnReasonCode: R }, { dispatchItemId: itY, wasteKg: 8 }] };
    const eEx = await errOf(() => previewSettleWarpingOrder(A, { lines: [{ dispatchItemId: itY, returnKg: 5, wasteKg: 6, returnReasonCode: R }] }));
    const eRs = await errOf(() => previewSettleWarpingOrder(A, { lines: [{ dispatchItemId: itY, returnKg: 1 }] }));
    const eUk = await errOf(() => previewSettleWarpingOrder(A, { lines: [{ dispatchItemId: randomUUID(), wasteKg: 1 }] }));
    check("Gövde: iade + fire > tutulan 400 · sebepsiz iade 400 · tutulmayan kalem 400", eEx?.code === "WARPING_SETTLE_EXCEEDS" && eRs?.code === "WARPING_SETTLE_RETURN_REASON" && eUk?.code === "WARPING_SETTLE_LINE_UNKNOWN", `${show(eEx)} | ${show(eRs)} | ${show(eUk)}`);
    const pvY = await previewSettleWarpingOrder(A, { lines: [{ dispatchItemId: itY, wasteKg: 3 }] });
    const pvYy = (y: { id: string }) => pvY.plan.yarns.find((v) => v.yarnItemId === y.id)!;
    check("İplik başı tolerans: yalnız Y fire %6,98 > 5 (genel %1,96 içinde) → overTolerance + Y uyarısı, X uyarısız", pvY.plan.overTolerance && pvY.plan.wastePct === "1.96" && pvYy(Y).wastePct === "6.98" && pvYy(Y).overTolerance && !pvYy(X).overTolerance && pvY.warnings.length === 1 && pvY.warnings[0]!.includes("6.98"), `${pvY.plan.wastePct} ${pvYy(Y).wastePct} ${JSON.stringify(pvY.warnings)}`);
    const xStock0 = await stockOf(X);
    const tokA = randomUUID();
    const sA = await settle(A, body, tokA);
    const stA = await status(A);
    const wastesA = await prisma.warpingYarnWaste.findMany({ where: { warpingOrderId: A }, select: { kind: true, qtyKg: true, overTolerance: true, dispatchItemId: true, reason: true } });
    check("S13 tolerans aşımı GEREKÇESİZ kapanır: COMPLETED, overTolerance + uyarı, gerekçe boş", stA.status === "COMPLETED" && stA.completedAt !== null && sA.overTolerance && sA.reason === null && sA.warnings.some((w) => /tolerans/.test(w)) && !sA.replayed, JSON.stringify(sA.warnings));
    check("Fire defteri: X 1 (d2) + Y 8, Y satırı overTolerance; iade 4 kg depoya (lot korunur)", wastesA.length === 2 && wastesA.some((w) => w.dispatchItemId === itX2 && n(w.qtyKg) === 1) && wastesA.some((w) => w.dispatchItemId === itY && n(w.qtyKg) === 8 && w.overTolerance) && sA.totalReturnKg === "4.000" && (await stockOf(X)) === xStock0 + 4, `${JSON.stringify(wastesA.map((w) => [n(w.qtyKg), w.overTolerance]))} stok ${xStock0}→${await stockOf(X)}`);
    check("Kalır = kayıt yok: A tutması X 5 · Y 2 · Z 10 (COMPLETED siparişte açık)", (await holds(A, X)) === 5 && (await holds(A, Y)) === 2 && (await holds(A, Z)) === 10, `${await holds(A, X)} ${await holds(A, Y)} ${await holds(A, Z)}`);
    const li = await listYarnItems(prisma, d1.dispatch.id);
    check("listYarnItems kalanı fireyi düşer: d1 Y kalan 2", li.items.find((i) => i.item.id === Y.id)?.remainingKg === 2, String(li.items.find((i) => i.item.id === Y.id)?.remainingKg));
    const eOld = await errOf(() => returnYarn(d1.dispatch.id, { dispatchItemId: itY, qtyKg: 3, reasonCode: R }, U));
    check("Eski iade ucu tavanı fireyi düşer: Y 3 kg iade → 400 YARN_RETURN_EXCEEDS", eOld?.code === "YARN_RETURN_EXCEEDS", show(eOld));
    // ── Replay ───────────────────────────────────────────────────────────
    const rp = await settle(A, body, tokA);
    check("S22 replay: aynı kapanış kaydı, çift fire/iade yok", rp.replayed && rp.id === sA.id && (await prisma.warpingYarnWaste.count({ where: { warpingOrderId: A } })) === 2 && (await stockOf(X)) === xStock0 + 4);
    const eCol = await errOf(() => settle(A, { lines: [{ dispatchItemId: itY, wasteKg: 7 }] }, tokA));
    const e2nd = await errOf(() => settle(A, {}));
    check("S22 aynı token farklı gövde 409 CLIENT_TOKEN_COLLISION · yeni token ikinci kapanış 409 WARPING_ORDER_COMPLETED", eCol?.code === "CLIENT_TOKEN_COLLISION" && e2nd?.code === "WARPING_ORDER_COMPLETED", `${show(eCol)} | ${show(e2nd)}`);
    // ── Kapanmış siparişte yazma kapıları ────────────────────────────────
    const eRecv = await errOf(() => receive(A));
    const eSend = await errOf(() => send(A, [[X, 1]]));
    const B = await newOrder(null);
    const dB = await send(B, [[X, 3]]);
    const eTr = await errOf(() => transferWarpingYarn(B, { clientToken: randomUUID(), toWarpingOrderId: A, lines: [{ yarnItemId: X.id, qtyKg: 1 }] }, U));
    check("Kapanmış sipariş: kabul / sevk / aktarma (hedef) 409", eRecv?.status === 409 && eSend?.status === 409 && eTr?.status === 409, `${show(eRecv)} | ${show(eSend)} | ${show(eTr)}`);
    // ── S14 devir: B'nin önerisinde A'nın kalanı, B'nin dönüşünde önce B, sonra A ─
    const dp = await previewWarpingDispatch(B);
    const dy = (y: { id: string }) => dp.yarns.find((v) => v.yarnItemId === y.id)!;
    check("S14 devreden bakiye B önizlemesinde: X 5 · Y 2 · Z 10; öneri = brüt − gelen − devreden", dy(X).carryOverKg === "5.000" && dy(Y).carryOverKg === "2.000" && dy(Z).carryOverKg === "10.000" && dy(X).suggestedKg === "44.500" && dy(Z).suggestedKg === "53.000", JSON.stringify(dp.yarns.map((y) => [y.code, y.carryOverKg, y.suggestedKg])));
    await receive(B, [{ lengthM: 100 }]);
    check("S14 dönüş: X 5 kg nominalin 3'ü B kaleminden, 2'si A'dan (devir); Y 4 → A'nın 2'si + 2 dağıtılamaz", (await holds(B, X)) === 0 && (await holds(A, X)) === 3 && (await holds(A, Y)) === 0, `${await holds(B, X)} ${await holds(A, X)} ${await holds(A, Y)}`);
    const eDc = await errOf(() => cancelWarpingDispatch(B, dB.dispatch.id, `${TAG} iptal`, U));
    check("Devir dağıtımlı B sevki LIFO 409", eDc?.status === 409, show(eDc));
    // ── S21 yeniden açma ─────────────────────────────────────────────────
    const xBeforeReopen = await stockOf(X);
    const rpv = await previewReopenWarpingOrder(A);
    check("Yeniden açma önizlemesi: 2 fire + 1 iade listelenir, kapanış kaydı görünür", rpv.canReopen && rpv.wastesToCancel.length === 2 && rpv.returnsToCancel.length === 1 && rpv.settlement?.id === sA.id, JSON.stringify([rpv.wastesToCancel.length, rpv.returnsToCancel.length]));
    const [ro1, ro2] = await Promise.allSettled([reopenWarpingOrder(A, `${TAG} yanlış bölüşüm`, U), reopenWarpingOrder(A, `${TAG} yanlış bölüşüm`, U)]);
    const roOk = [ro1, ro2].filter((r) => r.status === "fulfilled");
    const roErr = [ro1, ro2].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    check("S21 yarış: iki yeniden açmadan biri 409 WARPING_ORDER_NOT_COMPLETED", roOk.length === 1 && (roErr?.reason as { details?: { code?: string } })?.details?.code === "WARPING_ORDER_NOT_COMPLETED");
    const st2 = await status(A);
    const cancels = await prisma.warpingYarnWaste.findMany({ where: { warpingOrderId: A, kind: "WASTE_CANCEL" }, select: { reversesId: true } });
    const retCancel = await prisma.yarnMovement.count({ where: { dispatchItemId: itX2, kind: YarnMovementKind.SUBCONTRACT_RETURN_CANCEL } });
    check("S21: IN_PROGRESS, completedAt null; WASTE_CANCEL ×2 ters bağlı; iade stornosu yazıldı, depo geri", st2.status === "IN_PROGRESS" && st2.completedAt === null && cancels.length === 2 && cancels.every((c) => c.reversesId) && retCancel === 1 && (await stockOf(X)) === xBeforeReopen - 4, `${st2.status} ${cancels.length} ${retCancel} ${xBeforeReopen}→${await stockOf(X)}`);
    check("S21 tutma geri gelir (devir sonrası): A X 3 + 1 + 4 = 8 · Y 0 + 8 = 8 · Z 4 (6 devirle B'ye)", (await holds(A, X)) === 8 && (await holds(A, Y)) === 8 && (await holds(A, Z)) === 4, `${await holds(A, X)} ${await holds(A, Y)} ${await holds(A, Z)}`);
    const eDead = await errOf(() => settle(A, body, tokA));
    check("S22 yeniden açılmış kapanışın token'ı 409 WARPING_SETTLEMENT_REOPENED", eDead?.code === "WARPING_SETTLEMENT_REOPENED", show(eDead));
    const sA2 = await settle(A, {});
    const hist = await listWarpingSettlements(A);
    check("Tekrar kapanış (varsayılan): COMPLETED; geçmiş SETTLE → REOPEN → SETTLE", (await status(A)).status === "COMPLETED" && hist.map((h) => h.kind).join(",") === "SETTLE,REOPEN,SETTLE" && hist[0]!.reopened !== null && hist[2]!.id === sA2.id, hist.map((h) => h.kind).join(","));
    await reopenWarpingOrder(A, `${TAG} temizlik`, U);

    // ── Yarış: açık tx C'nin X tutmasını iade ederken kapanış claim'de bekler, TAZE planlar ─
    const C = await newOrder(5);
    const dC = await send(C, [[X, 60], [Y, 50], [Z, 70]]);
    await receive(C);
    const itCX = dC.yarnItems.find((i) => i.yarnItemId === X.id)!.dispatchItemId;
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let inTx!: () => void;
    const entered = new Promise<void>((res) => { inTx = res; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.warpingOrder.updateMany({ where: { id: C }, data: { updatedById: U } });
      await returnWarpingYarnTx(tx, C, { dispatchItemId: itCX, qtyKg: 10, reasonCode: R }, U);
      inTx();
      await gate;
    }, { timeout: 20_000 });
    await entered;
    const racing = settle(C, {});
    await new Promise((r) => setTimeout(r, 400));
    release();
    await holder;
    const sC = await racing;
    check("Yarış a: kapanış iade tx'ini bekler, TAZE tutmayla planlar — X firesi yok (tutma 0), Y 2 + Z 3", sC.wastes.filter((w) => w.yarnItemId === X.id).length === 0 && sC.totalWasteKg === "5.000", `${sC.totalWasteKg} ${JSON.stringify(sC.wastes.map((w) => [w.code, w.qtyKg]))}`);
    const D2 = await newOrder(5);
    await send(D2, [[Y, 50]]);
    await receive(D2);
    const [s1, s2] = await Promise.allSettled([settle(D2, {}), settle(D2, {})]);
    const sOk = [s1, s2].filter((r) => r.status === "fulfilled").length;
    const sErr = [s1, s2].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    check("Yarış b: iki eşzamanlı kapanıştan biri 409, tek kapanış kaydı", sOk === 1 && (sErr?.reason as { details?: { code?: string } })?.details?.code === "WARPING_ORDER_COMPLETED" && (await prisma.warpingOrderSettlement.count({ where: { warpingOrderId: D2 } })) === 1);
    const E = await newOrder(5);
    await prisma.warpingOrder.update({ where: { id: E }, data: { status: "IN_PROGRESS" } });
    const eEmpty = await errOf(() => settle(E, {}));
    check("Sevksiz ve leventsiz sipariş kapatılamaz → 409 WARPING_SETTLE_EMPTY", eEmpty?.code === "WARPING_SETTLE_EMPTY", show(eEmpty));
    // ── DB seddi + kapılar ───────────────────────────────────────────────
    const anyWaste = await prisma.warpingYarnWaste.findFirstOrThrow({ where: { warpingOrderId: D2, kind: "WASTE" }, select: { id: true, settlementId: true, dispatchItemId: true } });
    const base = { settlementId: anyWaste.settlementId, warpingOrderId: D2, dispatchItemId: anyWaste.dispatchItemId };
    const e1 = await errOf(() => prisma.warpingYarnWaste.create({ data: { ...base, kind: "WASTE", qtyKg: 0 } }));
    const e2 = await errOf(() => prisma.warpingYarnWaste.create({ data: { ...base, kind: "WASTE_CANCEL", qtyKg: 1 } }));
    const e3 = await errOf(() => prisma.warpingOrderSettlement.create({ data: { warpingOrderId: D2, kind: "REOPEN", returnMovementIds: [], backTransferIds: [] } }));
    const reversed = await prisma.warpingYarnWaste.findFirstOrThrow({ where: { warpingOrderId: A, kind: "WASTE", reversal: { isNot: null } }, select: { id: true } });
    const e4 = await errOf(() => prisma.warpingYarnWaste.create({ data: { ...base, kind: "WASTE_CANCEL", qtyKg: 1, reversesId: reversed.id } }));
    check("DB: fire kg 0 · ters bağsız WASTE_CANCEL · ters bağsız REOPEN · ikinci ters reddedilir", [e1, e2, e3, e4].every((e) => e !== null), [e1, e2, e3, e4].map((e) => (e ? "✗" : "geçti")).join(","));
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order-settle.routes.ts"), "utf8");
    const ends = ["get\\(\"/:id/settlement-preview\"", "post\\(\"/:id/settle/preview\"", "post\\(\"/:id/settle\"", "get\\(\"/:id/settlements\"", "get\\(\"/:id/reopen-preview\"", "post\\(\"/:id/reopen\""];
    const gated = ends.map((p) => new RegExp(`router\\.${p}[^\\n]*requireIplikEnabled`).test(routes));
    const mainR = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order.routes.ts"), "utf8");
    check("Modül: altı kapanış ucu `requireIplikEnabled` uç başına; alt router devere kapısının arkasında, `/:id`den önce", gated.every(Boolean) && (routes.match(/^router\.(get|post)\(/gm) ?? []).length === ends.length
      && mainR.indexOf("router.use(verifyToken, requireDevereEnabled)") < mainR.indexOf('router.use("/", warpingOrderSettleRoutes)') && mainR.indexOf('router.use("/", warpingOrderSettleRoutes)') < mainR.indexOf('router.get("/:id"'), JSON.stringify(gated));
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
