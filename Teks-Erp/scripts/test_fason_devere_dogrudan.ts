// =============================================================================
// FASON DEVERE — K1: iplik tedarikçiden DOĞRUDAN devereciye (D4c; plan PLAN-devere-fason-1117 §10 D4c)
// =============================================================================
// Mal kabul fişi `directWarpingOrderId` → her iplik satırı aynı tx'te IN + devere sevki (SUBCONTRACT_OUT, aynı lot).
//   A  doğrudan kabul: depo net 0 · deverecide +kg · sipariş sevk toplamı · lot/tedarikçi/fiyat izi · OPEN → IN_PROGRESS
//   B  ön-uçuş: plan dışı iplik 400 · kumaş satırı 400 · başlık doğmaz · iptal sipariş 409 · devere kapalı 403
//   C  lot kuralı (SINGLE_LOT 409 → satır düşer, IN de yok; WARN uyarı) · tek sahip (emanet lot 409, IN yok)
//   D  yetki: satır ekleme / iptal fail-closed 403 (fiş canlı kalır)
//   E  fiş iptali → bağlı sevk tersine (depo net 0, deverecide 0, sipariş OPEN) · iade alınmışsa 409 (LIFO) · storno sonrası serbest
//   F  elle sevk iptali sonrası fiş iptali serbest (bağlı canlı sevk yok)
//   G  replay: aynı token aynı fiş (ikinci sevk doğmaz) · farklı sipariş aynı token 409
//   H  yarış: iki fişten aynı siparişe eşzamanlı → ikisi de geçer, OPEN→IN_PROGRESS tek kez · fiş iptali ‖ elle sevk iptali → tek ters kayıt
//   DB seddi: kaynak fiş bağı devere başlığı olmadan `subcontractor_dispatches_receipt_warping_ck` reddeder
// NEGATİF SONDA (koşuldu 2026-11-18): bkz. arşiv notu "Fason devere D4c".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { cancelYarnReturn, returnYarn } from "../src/services/subcontractor-yarn.service";
import { yarnMovementSign } from "../src/services/helpers/yarn-sign.helper";
import { goodsReceiptService, type GoodsReceiptLineInput } from "../src/services/goods-receipt.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { cancelWarpingOrder } from "../src/services/warping-order/cancel";
import { previewWarpingDispatch } from "../src/services/warping-order/dispatch";
import { cancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDD-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 110)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
type Detail = { id: string; receiptNo: string; directWarpingOrderId: string | null; directDispatches: Array<{ id: string; dispatchNo: string; cancelledAt: Date | null }>; failed: Array<{ reason: string }> };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE — TEDARİKÇİDEN DOĞRUDAN (D4c) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const custA = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  if (!custA) throw new Error("Fikstür eksik: MUS-001 (npm run seed:fixtures)");
  const supplier = await prisma.customer.create({ data: { code: `${TAG}-TED`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" }, select: { id: true } });

  const itemIds: string[] = [];
  const orderIds: string[] = [];
  const receiptIds: string[] = [];
  let specId = "";
  try {
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.EMANET_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "WARN");
    await reconcileReasonPresets();

    // ── Fikstür ─────────────────────────────────────────────────────────
    const mkItem = async (k: string, itemType: "YARN" | "FABRIC", den: number | null = 150) => {
      const y = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}`, itemType, unit: itemType === "YARN" ? "KG" : "MT", linearDensityDen: itemType === "YARN" ? den : null }, select: { id: true } });
      itemIds.push(y.id);
      return y.id;
    };
    const X = await mkItem("X", "YARN");
    const Y = await mkItem("Y", "YARN");
    const W = await mkItem("W", "YARN"); // plan dışı
    const F = await mkItem("F", "FABRIC");
    // Emanet lot (müşteri A'nın) — aynı lot no ile gelen tedarik satırı bu lota upsert olur → tek sahip kapısı.
    await prisma.yarnLot.create({ data: { itemId: Y, lotNo: `${TAG}-EA`, ownerCustomerId: custA.id } });
    const spec = await prisma.warpSpec.create({
      data: { code: `${TAG}-XY`, name: `${TAG} kart`, yarnItemId: X, endsCount: 5400, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }] } },
      select: { id: true },
    });
    specId = spec.id;
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const receive = async (directWarpingOrderId: string | null, lines: GoodsReceiptLineInput[], extra: { clientToken?: string } = {}) => {
      const r = await goodsReceiptService.create({ warehouseId: whId, supplierId: supplier.id, deliveryNoteNo: `${TAG}-IRS`, currency: "USD", directWarpingOrderId, lines, ...extra }, U);
      const d = r.data as Detail;
      if (!receiptIds.includes(d.id)) receiptIds.push(d.id);
      return { ...r, data: d };
    };
    const depoNet = async (itemId: string) => {
      const rows = await prisma.yarnMovement.findMany({ where: { itemId, warehouseId: whId }, select: { kind: true, qtyKg: true } });
      return rows.reduce((a, r) => a.plus(new Prisma.Decimal(r.qtyKg).mul(yarnMovementSign(r.kind))), new Prisma.Decimal(0)).toFixed(3);
    };
    const statusOf = async (id: string) => (await prisma.warpingOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    const atSub = async (orderId: string) => Object.fromEntries((await previewWarpingDispatch(orderId)).yarns.map((y) => [y.yarnItemId, `${y.dispatchedKg}/${y.atSubcontractorKg}`]));
    const receiptStatus = async (id: string) => (await prisma.goodsReceipt.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

    // ── A · doğrudan kabul ──────────────────────────────────────────────
    const O1 = await newOrder();
    const r1 = await receive(O1, [
      { itemId: X, initialQty: 30, lotNo: `${TAG}-LX1`, unitPrice: 2.5 },
      { itemId: Y, initialQty: 20, lotNo: `${TAG}-LY1` },
    ]);
    check("A1 fiş doğdu, sipariş bağı yazıldı, satır düşmedi", r1.data.directWarpingOrderId === O1 && r1.data.failed.length === 0, JSON.stringify(r1.data.failed));
    check("A2 depo etkisi net 0 (X ve Y)", (await depoNet(X)) === "0.000" && (await depoNet(Y)) === "0.000", `${await depoNet(X)} / ${await depoNet(Y)}`);
    const ds1 = await prisma.subcontractorDispatch.findMany({
      where: { goodsReceiptId: r1.data.id },
      select: { id: true, warpingOrderId: true, subcontractorId: true, cancelledAt: true, items: { select: { yarnItemId: true, lotId: true, dispatchedQty: true, warehouseId: true } } },
    });
    check("A3 her iplik satırı için devere sevki (2 sevk, sipariş + devereci doğru)", ds1.length === 2 && ds1.every((d) => d.warpingOrderId === O1 && d.subcontractorId === sub.id && !d.cancelledAt));
    check("A4 fiş detayı bağlı sevkleri listeler", r1.data.directDispatches.length === 2);
    const s1 = await atSub(O1);
    check("A5 sipariş sevk toplamı + deverecide bakiye: X 30, Y 20", s1[X] === "30.000/30.000" && s1[Y] === "20.000/20.000", JSON.stringify(s1));
    check("A6 sipariş OPEN → IN_PROGRESS", (await statusOf(O1)) === WarpingOrderStatus.IN_PROGRESS);
    const inX = await prisma.yarnMovement.findFirst({ where: { itemId: X, goodsReceiptId: r1.data.id, kind: YarnMovementKind.IN }, select: { lotId: true, unitPrice: true, lot: { select: { supplierId: true, lotNo: true } } } });
    const outX = ds1.flatMap((d) => d.items).find((i) => i.yarnItemId === X);
    check("A7 lot/tedarikçi/fiyat izi: IN lotu = sevk lotu, lot tedarikçisi fişinki, fiyat 2.5", !!inX && inX.lotId === outX?.lotId && inX.lot?.supplierId === supplier.id && String(inX.unitPrice) === "2.5" && outX?.warehouseId === whId,
      JSON.stringify({ inLot: inX?.lotId, outLot: outX?.lotId, sup: inX?.lot?.supplierId, price: String(inX?.unitPrice) }));
    const aud = await prisma.systemLog.count({ where: { tableName: "SUBCONTRACTOR_DISPATCH", recordId: { in: ds1.map((d) => d.id) }, action: "CREATE" } });
    check("A8 her sevk audit'e yazıldı (ayak izi)", aud === 2, String(aud));

    // ── B · ön-uçuş ─────────────────────────────────────────────────────
    const before = await prisma.goodsReceipt.count({ where: { deliveryNoteNo: `${TAG}-IRS` } });
    const eOff = await errOf(() => receive(O1, [{ itemId: W, initialQty: 5 }]));
    check("B1 plan dışı iplik → 400 WARPING_YARN_NOT_IN_PLAN", eOff?.status === 400 && eOff.code === "WARPING_YARN_NOT_IN_PLAN", show(eOff));
    const eFab = await errOf(() => receive(O1, [{ itemId: F, initialQty: 50 }]));
    check("B2 kumaş satırı → 400 DIRECT_WARPING_YARN_ONLY", eFab?.status === 400 && eFab.code === "DIRECT_WARPING_YARN_ONLY", show(eFab));
    check("B3 reddedilen fişlerin başlığı doğmadı", (await prisma.goodsReceipt.count({ where: { deliveryNoteNo: `${TAG}-IRS` } })) === before);
    const Oc = await newOrder();
    await cancelWarpingOrder(Oc, `${TAG} iptal`, U);
    const eCan = await errOf(() => receive(Oc, [{ itemId: X, initialQty: 5 }]));
    check("B4 iptal edilmiş siparişe doğrudan kabul → 409", eCan?.status === 409 && eCan.code === "WARPING_ORDER_NOT_DISPATCHABLE", show(eCan));
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const eMod = await errOf(() => receive(O1, [{ itemId: X, initialQty: 5 }]));
    check("B5 devere modülü kapalı → 403 MODULE_DISABLED (ya da lisans kapısı)", eMod?.status === 403, show(eMod));
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");

    // ── C · lot kuralı + tek sahip (sevk düşerse IN de yok) ─────────────
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "SINGLE_LOT");
    const c1 = await goodsReceiptService.addLines(r1.data.id, [{ itemId: X, initialQty: 7, lotNo: `${TAG}-LX2` }], U, { directWarpingAllowed: true });
    const lx2 = await prisma.yarnLot.findFirst({ where: { itemId: X, lotNo: `${TAG}-LX2` }, select: { id: true } });
    check("C1 SINGLE_LOT: ikinci lot satırı düşer (failed), IN de lot da doğmaz", c1.failed.length === 1 && /tek lot/.test(c1.failed[0]!.reason) && !lx2 && (await depoNet(X)) === "0.000", JSON.stringify(c1.failed));
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "WARN");
    const c2 = await goodsReceiptService.addLines(r1.data.id, [{ itemId: X, initialQty: 7, lotNo: `${TAG}-LX3` }], U, { directWarpingAllowed: true });
    check("C2 WARN: ikinci lot geçer + uyarı döner, depo net 0", c2.failed.length === 0 && (c2.directWarpingWarnings?.length ?? 0) > 0 && (await depoNet(X)) === "0.000", JSON.stringify(c2.directWarpingWarnings));
    const c3 = await goodsReceiptService.addLines(r1.data.id, [{ itemId: Y, initialQty: 4, lotNo: `${TAG}-EA` }], U, { directWarpingAllowed: true });
    const eaIn = await prisma.yarnMovement.count({ where: { itemId: Y, lot: { lotNo: `${TAG}-EA` } } });
    check("C3 tek sahip: emanet lot fabrika malı siparişe → satır düşer, IN yok", c3.failed.length === 1 && eaIn === 0, JSON.stringify(c3.failed));

    // ── D · yetki fail-closed ───────────────────────────────────────────
    const eNoPerm = await errOf(() => goodsReceiptService.addLines(r1.data.id, [{ itemId: X, initialQty: 1, lotNo: `${TAG}-LX1` }], U));
    check("D1 satır ekleme: devere sevk yetkisi verilmeden → 403", eNoPerm?.status === 403 && eNoPerm.code === "PERMISSION_DENIED", show(eNoPerm));
    const eNoCancel = await errOf(() => goodsReceiptService.cancel(r1.data.id, `${TAG} iptal`, U));
    check("D2 fiş iptali: devere iptal yetkisi olmadan → 403, fiş ACTIVE, sevkler canlı", eNoCancel?.status === 403 && (await receiptStatus(r1.data.id)) === "ACTIVE" && (await prisma.subcontractorDispatch.count({ where: { goodsReceiptId: r1.data.id, cancelledAt: null } })) === 3, show(eNoCancel));

    // ── E · fiş iptali → sevk tersine (LIFO) ────────────────────────────
    const dX1 = ds1.find((d) => d.items[0]?.yarnItemId === X)!;
    const itemX1 = await prisma.subcontractorDispatchItem.findFirstOrThrow({ where: { dispatchId: dX1.id }, select: { id: true } });
    const ret = await returnYarn(dX1.id, { dispatchItemId: itemX1.id, qtyKg: 5, reasonCode: "KALAN_IPLIK" }, U);
    const eLifo = await errOf(() => goodsReceiptService.cancel(r1.data.id, `${TAG} iptal`, U, { warpingCancelAllowed: true }));
    check("E1 sevkten iade alınmışsa fiş iptali → 409 YARN_ITEM_RETURNED, fiş ACTIVE", eLifo?.status === 409 && eLifo.code === "YARN_ITEM_RETURNED" && (await receiptStatus(r1.data.id)) === "ACTIVE", show(eLifo));
    check("E2 reddedilen iptal hiçbir sevki düşürmedi", (await prisma.subcontractorDispatch.count({ where: { goodsReceiptId: r1.data.id, cancelledAt: null } })) === 3);
    await cancelYarnReturn(dX1.id, { dispatchItemId: itemX1.id, movementId: ret.data.movementId, reason: `${TAG} storno` }, U);
    const cr = await goodsReceiptService.cancel(r1.data.id, `${TAG} iptal`, U, { warpingCancelAllowed: true });
    const crData = cr.data as { directDispatchesCancelled: Array<{ dispatchId: string }> };
    check("E3 iade stornosu sonrası fiş iptali geçer; 3 bağlı sevk iptal", (await receiptStatus(r1.data.id)) === "CANCELLED" && crData.directDispatchesCancelled.length === 3 && (await prisma.subcontractorDispatch.count({ where: { goodsReceiptId: r1.data.id, cancelledAt: null } })) === 0);
    check("E4 iptal sonrası depo net 0 (eksiye düşmedi)", (await depoNet(X)) === "0.000" && (await depoNet(Y)) === "0.000", `${await depoNet(X)} / ${await depoNet(Y)}`);
    const s2 = await atSub(O1);
    check("E5 deverecide bakiye 0, sevk toplamı iptallerle düştü; sipariş OPEN", s2[X] === "0.000/0.000" && s2[Y] === "0.000/0.000" && (await statusOf(O1)) === WarpingOrderStatus.OPEN, JSON.stringify(s2));
    const oc = await prisma.yarnMovement.count({ where: { itemId: X, kind: YarnMovementKind.SUBCONTRACT_OUT_CANCEL } });
    check("E6 ileri kayıtlar duruyor, ters kayıtlar bugüne (X: 2 OUT_CANCEL)", oc === 2 && (await prisma.yarnMovement.count({ where: { itemId: X, kind: YarnMovementKind.SUBCONTRACT_OUT } })) === 2, String(oc));

    // ── F · elle sevk iptali sonrası fiş iptali serbest ─────────────────
    const O2 = await newOrder();
    const r2 = await receive(O2, [{ itemId: X, initialQty: 12, lotNo: `${TAG}-LX1` }]);
    const d2 = r2.data.directDispatches[0]!;
    await cancelWarpingDispatch(O2, d2.id, `${TAG} elle`, U);
    check("F1 elle sevk iptali → iplik fişin deposunda (net +12)", (await depoNet(X)) === "12.000", await depoNet(X));
    const cr2 = await goodsReceiptService.cancel(r2.data.id, `${TAG} iptal`, U);
    check("F2 bağlı canlı sevk yokken fiş iptali yetkisiz de geçer, depo net 0", (await receiptStatus(r2.data.id)) === "CANCELLED" && (cr2.data as { directDispatchesCancelled: unknown[] }).directDispatchesCancelled.length === 0 && (await depoNet(X)) === "0.000");

    // ── G · replay ──────────────────────────────────────────────────────
    const O3 = await newOrder();
    const tok = randomUUID();
    const g1 = await receive(O3, [{ itemId: X, initialQty: 9, lotNo: `${TAG}-LX1` }], { clientToken: tok });
    const g2 = await receive(O3, [{ itemId: X, initialQty: 9, lotNo: `${TAG}-LX1` }], { clientToken: tok });
    check("G1 aynı token → aynı fiş, ikinci sevk doğmaz", g1.data.id === g2.data.id && (await prisma.subcontractorDispatch.count({ where: { goodsReceiptId: g1.data.id } })) === 1);
    const eCol = await errOf(() => receive(O2, [{ itemId: X, initialQty: 9, lotNo: `${TAG}-LX1` }], { clientToken: tok }));
    check("G2 aynı token farklı sipariş → 409", eCol?.status === 409, show(eCol));

    // ── H · yarış ───────────────────────────────────────────────────────
    const O4 = await newOrder();
    const [ha, hb] = await Promise.allSettled([
      receive(O4, [{ itemId: X, initialQty: 3, lotNo: `${TAG}-LX1` }]),
      receive(O4, [{ itemId: X, initialQty: 4, lotNo: `${TAG}-LX1` }]),
    ]);
    const okA = ha.status === "fulfilled" ? ha.value : null;
    const okB = hb.status === "fulfilled" ? hb.value : null;
    const nos = [...(okA?.data.directDispatches ?? []), ...(okB?.data.directDispatches ?? [])].map((d) => d.dispatchNo);
    check("H1 iki fişten aynı siparişe eşzamanlı → ikisi de geçer, sevk no farklı", !!okA && !!okB && okA.data.failed.length === 0 && okB.data.failed.length === 0 && nos.length === 2 && nos[0] !== nos[1],
      `${ha.status === "rejected" ? String(ha.reason) : JSON.stringify(okA?.data.failed)} ${hb.status === "rejected" ? String(hb.reason) : JSON.stringify(okB?.data.failed)}`.slice(0, 240));
    const open4 = await prisma.systemLog.count({ where: { tableName: "WARPING_ORDER", recordId: O4, action: "UPDATE" } });
    check("H2 OPEN → IN_PROGRESS geçişi tek kez (audit 1)", open4 === 1, String(open4));
    if (okA) {
      const dA = okA.data.directDispatches[0]!;
      const race = await Promise.allSettled([
        goodsReceiptService.cancel(okA.data.id, `${TAG} yarış`, U, { warpingCancelAllowed: true }),
        cancelWarpingDispatch(O4, dA.id, `${TAG} yarış`, U),
      ]);
      const outCancels = await prisma.yarnMovement.count({ where: { dispatchItem: { dispatchId: dA.id }, kind: YarnMovementKind.SUBCONTRACT_OUT_CANCEL } });
      const st = await receiptStatus(okA.data.id);
      const adj = await prisma.yarnMovement.count({ where: { goodsReceiptId: okA.data.id, kind: YarnMovementKind.ADJUST_OUT } });
      const rejected = race.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason as { statusCode?: number });
      check("H3 fiş iptali ‖ elle sevk iptali → tek ters kayıt; fiş durumu ile ADJUST_OUT tutarlı; kaybeden 409",
        outCancels === 1 && ((st === "CANCELLED" && adj === 1) || (st === "ACTIVE" && adj === 0)) && rejected.every((e) => e.statusCode === 409),
        `outCancel=${outCancels} st=${st} adj=${adj} rej=${rejected.map((e) => e.statusCode).join(",")}`);
    }

    // ── DB seddi ────────────────────────────────────────────────────────
    // Başlık dokuma koluna çevrilir (header_ck geçer) ama fiş bağı kalır → yalnız receipt_warping_ck reddedebilir (CHECK, FK'dan önce).
    const eCk = await errOf(() => prisma.$executeRawUnsafe(`UPDATE subcontractor_dispatches SET "warpingOrderId" = NULL, "weavingOrderId" = $1::uuid WHERE id = $2::uuid`, randomUUID(), ds1[0]!.id));
    check("DB seddi: fiş bağlı başlık devere kolundan çıkarılamaz → receipt_warping_ck reddeder", !!eCk && /subcontractor_dispatches_receipt_warping_ck/.test(eCk.msg), eCk?.msg.slice(0, 160));
  } finally {
    const ds = await prisma.subcontractorDispatch.findMany({ where: { OR: [{ goodsReceiptId: { in: receiptIds } }, { warpingOrderId: { in: orderIds } }] }, select: { id: true } });
    const dids = ds.map((d) => d.id);
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...receiptIds] } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } }).catch(() => undefined);
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...receiptIds] } } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
    await prisma.yarnLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.customer.delete({ where: { id: supplier.id } }).catch(() => undefined);
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
