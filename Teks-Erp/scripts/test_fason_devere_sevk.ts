// =============================================================================
// FASON DEVERE SİPARİŞİ — iplik sevki · sevk iptali · K4 lot kuralı · tek sahip · talimat (D4b-1; plan PLAN-devere-fason-1117 §10)
// =============================================================================
// Kabul fikstürü: kart x/y/z (3000×150, 2400×150, 1800×300 den), 1×1000 m → plan 50 / 40 / 60 kg (fire yok).
//   S7   önizleme önerisi 50/40/60 · kısmi sevk → önerilen düşer · ilk sevk OPEN → IN_PROGRESS (audit tek kez)
//   S10  plandan fazla sevk meşru → `warnings` · plan dışı iplik 400 · stok yetmez 4xx
//   S15  K4 lot kuralı: WARN uyarı · SINGLE_LOT 409 · FREE sessiz · `devere.lotRequired` lotsuz 400
//   S17  sevk iptali LIFO: iade alınmış kalem 409 · iade stornosu sonrası serbest · son canlı sevk düşünce → OPEN
//   S22  replay: aynı token aynı sevk · farklı gövde 409 · iptal sonrası 409 (dört durum)
//   S28  tek sahip KATI: fabrika malı + emanet 409 · iki müşterinin emaneti 409
//   Yarış: iki eşzamanlı sevk ikisi de geçer (claim sıraya sokar, belge no farklı) · iki eşzamanlı iptal → biri 409
//   Başlık: devere sevki iş emri / dokuma yollarında 409 · DB `subcontractor_dispatches_header_ck` kolsuz başlığı reddeder
//   Talimat: iç kolon (kg, fire, ücret) yok · iplik kapalı → servis 403 + dört uçta `requireIplikEnabled`
//   D2   siparişle ilk sevk: aynı tx (plan dışı/lot zorunlu → sipariş doğmaz) · replay kimliğinde ilk sevk satırları · iptal sonrası 409
// NEGATİF SONDA (koşuldu 2026-11-17): bkz. arşiv notu "Fason devere D4b-1" (CHECK 3. kol · strict · claim yüklemi).
// (2026-11-28) D2 sondası bölüm dosyasının başlığında (`lib/devere-ilk-sevk-bolum.ts`).
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
import { cancelYarnReturn, returnYarn } from "../src/services/subcontractor-yarn.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { assertWeavingBound, assertWorkOrderBound } from "../src/services/helpers/dispatch-header.helper";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder, getWarpingInstruction, previewWarpingDispatch, type WarpingDispatchLineInput } from "../src/services/warping-order/dispatch";
import { ilkSevkBolumu } from "./lib/devere-ilk-sevk-bolum";
import { cancelWarpingDispatch, previewCancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDS-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 100)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE SEVKİ (D4b-1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const custA = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  if (!custA) throw new Error("Fikstür eksik: MUS-001 (npm run seed:fixtures)");
  const custB = await prisma.customer.create({ data: { code: `${TAG}-MB`, name: `${TAG} emanet B` }, select: { id: true } });

  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const dispatchIds = new Set<string>();
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
    const xL2 = await mkLot(X, "XL2");
    const yL1 = await mkLot(Y, "YL1");
    const yEA = await mkLot(Y, "YEA", custA.id);
    const yEB = custB ? await mkLot(Y, "YEB", custB.id) : null;
    const zL1 = await mkLot(Z, "ZL1");
    await stockIn(X, xL1, 100);
    await stockIn(X, xL2, 100);
    await stockIn(Y, yL1, 100);
    await stockIn(Y, yEA, 100);
    if (yEB) await stockIn(Y, yEB, 100);
    await stockIn(Z, zL1, 100);
    await stockIn(Z, null, 100);
    await stockIn(W, null, 100);
    const spec = await prisma.warpSpec.create({
      data: {
        code: `${TAG}-XYZ`, name: `${TAG} kart`, yarnItemId: X, endsCount: 7200,
        yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }, { yarnItemId: Y, endsCount: 2400, sortOrder: 1 }, { yarnItemId: Z, endsCount: 1800, sortOrder: 2 }] },
      },
      select: { id: true },
    });
    specId = spec.id;
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = async (orderId: string, lines: WarpingDispatchLineInput[], clientToken: string = randomUUID()) => {
      const r = await dispatchWarpingOrder(orderId, { clientToken, lines }, U);
      dispatchIds.add(r.dispatch.id);
      return r;
    };
    const statusOf = async (id: string) => (await prisma.warpingOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    const suggested = async (id: string) => Object.fromEntries((await previewWarpingDispatch(id)).yarns.map((y) => [y.yarnItemId, y.suggestedKg]));

    // ── S7 önizleme + kısmi sevk + claim ─────────────────────────────────
    const O1 = await newOrder();
    const s0 = await suggested(O1);
    check("S7a önizleme önerisi x/y/z = 50 / 40 / 60 kg", s0[X] === "50.000" && s0[Y] === "40.000" && s0[Z] === "60.000", JSON.stringify(s0));
    const pv0 = await previewWarpingDispatch(O1);
    check("S7b önizleme lot kuralı WARN, depo stoğu biliniyor (X serbest 200)", pv0.lotPolicy === "WARN" && pv0.stock.known && pv0.yarns[0]?.depoKg === "200.000", `${pv0.lotPolicy} ${pv0.yarns[0]?.depoKg}`);

    const eOff = await errOf(() => send(O1, [{ yarnItemId: W, warehouseId: whId, qtyKg: 5 }]));
    check("S10a plan dışı iplik → 400 WARPING_YARN_NOT_IN_PLAN", eOff?.status === 400 && eOff.code === "WARPING_YARN_NOT_IN_PLAN", show(eOff));
    check("S10a reddedilen sevk siparişi OPEN bırakır (claim geri alındı)", (await statusOf(O1)) === WarpingOrderStatus.OPEN);

    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "true");
    const eLot = await errOf(() => send(O1, [{ yarnItemId: Z, warehouseId: whId, lotId: null, qtyKg: 5 }]));
    check("S15a `devere.lotRequired` açık + lotsuz satır → 400 YARN_LOT_REQUIRED", eLot?.status === 400 && eLot.code === "YARN_LOT_REQUIRED", show(eLot));
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");

    const t1 = randomUUID();
    const d1 = await send(O1, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 20 }], t1);
    check("S7c ilk sevk → sipariş IN_PROGRESS, belge numarası doğuşta", d1.orderStatus === WarpingOrderStatus.IN_PROGRESS && !!d1.dispatch.dispatchNo && d1.dispatch.warpingOrderId === O1, d1.dispatch.dispatchNo);
    check("S7c sevk talimatı yanıtta (toplam tel 7200)", d1.instruction.totalEnds === 7200);
    const s1 = await suggested(O1);
    check("S7d kısmi sevk sonrası X önerisi 30 kg (50 − 20), diğerleri aynı", s1[X] === "30.000" && s1[Y] === "40.000", JSON.stringify(s1));
    const openAudit = await prisma.systemLog.count({ where: { tableName: "WARPING_ORDER", recordId: O1, action: "UPDATE" } });
    check("S7e OPEN → IN_PROGRESS geçişi audit'te tek kez", openAudit === 1, String(openAudit));

    // ── S22 replay ──────────────────────────────────────────────────────
    const d1b = await dispatchWarpingOrder(O1, { clientToken: t1, lines: [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 20 }] }, U);
    check("S22a aynı token + aynı gövde → aynı sevk, replayed=true", d1b.replayed && d1b.dispatch.id === d1.dispatch.id);
    check("S22a ikinci sevk doğmadı", (await prisma.subcontractorDispatch.count({ where: { clientToken: t1 } })) === 1);
    const eRep = await errOf(() => dispatchWarpingOrder(O1, { clientToken: t1, lines: [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 21 }] }, U));
    check("S22b aynı token + farklı miktar → 409", eRep?.status === 409, show(eRep));

    // ── S15 K4 lot kuralı + S10 plan fazlası ─────────────────────────────
    const d2 = await send(O1, [{ yarnItemId: X, warehouseId: whId, lotId: xL2, qtyKg: 35 }]);
    check("S15b WARN: ikinci lot sevk edilir + lot karışımı uyarısı", d2.warnings.some((w) => /birden çok lot/.test(w)), JSON.stringify(d2.warnings));
    check("S10b plandan fazla (X 55 > 50) meşru + fazla uyarısı", d2.warnings.some((w) => /plan 50 kg, gönderilen 55 kg — fazla 5 kg/.test(w)), JSON.stringify(d2.warnings));
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "SINGLE_LOT");
    const eSingle = await errOf(() => send(O1, [{ yarnItemId: Y, warehouseId: whId, lotId: yL1, qtyKg: 1 }, { yarnItemId: X, warehouseId: whId, lotId: xL2, qtyKg: 1 }]));
    check("S15c SINGLE_LOT: siparişte karışık lotlu iplik → 409 WARPING_LOT_MIXED", eSingle?.status === 409 && eSingle.code === "WARPING_LOT_MIXED", show(eSingle));
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    const d3 = await send(O1, [{ yarnItemId: X, warehouseId: whId, lotId: xL2, qtyKg: 1 }]);
    check("S15d FREE: lot karışımı uyarısız (plan fazlası uyarısı kalır)", !d3.warnings.some((w) => /birden çok lot/.test(w)) && d3.warnings.some((w) => /fazla/.test(w)), JSON.stringify(d3.warnings));
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "WARN");
    const eStock = await errOf(() => send(O1, [{ yarnItemId: Z, warehouseId: whId, lotId: zL1, qtyKg: 1000 }]));
    check("S16 depo stoğundan fazla → 4xx, sevk doğmaz", !!eStock && (eStock.status ?? 0) >= 400 && (eStock.status ?? 0) < 500, show(eStock));

    // ── S28 tek sahip KATI ──────────────────────────────────────────────
    const eMix = await errOf(() => send(O1, [{ yarnItemId: Y, warehouseId: whId, lotId: yEA, qtyKg: 5 }]));
    check("S28a fabrika malı siparişe emanet lot → 409 OWNER_MISMATCH (KATI)", eMix?.status === 409 && eMix.code === "OWNER_MISMATCH", show(eMix));
    const O2 = await newOrder();
    const dE = await send(O2, [{ yarnItemId: Y, warehouseId: whId, lotId: yEA, qtyKg: 10 }]);
    check("S28b yalnız emanet lot → sevk geçer, sahip A", dE.ownerCustomerId === custA.id);
    const eFac = await errOf(() => send(O2, [{ yarnItemId: Y, warehouseId: whId, lotId: yL1, qtyKg: 5 }]));
    check("S28c emanet siparişe fabrika lotu → 409 OWNER_MISMATCH", eFac?.status === 409 && eFac.code === "OWNER_MISMATCH", show(eFac));
    if (yEB) {
      const eTwo = await errOf(() => send(O2, [{ yarnItemId: Y, warehouseId: whId, lotId: yEB, qtyKg: 5 }]));
      check("S28d iki müşterinin emaneti → 409 OWNER_MISMATCH", eTwo?.status === 409 && eTwo.code === "OWNER_MISMATCH", show(eTwo));
    } else console.log("⏭ S28d ikinci müşteri fikstürü yok — atlandı");

    // ── Başlık kapıları + DB seddi ──────────────────────────────────────
    const hdr = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d1.dispatch.id }, select: { workOrderId: true, stepId: true, batchId: true, weavingOrderId: true } });
    const eWo = await errOf(async () => assertWorkOrderBound(hdr));
    const eWv = await errOf(async () => assertWeavingBound(hdr));
    check("Başlık: devere sevki iş emri ve dokuma kapılarında 409", eWo?.code === "DISPATCH_NOT_WORK_ORDER_BOUND" && eWv?.code === "DISPATCH_NOT_WEAVING_BOUND", `${show(eWo)} | ${show(eWv)}`);
    const svc = new SubcontractorService();
    const eSvc = await errOf(() => svc.cancel(d1.dispatch.id, `${TAG} yanlış yol`, U));
    check("Başlık: iş emri sevk iptali devere sevkini reddeder (4xx, sevk canlı)", !!eSvc && (eSvc.status ?? 0) >= 400 && (eSvc.status ?? 0) < 500 && !(await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d1.dispatch.id } })).cancelledAt, show(eSvc));
    const eCk = await errOf(() => prisma.$executeRawUnsafe(`UPDATE subcontractor_dispatches SET "warpingOrderId" = NULL WHERE id = $1::uuid`, d1.dispatch.id));
    check("DB seddi: kolsuz başlık → subcontractor_dispatches_header_ck reddeder", !!eCk && /subcontractor_dispatches_header_ck/.test(eCk.msg), eCk?.msg.slice(0, 120));

    // ── S17 iptal LIFO + son sevk → OPEN ────────────────────────────────
    const item1 = d1.yarnItems[0]!;
    const ret = await returnYarn(d1.dispatch.id, { dispatchItemId: item1.dispatchItemId, qtyKg: 5, reasonCode: "KALAN_IPLIK" }, U);
    const cp1 = await previewCancelWarpingDispatch(O1, d1.dispatch.id);
    check("S17a iade alınmış sevkin iptal önizlemesi: canCancel=false + gerekçe", !cp1.canCancel && !!cp1.blockedReason && cp1.items.length === 1);
    const eLifo = await errOf(() => cancelWarpingDispatch(O1, d1.dispatch.id, `${TAG} iptal`, U));
    check("S17b iade alınmış sevk iptali → 409 YARN_ITEM_RETURNED (LIFO)", eLifo?.status === 409 && eLifo.code === "YARN_ITEM_RETURNED", show(eLifo));
    await cancelYarnReturn(d1.dispatch.id, { dispatchItemId: item1.dispatchItemId, movementId: ret.data.movementId, reason: `${TAG} storno` }, U);
    const c1 = await cancelWarpingDispatch(O1, d1.dispatch.id, `${TAG} iptal`, U);
    check("S17c iade stornosu sonrası iptal geçer; başka canlı sevk var → IN_PROGRESS kalır", c1.orderStatus === WarpingOrderStatus.IN_PROGRESS && c1.yarnItemsReverted === 1, JSON.stringify(c1));
    const eRepC = await errOf(() => dispatchWarpingOrder(O1, { clientToken: t1, lines: [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 20 }] }, U));
    check("S22c iptal edilmiş sevkin token'ı → 409 DISPATCH_CANCELLED", eRepC?.status === 409 && eRepC.code === "DISPATCH_CANCELLED", show(eRepC));
    const eWrong = await errOf(() => cancelWarpingDispatch(O2, d2.dispatch.id, `${TAG} iptal`, U));
    check("S17d başka siparişin sevki bu siparişten iptal edilemez → 404", eWrong?.status === 404, show(eWrong));
    await cancelWarpingDispatch(O1, d2.dispatch.id, `${TAG} iptal`, U);
    const cp3 = await previewCancelWarpingDispatch(O1, d3.dispatch.id);
    check("S17e son canlı sevkin önizlemesi: orderReturnsToOpen=true", cp3.canCancel && cp3.orderReturnsToOpen);
    const c3 = await cancelWarpingDispatch(O1, d3.dispatch.id, `${TAG} iptal`, U);
    check("S17f son canlı sevk iptali → sipariş OPEN", c3.orderStatus === WarpingOrderStatus.OPEN && (await statusOf(O1)) === WarpingOrderStatus.OPEN);
    const s2 = await suggested(O1);
    check("S17g tüm sevkler iptal → öneri yeniden plan (X 50)", s2[X] === "50.000", JSON.stringify(s2));
    const eAgain = await errOf(() => cancelWarpingDispatch(O1, d3.dispatch.id, `${TAG} iptal`, U));
    check("S17h OPEN siparişte sevk iptali → 409", eAgain?.status === 409, show(eAgain));

    // ── Yarış ───────────────────────────────────────────────────────────
    const O3 = await newOrder();
    const [ra, rb] = await Promise.allSettled([
      send(O3, [{ yarnItemId: Z, warehouseId: whId, lotId: zL1, qtyKg: 10 }]),
      send(O3, [{ yarnItemId: Z, warehouseId: whId, lotId: zL1, qtyKg: 11 }]),
    ]);
    const okA = ra.status === "fulfilled" ? ra.value : null;
    const okB = rb.status === "fulfilled" ? rb.value : null;
    check("Yarış a: iki eşzamanlı sevk ikisi de geçer, belge no farklı", !!okA && !!okB && okA.dispatch.dispatchNo !== okB.dispatch.dispatchNo,
      `${ra.status === "rejected" ? String(ra.reason) : ""} ${rb.status === "rejected" ? String(rb.reason) : ""}`.slice(0, 200));
    const open3 = await prisma.systemLog.count({ where: { tableName: "WARPING_ORDER", recordId: O3, action: "UPDATE" } });
    check("Yarış a: OPEN → IN_PROGRESS geçişini yalnız biri yaptı (audit 1)", open3 === 1 && (await statusOf(O3)) === WarpingOrderStatus.IN_PROGRESS, String(open3));
    if (okA) {
      const rc = await Promise.allSettled([cancelWarpingDispatch(O3, okA.dispatch.id, `${TAG} yarış`, U), cancelWarpingDispatch(O3, okA.dispatch.id, `${TAG} yarış`, U)]);
      const won = rc.filter((r) => r.status === "fulfilled").length;
      const lost = rc.filter((r) => r.status === "rejected" && (r.reason as { statusCode?: number }).statusCode === 409).length;
      check("Yarış b: aynı sevkin iki eşzamanlı iptali → biri geçer, biri 409", won === 1 && lost === 1, `${won}/${lost}`);
      const outs = await prisma.yarnMovement.count({ where: { dispatchItem: { dispatchId: okA.dispatch.id }, kind: YarnMovementKind.SUBCONTRACT_OUT_CANCEL } });
      check("Yarış b: depo geri dönüşü tek kez yazıldı", outs === 1, String(outs));
    }

    // ── D2 siparişle ilk sevk (tek istek, tek tx) — bölüm scripts/lib/devere-ilk-sevk-bolum.ts ──
    await ilkSevkBolumu({ check, errOf, show, setSetting, tag: TAG, userId: U, subcontractorId: sub.id, specId: spec.id, warehouseId: whId, yarn: { X, Y, Z, W }, lot: { xL1, yL1 }, orderIds });

    // ── Talimat + modül kapısı ──────────────────────────────────────────
    const ins = await getWarpingInstruction(O1);
    const insJson = JSON.stringify(ins);
    check("Talimat: iplik başına harf + tel, kart ve levent satırı var", ins.yarns.map((y) => `${y.letter}${y.endsCount}`).join(",") === "A3000,B2400,C1800" && ins.beamLines.length === 1);
    check("Talimat: iç kolon yok (kg · fire · ücret · fiyat · tolerans)", !/Kg"|waste|fee|price|tolerance|cost/i.test(insJson), insJson.slice(0, 200));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const eMod = await errOf(() => send(O1, [{ yarnItemId: X, warehouseId: whId, lotId: xL1, qtyKg: 1 }]));
    check("Modül: iplik kapalı → servis 403 MODULE_DISABLED, sipariş OPEN kalır", eMod?.status === 403 && eMod.code === "MODULE_DISABLED" && (await statusOf(O1)) === WarpingOrderStatus.OPEN, show(eMod));
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/warping-order.routes.ts"), "utf8");
    const gated = ["get\\(\"/:id/dispatch-preview\"", "post\\(\"/:id/dispatch\"", "get\\(\"/:id/dispatches/:dispatchId/cancel-preview\"", "post\\(\"/:id/dispatches/:dispatchId/cancel\""]
      .map((p) => new RegExp(`router\\.${p}[^\\n]*requireIplikEnabled`).test(routes));
    check("Modül: dört sevk ucu `requireIplikEnabled`'ı uç başına alır (403 MODULE_DISABLED)", gated.every(Boolean), JSON.stringify(gated));
    check("Modül: talimat ucu iplik kapısı almaz (okuma)", /router\.get\("\/:id\/instruction"[^\n]*warping-order:read/.test(routes) && !/router\.get\("\/:id\/instruction"[^\n]*requireIplikEnabled/.test(routes));
  } finally {
    const ds = await prisma.subcontractorDispatch.findMany({ where: { OR: [{ id: { in: [...dispatchIds] } }, { warpingOrderId: { in: orderIds } }] }, select: { id: true } });
    const dids = ds.map((d) => d.id);
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
    await prisma.customer.delete({ where: { id: custB.id } }).catch(() => undefined);
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
