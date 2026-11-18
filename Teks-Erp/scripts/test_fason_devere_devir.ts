// =============================================================================
// FASON DEVERE — kapanış dışı İADE · siparişler arası AKTARMA · DEVREDEN bakiye · deverecide okuyucusu (D4b-2)
// =============================================================================
// Kabul fikstürü: kart x/y/z (3000×150, 2400×150, 1800×300 den), 1×1000 m → plan 50 / 40 / 60 kg (fire yok).
//   S11  iade (sarmalayıcı): depo +kg, tutma düşer · tutmayı aşan iade 400 · iplik kapalı 403 MODULE_DISABLED
//   S19  iade stornosu: tutma geri · çift storno 409
//   AKT  aktarma A→B: hedef OPEN → IN_PROGRESS · iki siparişin tutması/önerisi · tutmayı aşan 400 (eksi bakiye kapısı)
//        · plan dışı / başka devereci / aynı sipariş 400 · replay (aynı yanıt, farklı gövde 409) · eski iade ucu tavanı
//   LIFO aktarılmış kalemin sevk iptali 409 · aktarılan iade edilince storno 409 · geri aktarım stornosu → asıl storno →
//        hedef OPEN · çift storno 409
//   DEV  devreden bakiye: COMPLETED (fikstürde doğrudan) siparişin tutması yeni siparişin önerisini düşer; emanet ayrı
//        sahip · Çözgü Hesabı "deverecide" = sahipsiz COMPLETED tutma · kapanmış siparişten aktarma ve iade
//   OKU  deverecide okuyucusu fasoncu × iplik × lot, sipariş kırılımı; Σ tutma = kalemin açık bakiyesi
//   Yarış iki eşzamanlı aktarma tutmayı birlikte aşamaz · iki eşzamanlı iade aynı kalemi birlikte aşamaz
//   DB   CHECK (tür ⇔ ters bağ, kg > 0, kaynak ≠ hedef) · çift ters unique · uçların `requireIplikEnabled`'ı
//   MSG  devere insan metninde sayı ölçü sınıfı (ayırıcısız, ondalık virgül; `details` makine biçimi) + ham biçim taraması
// NEGATİF SONDA (koşuldu 2026-11-18): bkz. arşiv notu "Fason devere D4b-2".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_DYE_HOUSE, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { returnYarn, returnYarnTx } from "../src/services/subcontractor-yarn.service";
import { calculateWarpPlan } from "../src/services/warp-plan.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, previewWarpingDispatch, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch, previewCancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { previewWarpingTransfer, transferWarpingYarn, type WarpingTransferLineInput } from "../src/services/warping-order/yarn-transfer";
import { cancelWarpingTransfer, previewCancelWarpingTransfer } from "../src/services/warping-order/yarn-transfer-cancel";
import { cancelWarpingYarnReturn, listWarpingYarnHoldings, returnWarpingYarn, warpingYarnAtSubcontractors } from "../src/services/warping-order/yarn-return";
import { pctText, qtyText } from "../src/services/helpers/warping-message.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDD-${process.pid}`;
type Err = { status?: number; code?: string; msg: string; details?: Record<string, unknown> };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } & Record<string, unknown>; message?: string; code?: string };
    return { status: x.statusCode, code: x.details?.code ?? x.code, msg: String(x.message ?? e), details: x.details };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 120)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
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
  console.log("=== FASON DEVERE DEVİR · İADE · AKTARMA (D4b-2) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sub2 = await ensureTestSubcontractor(TEST_DYE_HOUSE);
  const whId = await fixtureWarehouseId();
  const custA = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  if (!custA) throw new Error("Fikstür eksik: MUS-001 (npm run seed:fixtures)");

  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  let specId = "";
  try {
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.EMANET_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "WARN");
    await reconcileReasonPresets();

    // ── Fikstür ─────────────────────────────────────────────────────────
    const mkYarn = async (k: string, den: number) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: den }, select: { id: true } });
      yarnIds.push(y.id);
      return y.id;
    };
    const X = await mkYarn("X", 150);
    const Y = await mkYarn("Y", 150);
    const Z = await mkYarn("Z", 300);
    const W = await mkYarn("W", 150); // plan dışı
    const mkLot = async (itemId: string, k: string, ownerCustomerId: string | null = null) => {
      const l = await prisma.yarnLot.create({ data: { itemId, lotNo: `${TAG}-${k}`, ownerCustomerId }, select: { id: true } });
      lotIds.push(l.id);
      return l.id;
    };
    const stockIn = (itemId: string, lotId: string | null, qtyKg: number) =>
      prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg, lotId, reason: `${TAG} giriş` }));
    const xL1 = await mkLot(X, "XL1");
    const yL1 = await mkLot(Y, "YL1");
    const yEA = await mkLot(Y, "YEA", custA.id);
    await stockIn(X, xL1, 200);
    await stockIn(Y, yL1, 200);
    await stockIn(Y, yEA, 100);
    await stockIn(W, null, 100);
    const spec = await prisma.warpSpec.create({
      data: {
        code: `${TAG}-XYZ`, name: `${TAG} kart`, yarnItemId: X, endsCount: 7200,
        yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }, { yarnItemId: Z, endsCount: 1800, sortOrder: 2 }] },
      },
      select: { id: true },
    });
    specId = spec.id;
    const newOrder = async (subcontractorId = sub.id) => {
      const r = await createWarpingOrder({ subcontractorId, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, lines: WarpingDispatchLineInput[]) => dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines }, U);
    const move = (from: string, to: string, lines: WarpingTransferLineInput[], clientToken: string = randomUUID()) => transferWarpingYarn(from, { clientToken, toWarpingOrderId: to, lines }, U);
    const statusOf = async (id: string) => (await prisma.warpingOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    const holds = async (orderId: string, yarn: string) =>
      (await listWarpingYarnHoldings(orderId)).filter((h) => h.yarnItemId === yarn).reduce((s, h) => s + Number(h.holdingKg), 0);
    const pv = async (id: string, yarn: string) => (await previewWarpingDispatch(id)).yarns.find((y) => y.yarnItemId === yarn)!;
    const depo = async (itemId: string, lotId: string | null) =>
      Number((await prisma.yarnStock.findFirst({ where: { itemId, warehouseId: whId }, select: { balanceKg: true } }))?.balanceKg ?? 0) + (lotId ? 0 : 0);
    const complete = (id: string) => prisma.warpingOrder.update({ where: { id }, data: { status: WarpingOrderStatus.COMPLETED, completedAt: new Date(), completedById: U } });

    // ── S11 / S19 iade + storno ─────────────────────────────────────────
    const A = await newOrder();
    const dA = await send(A, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 30 }, { yarnItemId: Y, warehouseId: whId, lotId: yL1, qtyKg: 20 }]);
    const itX = dA.yarnItems.find((i) => i.yarnItemId === X)!.dispatchItemId;
    const itY = dA.yarnItems.find((i) => i.yarnItemId === Y)!.dispatchItemId;
    const depoX0 = await depo(X, xL1);
    const r1 = await returnWarpingYarn(A, { dispatchItemId: itX, qtyKg: 5, reasonCode: R }, U);
    check("S11a iade: depo +5, A'nın X tutması 25", (await depo(X, xL1)) === depoX0 + 5 && (await holds(A, X)) === 25 && r1.holdingKg === "25.000", `${await depo(X, xL1)} ${await holds(A, X)}`);
    const eOver = await errOf(() => returnWarpingYarn(A, { dispatchItemId: itX, qtyKg: 25.001, reasonCode: R }, U));
    check("S11b tutmayı aşan iade → 400 YARN_RETURN_EXCEEDS", eOver?.status === 400 && eOver.code === "YARN_RETURN_EXCEEDS", show(eOver));
    check("MSGa iade aşım metni Türkçe sayı biçiminde (tutulan 25 kg, iade 25,001 kg); details makine biçiminde", !!eOver?.msg.includes("(tutulan 25 kg, iade 25,001 kg)") && eOver?.details?.holdingKg === "25.000", show(eOver));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const eMod = await errOf(() => returnWarpingYarn(A, { dispatchItemId: itX, qtyKg: 1, reasonCode: R }, U));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    check("S11c iplik kapalı → iade 403 MODULE_DISABLED (tek yazarın kapısı)", eMod?.status === 403 && eMod.code === "MODULE_DISABLED", show(eMod));
    await cancelWarpingYarnReturn(A, r1.movementId, `${TAG} storno`, U);
    check("S19a iade stornosu: tutma 30'a döner, depo geri", (await holds(A, X)) === 30 && (await depo(X, xL1)) === depoX0);
    const eDbl = await errOf(() => cancelWarpingYarnReturn(A, r1.movementId, `${TAG} storno`, U));
    check("S19b çift iade stornosu → 409 YARN_RETURN_NOT_OPEN", eDbl?.status === 409 && eDbl.code === "YARN_RETURN_NOT_OPEN", show(eDbl));

    // ── Aktarma A → B ───────────────────────────────────────────────────
    const B = await newOrder();
    const C = await newOrder(sub2.id);
    const pre = await previewWarpingTransfer(A, { toWarpingOrderId: B, lines: [{ yarnItemId: X, qtyKg: 10 }] });
    check("AKTa önizleme yazmaz: tek kalem 10 kg, B hâlâ OPEN", pre.allocations.length === 1 && pre.totalKg === "10.000" && (await statusOf(B)) === WarpingOrderStatus.OPEN, pre.totalKg);
    const tok = randomUUID();
    const t1 = await move(A, B, [{ yarnItemId: X, qtyKg: 10 }], tok);
    check("AKTb aktarma: A tutar 20, B tutar 10, B OPEN → IN_PROGRESS", (await holds(A, X)) === 20 && (await holds(B, X)) === 10 && (await statusOf(B)) === WarpingOrderStatus.IN_PROGRESS);
    check("AKTb stok hareketi yazılmadı (depo değişmedi)", (await depo(X, xL1)) === depoX0);
    const pA = await pv(A, X);
    const pB = await pv(B, X);
    check("AKTc öneri: A = 50 − (30 − 10) = 30 · B = 50 − 10 = 40", pA.suggestedKg === "30.000" && pB.suggestedKg === "40.000" && pB.transferInKg === "10.000" && pA.transferOutKg === "10.000" && pB.dispatchedKg === "0.000", `${pA.suggestedKg} ${pB.suggestedKg}`);
    const rp = await move(A, B, [{ yarnItemId: X, qtyKg: 10 }], tok);
    const nT = await prisma.warpingYarnTransfer.count({ where: { fromWarpingOrderId: A } });
    check("AKTd replay: aynı token aynı belge, çift satır yok", rp.replayed && rp.batchId === t1.batchId && nT === 1, `${rp.replayed} ${nT}`);
    const eCol = await errOf(() => move(A, B, [{ yarnItemId: X, qtyKg: 11 }], tok));
    check("AKTd replay: aynı token farklı gövde → 409 CLIENT_TOKEN_COLLISION", eCol?.status === 409 && eCol.code === "CLIENT_TOKEN_COLLISION", show(eCol));
    const eEx = await errOf(() => move(A, B, [{ yarnItemId: X, qtyKg: 20.001 }]));
    check("AKTe tutmayı aşan aktarma → 400 WARPING_TRANSFER_EXCEEDS (eksi bakiye kapısı)", eEx?.status === 400 && eEx.code === "WARPING_TRANSFER_EXCEEDS", show(eEx));
    check("MSGb aktarma aşım metni Türkçe sayı biçiminde (20 kg / 20,001 kg); details makine biçiminde", !!eEx?.msg.includes("tuttuğu 20 kg, aktarılmak istenen 20,001 kg") && eEx?.details?.availableKg === "20.000" && eEx?.details?.requestedKg === "20.001", show(eEx));
    const eOff = await errOf(() => move(A, B, [{ yarnItemId: W, qtyKg: 1 }]));
    check("AKTf plan dışı iplik → 400 WARPING_YARN_NOT_IN_PLAN", eOff?.status === 400 && eOff.code === "WARPING_YARN_NOT_IN_PLAN", show(eOff));
    const eSub = await errOf(() => move(A, C, [{ yarnItemId: X, qtyKg: 1 }]));
    check("AKTf başka devereci → 400 WARPING_TRANSFER_OTHER_SUBCONTRACTOR, hedef OPEN kalır", eSub?.status === 400 && eSub.code === "WARPING_TRANSFER_OTHER_SUBCONTRACTOR" && (await statusOf(C)) === WarpingOrderStatus.OPEN, show(eSub));
    const eSame = await errOf(() => move(A, A, [{ yarnItemId: X, qtyKg: 1 }]));
    check("AKTf aynı sipariş → 400 WARPING_TRANSFER_SAME_ORDER", eSame?.status === 400 && eSame.code === "WARPING_TRANSFER_SAME_ORDER", show(eSame));
    const eSrc = await errOf(() => move(C, B, [{ yarnItemId: X, qtyKg: 1 }]));
    check("AKTf OPEN (tutmasız) kaynak → 409 WARPING_TRANSFER_SOURCE_STATUS", eSrc?.status === 409 && eSrc.code === "WARPING_TRANSFER_SOURCE_STATUS", show(eSrc));
    const eLegacy = await errOf(() => returnYarn(dA.dispatch.id, { dispatchItemId: itX, qtyKg: 20.001, reasonCode: R }, U));
    check("AKTg eski iade ucu tavanı aktarılanı düşer → 400 YARN_RETURN_EXCEEDS", eLegacy?.status === 400 && eLegacy.code === "YARN_RETURN_EXCEEDS", show(eLegacy));

    // ── LIFO ─────────────────────────────────────────────────────────────
    const cpv = await previewCancelWarpingDispatch(A, dA.dispatch.id);
    const eDc = await errOf(() => cancelWarpingDispatch(A, dA.dispatch.id, `${TAG} iptal`, U));
    check("LIFOa aktarılmış kalemli sevk iptali → 409 YARN_ITEM_TRANSFERRED (önizleme engelli)", eDc?.status === 409 && eDc.code === "YARN_ITEM_TRANSFERRED" && !cpv.canCancel, show(eDc));
    const rB = await returnWarpingYarn(B, { dispatchItemId: itX, qtyKg: 4, reasonCode: R }, U);
    check("LIFOb aktarımla gelen kalemden iade: geri aktarım + iade; B 6, A 20", !!rB.backTransferBatchId && (await holds(B, X)) === 6 && (await holds(A, X)) === 20, `${await holds(B, X)} ${await holds(A, X)}`);
    const tpv = await previewCancelWarpingTransfer(A, t1.batchId);
    const eTc = await errOf(() => cancelWarpingTransfer(A, t1.batchId, `${TAG} storno`, U));
    check("LIFOc hedef aktarılanı artık tutmuyor → storno 409 WARPING_TRANSFER_CONSUMED (önizleme engelli)", eTc?.status === 409 && eTc.code === "WARPING_TRANSFER_CONSUMED" && !tpv.canCancel, show(eTc));
    await cancelWarpingYarnReturn(B, rB.movementId, `${TAG} storno`, U);
    check("LIFOd iade stornosu ipliği kalemin KENDİ siparişine döndürür: A 24, B 6", (await holds(A, X)) === 24 && (await holds(B, X)) === 6);
    await cancelWarpingTransfer(B, rB.backTransferBatchId!, `${TAG} storno`, U);
    check("LIFOe geri aktarım stornosu: A 20, B 10", (await holds(A, X)) === 20 && (await holds(B, X)) === 10);
    const tc = await cancelWarpingTransfer(A, t1.batchId, `${TAG} storno`, U);
    check("LIFOf asıl aktarma stornosu: A 30, B 0, B → OPEN (sevksiz, aktarmasız)", (await holds(A, X)) === 30 && (await holds(B, X)) === 0 && tc.targetStatus === WarpingOrderStatus.OPEN && (await statusOf(B)) === WarpingOrderStatus.OPEN, tc.targetStatus);
    const eTc2 = await errOf(() => cancelWarpingTransfer(A, t1.batchId, `${TAG} storno`, U));
    check("LIFOg çift aktarma stornosu → 409 WARPING_TRANSFER_ALREADY_CANCELLED", eTc2?.status === 409 && eTc2.code === "WARPING_TRANSFER_ALREADY_CANCELLED", show(eTc2));
    check("LIFOh net aktarım sıfırken sevk iptali yeniden serbest (önizleme)", (await previewCancelWarpingDispatch(A, dA.dispatch.id)).canCancel);
    check("Defter: ileri satırlar değişmedi, her TRANSFER'in tek tersi var", (await prisma.warpingYarnTransfer.count({ where: { dispatchItemId: itX, kind: "TRANSFER", reversal: null } })) === 0);

    // ── Devreden bakiye ─────────────────────────────────────────────────
    const E = await newOrder();
    const dE = await send(E, [{ yarnItemId: Y, warehouseId: whId, lotId: yEA, qtyKg: 15 }]); // emanet sahipli
    await complete(A);
    await complete(E);
    const D = await newOrder();
    const dX = await pv(D, X);
    const dY = await pv(D, Y);
    check("DEVa yeni siparişte devreden X 30 → öneri 50 − 30 = 20", dX.carryOverKg === "30.000" && dX.suggestedKg === "20.000", `${dX.carryOverKg} ${dX.suggestedKg}`);
    check("DEVb devreden Y yalnız fabrika malı (emanet 15 hariç): 20 → öneri 20", dY.carryOverKg === "20.000" && dY.suggestedKg === "20.000", `${dY.carryOverKg} ${dY.suggestedKg}`);
    const calc = await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1000, fixedWasteM: 0, subcontractorId: sub.id });
    const fy = Object.fromEntries((calc.data?.forward?.lines ?? []).map((y) => [y.yarnItemId, y.fasondaKg]));
    check("DEVc Çözgü Hesabı 'deverecide' = sahipsiz COMPLETED tutma: X 30 · Y 20 · Z 0", fy[X] === 30 && fy[Y] === 20 && fy[Z] === 0 && calc.data?.forward?.lines.find((l) => l.yarnItemId === X)?.sendKg === 20, JSON.stringify(fy));
    const calc2 = await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1000, fixedWasteM: 0, subcontractorId: sub2.id });
    check("DEVc başka devereci seçilince 'deverecide' 0", (calc2.data?.forward?.lines ?? []).every((y) => y.fasondaKg === 0) && (calc2.data?.forward?.lines.length ?? 0) === 3);
    await move(A, D, [{ yarnItemId: X, qtyKg: 12 }]);
    const dX2 = await pv(D, X);
    check("DEVd kapanmış siparişten aktarma: D gelen 12, devreden 18 → öneri 20; A COMPLETED kalır", dX2.transferInKg === "12.000" && dX2.carryOverKg === "18.000" && dX2.suggestedKg === "20.000" && (await statusOf(A)) === WarpingOrderStatus.COMPLETED, `${dX2.transferInKg} ${dX2.carryOverKg} ${dX2.suggestedKg}`);
    await returnWarpingYarn(A, { dispatchItemId: itX, qtyKg: 3, reasonCode: R }, U);
    check("DEVe kapanmış siparişten iade serbest: A X tutması 15", (await holds(A, X)) === 15);
    const eOwn = await errOf(() => move(E, D, [{ yarnItemId: Y, qtyKg: 1 }]));
    check("DEVf emanet ipliği fabrika malı tutan siparişe aktarma → 409 OWNER_MISMATCH (tek sahip KATI)", eOwn?.status === 409 && eOwn.code === "OWNER_MISMATCH", show(eOwn));

    // ── Okuyucu ─────────────────────────────────────────────────────────
    const at = await warpingYarnAtSubcontractors({ subcontractorIds: [sub.id], yarnItemIds: [X, Y] });
    const rx = at.find((r) => r.yarnItemId === X && r.lotId === xL1);
    const ry = at.filter((r) => r.yarnItemId === Y);
    check("OKUa X/XL1: 27 kg = A 15 + D 12 (sipariş kırılımı)", rx?.kg === "27.000" && rx.orders.length === 2 && rx.orders.some((o) => o.warpingOrderId === A && o.kg === "15.000") && rx.orders.some((o) => o.warpingOrderId === D && o.kg === "12.000"), JSON.stringify(rx));
    check("OKUb Y iki satır (fabrika lotu 20 · emanet lotu 15, sahibi ayrı)", ry.length === 2 && ry.some((r) => r.lotId === yL1 && r.kg === "20.000" && r.ownerCustomerId === null) && ry.some((r) => r.lotId === yEA && r.kg === "15.000" && r.ownerCustomerId === custA.id), JSON.stringify(ry.map((r) => [r.lotNo, r.kg])));
    const itemOpen = 30 - 3; // çıkış − iade (sarılan yok)
    check("OKUc Σ tutma = kalemin açık bakiyesi (aktarma stok hareketi değil)", (await holds(A, X)) + (await holds(D, X)) === itemOpen);
    const onlyDone = await warpingYarnAtSubcontractors({ subcontractorIds: [sub.id], yarnItemIds: [X], statuses: [WarpingOrderStatus.COMPLETED] });
    check("OKUd filter COMPLETED → yalnız devreden (A 15)", onlyDone.length === 1 && onlyDone[0]!.kg === "15.000", JSON.stringify(onlyDone.map((r) => r.kg)));

    // ── Yarış ───────────────────────────────────────────────────────────
    // Elle açık tutulan tx: kazanan A'yı claim edip yazar ve BEKLER; rakip o sırada başlar, kazanan commit edince TAZE okumalı.
    const G = await newOrder();
    const held = async (write: (tx: Prisma.TransactionClient) => Promise<unknown>, rival: () => Promise<unknown>) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let wrote!: () => void;
      const written = new Promise<void>((r) => { wrote = r; });
      const winner = prisma.$transaction(async (tx) => {
        await tx.warpingOrder.updateMany({ where: { id: A }, data: { updatedById: U } });
        await write(tx);
        wrote();
        await gate;
      }, { timeout: 30_000 });
      await written;
      const r = errOf(rival);
      await new Promise((res) => setTimeout(res, 400));
      release();
      await winner;
      return r;
    };
    const eRaceT = await held(
      (tx) => tx.warpingYarnTransfer.create({ data: { dispatchItemId: itX, fromWarpingOrderId: A, toWarpingOrderId: G, kind: "TRANSFER", qtyKg: 10, batchId: randomUUID(), createdById: U } }),
      () => move(A, G, [{ yarnItemId: X, qtyKg: 10 }]),
    );
    check("Yarış a: açık tx 10 kg aktarırken rakip 10 kg aktarma (tutma 15) → 400, A 5", eRaceT?.code === "WARPING_TRANSFER_EXCEEDS" && (await holds(A, X)) === 5, `${show(eRaceT)} A=${await holds(A, X)}`);
    const eRaceR = await held(
      (tx) => returnYarnTx(tx, dA.dispatch.id, { dispatchItemId: itY, qtyKg: 15, reasonCode: R }, U),
      () => returnWarpingYarn(A, { dispatchItemId: itY, qtyKg: 15, reasonCode: R }, U),
    );
    check("Yarış b: açık tx 15 kg iade ederken rakip 15 kg iade (tutma 20) → 400, A 5", eRaceR?.code === "YARN_RETURN_EXCEEDS" && (await holds(A, Y)) === 5, `${show(eRaceR)} A=${await holds(A, Y)}`);

    // ── DB seddi + kapılar ───────────────────────────────────────────────
    const base = { dispatchItemId: itX, fromWarpingOrderId: A, toWarpingOrderId: D, qtyKg: 1, batchId: randomUUID() };
    const e1 = await errOf(() => prisma.warpingYarnTransfer.create({ data: { ...base, kind: "TRANSFER", reversesId: t1.rows[0]!.transferId } }));
    const e2 = await errOf(() => prisma.warpingYarnTransfer.create({ data: { ...base, kind: "TRANSFER", qtyKg: 0 } }));
    const e3 = await errOf(() => prisma.warpingYarnTransfer.create({ data: { ...base, kind: "TRANSFER", toWarpingOrderId: A } }));
    const e4 = await errOf(() => prisma.warpingYarnTransfer.create({ data: { ...base, kind: "TRANSFER_CANCEL", reversesId: t1.rows[0]!.transferId } }));
    const e5 = await errOf(() => prisma.warpingYarnTransfer.create({ data: { ...base, kind: "MOVE" } }));
    check("DB: ters bağlı TRANSFER · kg 0 · kaynak = hedef · ikinci ters · tanınmayan tür reddedilir", [e1, e2, e3, e4, e5].every((e) => e !== null), [e1, e2, e3, e4, e5].map((e) => (e ? "✗" : "geçti")).join(","));
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order-yarn.routes.ts"), "utf8");
    const ends = ["get\\(\"/yarn-at-subcontractor\"", "get\\(\"/:id/yarn-holdings\"", "post\\(\"/:id/yarn-returns\"", "post\\(\"/:id/yarn-returns/:movementId/cancel\"", "get\\(\"/:id/yarn-transfers\"",
      "post\\(\"/:id/yarn-transfers/preview\"", "post\\(\"/:id/yarn-transfers\"", "get\\(\"/:id/yarn-transfers/:batchId/cancel-preview\"", "post\\(\"/:id/yarn-transfers/:batchId/cancel\"",
      "get\\(\"/:id/dispatches\"", "get\\(\"/:id/yarn-returns\""]; // D6-be okuma uçları
    const gated = ends.map((p) => new RegExp(`router\\.${p}[^\\n]*requireIplikEnabled`).test(routes));
    check("Modül: on bir iplik ucunun her biri `requireIplikEnabled`'ı uç başına alır (403 MODULE_DISABLED)", gated.every(Boolean) && (routes.match(/^router\.(get|post)\(/gm) ?? []).length === ends.length, JSON.stringify(gated));
    const main = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order.routes.ts"), "utf8");
    check("Modül: alt router `/:id`den önce ve devere kapısının arkasında bağlı", main.indexOf("router.use(verifyToken, requireDevereEnabled)") < main.indexOf('router.use("/", warpingOrderYarnRoutes)') && main.indexOf('router.use("/", warpingOrderYarnRoutes)') < main.indexOf('router.get("/:id"'));
    // MSG — devere metin sayı biçimi: ölçü sınıfı (ayırıcısız, ondalık virgül, sondaki sıfır yok; genel.md)
    check("MSGc qtyText/pctText: 25000.5 → \"25000,5\" · \"12.000\" → \"12\" · 0.0004 → \"0\" · \"3.250\" → \"3,25\"", qtyText(25000.5) === "25000,5" && qtyText("12.000") === "12" && qtyText(new Prisma.Decimal("1.230")) === "1,23" && qtyText(0.0004) === "0" && pctText("3.250") === "3,25", `${qtyText(25000.5)} ${qtyText("12.000")} ${pctText("3.250")}`);
    const MSG_DIRS = ["../src/services/warping-order", "../src/services/helpers"].map((d) => path.join(__dirname, d));
    const msgFiles = MSG_DIRS.flatMap((d) => fs.readdirSync(d).filter((n) => n.endsWith(".ts") && (d.endsWith("warping-order") || /^warping-/.test(n))).map((n) => path.join(d, n)))
      .concat(["warp-beam-wind.service.ts", "warp-plan.service.ts"].map((n) => path.join(__dirname, "../src/services", n)));
    // İnsan metni: AppError/uyarı/mesaj şablonu içinde ham kg biçimleyici (`kg(` · `kg3(` · `.toFixed(`) ya da `Number(` olmaz.
    const RAW_IN_MSG = /(AppError\.\w+\(|warnings\.(push|unshift)\(|out\.push\(|blockers\.push\(|message: )`[^`]*\$\{[^}`]*(\bkg3?\(|\.toFixed\(|\bNumber\()/;
    const rawHits = msgFiles.flatMap((p) => fs.readFileSync(p, "utf8").split("\n").map((l, i) => (RAW_IN_MSG.test(l) ? `${path.basename(p)}:${i + 1}` : null)).filter((x): x is string => x !== null));
    check(`MSGd devere mesajlarında ham sayı biçimi yok (${msgFiles.length} dosya; körlük zemini ≥ 20)`, msgFiles.length >= 20 && rawHits.length === 0, rawHits.join(", "));
    void dE;
  } finally {
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }], reversesId: { not: null } } });
    await prisma.warpingYarnTransfer.deleteMany({ where: { OR: [{ fromWarpingOrderId: { in: orderIds } }, { toWarpingOrderId: { in: orderIds } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: dids } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids] } } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
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
