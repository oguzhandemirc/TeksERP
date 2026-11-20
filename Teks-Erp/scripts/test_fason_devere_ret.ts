// =============================================================================
// FASON DEVERE — KUSURLU LEVENT REDDİ (devere ek C1): ret belgesi · yeniden sarım · ret iptali
// =============================================================================
// Fikstür: kart X 3000 tel × 150 den → 1000 m = 50 kg. A'ya 300 kg; R1 = b1 (gövde G1) + b2, R2 = b3 (düzeltmeli).
//   §0  tek kaynak: K3/LIVE_ALLOCATION/mutabakat "reddedilmiş"i yalnız `warping-beam-rejection.helper`dan okur
//   C1  önizleme (metre, dönecek kg + tutan, gövde, engeller; YAZMAZ) · C9 sebep 400, foto 413/400, ayar açık fotosuz 400
//   ret → REJECTED, tutma geri, mutabakat gelen düşer + reddedilen ayrı, beklenen ücret düşer, gövde "Deverecide" · C10 DR- no
//   replay (aynı yanıt; başka içerik 409) · C7 kabul stornosu 409 · C5 reddedilmiş/düzeltmeli sarım 409 · yarış: iki ret → biri 409
//   C3 "iptal" kipinde bağ 400 · C2 yeniden sarım bağı (aynı gövdeye) + replay kimliği bağı içerir + ikinci bağ 409 + reworkBillable
//   C4 ret iptali: canlı yeniden sarım 409 → kabul geri → iptal (tutma düşer, gövde FULL_STOCK) · tutma yetmez 409
//   C6 kapanmış sipariş 409 · faturalı kabul 409 · C8 devirli dağıtım TUTANA (C) döner · liste/özet · foto ucu · DB CHECK
// NEGATİF SONDA: `LIVE_ALLOCATION`dan `beam: NOT_REJECTED_BEAM_WHERE` çıkarılınca "tutma geri" + C8 KIRMIZI (arşiv "Devere ek C1").
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, WarpBeamStatus, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { applyWarpBeamEventTx } from "../src/services/helpers/warp-beam-event.helper";
import { loadWarpingSettlement } from "../src/services/helpers/warping-settlement.helper";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { listWarpingYarnHoldings } from "../src/services/warping-order/yarn-return";
import { returnWarpingYarn } from "../src/services/warping-order/yarn-return-waste";
import { previewWarpingReceive, receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt, previewCancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { getWarpingOrderFeeSummary } from "../src/services/warping-order/fee-summary";
import { createWarpingBeamRejection, previewWarpingBeamRejection, type WarpingBeamRejectionInput } from "../src/services/warping-order/beam-rejection";
import { cancelWarpingBeamRejection, previewCancelWarpingBeamRejection } from "../src/services/warping-order/beam-rejection-cancel";
import { getWarpingBeamRejection, listWarpingBeamRejections } from "../src/services/warping-order/beam-rejection-read";
import { addRejectionPhotos, readRejectionPhoto } from "../src/services/warping-order/beam-rejection-photo";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDRET-${process.pid}`;
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
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY,
  SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, SETTING_KEYS.DEVERE_REWORK_BILLABLE,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${TAG}-png-govde`)]).toString("base64");
const n3 = (s: string | null | undefined) => Number(s ?? NaN);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== FASON DEVERE KUSURLU LEVENT REDDİ (C1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  const invoiceIds: string[] = [];
  let custId: string | null = null;
  let cariId: string | null = null;
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "false"], [SETTING_KEYS.DEVERE_REWORK_BILLABLE, "true"]] as const) await setSetting(k, v);
    await reconcileReasonPresets();

    const X = (await prisma.item.create({ data: { code: `${TAG}-X`, name: `${TAG} iplik X`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    yarnIds.push(X);
    const lx = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-XL` }, select: { id: true } })).id;
    lotIds.push(lx);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: X, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lx, reason: `${TAG} giriş` }));
    const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} zemin`, yarnItemId: X, endsCount: 3000, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    specIds.push(spec);
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec, beamLines: [{ beamCount: 6, beamLengthM: 1000 }], feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, kg: number) => dispatchWarpingOrder(orderId, { clientToken: randomUUID(), lines: [{ yarnItemId: X, warehouseId: whId, lotId: lx, qtyKg: kg }] }, U);
    const receive = (orderId: string, beams: WarpingReceiveBeamInput[], clientToken: string = randomUUID()) => receiveWarpingOrder(orderId, { clientToken, deliveryNoteNo: "IRS-RET", beams }, U);
    const holds = async (orderId: string) => (await listWarpingYarnHoldings(orderId)).reduce((s, h) => s + Number(h.holdingKg), 0);
    const beamsOf = (receiptKey: string) => prisma.warpBeam.findMany({ where: { warpingReceiptKey: receiptKey }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true, beamBodyId: true } });
    const statusOf = async (id: string) => (await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
    const reject = (orderId: string, beamIds: string[], extra: Partial<WarpingBeamRejectionInput> = {}) =>
      createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: orderId, beamIds, reasonCode: "TEL_KOPUK", expectRework: true, ...extra }, U);
    const feeQty = async (orderId: string) => n3((await getWarpingOrderFeeSummary(orderId, { canReadInvoices: false })).totals.qty);

    // ── §0 tek kaynak ────────────────────────────────────────────────────
    const helperDir = path.join(__dirname, "../src/services/helpers");
    const readers = ["warping-fee.helper.ts", "warping-yarn-open.helper.ts", "warping-settlement.helper.ts"].map((f) => fs.readFileSync(path.join(helperDir, f), "utf8"));
    check("§0 K3 · LIVE_ALLOCATION · mutabakat 'reddedilmiş'i yalnız warping-beam-rejection.helper'dan okur (REJECTED literal'i yok)",
      readers.every((s) => s.includes('from "./warping-beam-rejection.helper"') && !/WarpBeamStatus\.REJECTED|["']REJECTED["']/.test(s)));

    // ── Kurulum: A (300 kg) · R1 = b1 (gövde G1) + b2 · R2 = b3 ─────────
    const A = await newOrder();
    await send(A, 300);
    const r1 = await receive(A, [{ lengthM: 1000, physicalBeamNo: `${TAG}-G1`, newBody: { owner: { kind: "OURS" } } }, { lengthM: 1000 }]);
    const [b1, b2] = await beamsOf(r1.receiptKey);
    const G1 = b1!.beamBodyId!;
    const r2 = await receive(A, [{ lengthM: 1000 }]);
    const [b3] = await beamsOf(r2.receiptKey);
    await prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: b3!.id, kind: "ADJUST_OUT", from: WarpBeamStatus.READY, to: WarpBeamStatus.READY, data: { lengthM: 10, reason: `${TAG} düzeltme`, createdById: U } }));
    const holdA0 = await holds(A);
    const recv0 = n3((await loadWarpingSettlement(prisma, A)).metre.receivedM);
    const fee0 = await feeQty(A);
    check("Kurulum: tutma 300 − 3×50 = 150 · gelen 3000 m · gövde G1 dolu", holdA0 === 150 && recv0 === 3000 && G1 !== null, `${holdA0} ${recv0}`);

    // ── C1 önizleme ──────────────────────────────────────────────────────
    const ev0 = await prisma.warpBeamEvent.count({ where: { beamId: b1!.id } });
    const pv0 = await previewWarpingBeamRejection({ warpingOrderId: A, beamIds: [b1!.id], reasonCode: "", expectRework: true });
    const pv = await previewWarpingBeamRejection({ warpingOrderId: A, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true });
    check("C1 önizleme: 1000 m · dönecek 50 kg tutan A · gövde G1 · sebepsiz rejectable=false, sebepli true · YAZMAZ",
      pv.beams[0]?.lengthM === "1000.000" && pv.returnedYarn.length === 1 && pv.returnedYarn[0]!.kg === "50.000" && pv.returnedYarn[0]!.holderWarpingOrderId === A
      && pv.beams[0]?.bodyNo === `${TAG}-G1` && pv0.rejectable === false && pv.rejectable === true && pv.blockers.length === 0
      && (await prisma.warpBeamEvent.count({ where: { beamId: b1!.id } })) === ev0, JSON.stringify({ b: pv.beams[0], y: pv.returnedYarn, bl: pv.blockers }));

    // ── C9 sebep · foto · ayar ───────────────────────────────────────────
    const eR = await errOf(() => reject(A, [b1!.id], { reasonCode: "YOK_BOYLE" }));
    const eT = await errOf(() => reject(A, [b1!.id], { reasonCode: "DIGER" }));
    const eBig = await errOf(() => reject(A, [b1!.id], { photos: [{ fileName: "a.png", contentBase64: "A".repeat(7_100_000) }] }));
    const eTyp = await errOf(() => reject(A, [b1!.id], { photos: [{ fileName: "a.txt", contentBase64: Buffer.from("merhaba dünya").toString("base64") }] }));
    await setSetting(SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "true");
    const eReq = await errOf(() => reject(A, [b1!.id]));
    const pvReq = await previewWarpingBeamRejection({ warpingOrderId: A, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true });
    await setSetting(SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "false");
    check("C9 sebep yok 400 · Diğer metinsiz 400 · foto > 5 MB 413 · tanınmayan tür 400 · ayar açık fotosuz 400 (önizleme engeli)",
      eR?.code === "WARPING_REJECT_REASON_INVALID" && eT?.code === "WARPING_REJECT_REASON_TEXT_REQUIRED" && eBig?.status === 413 && eBig.code === "WARPING_REJECT_PHOTO_TOO_LARGE"
      && eTyp?.code === "WARPING_REJECT_PHOTO_TYPE" && eReq?.code === "WARPING_REJECT_PHOTO_REQUIRED" && pvReq.blockers.some((b) => b.code === "WARPING_REJECT_PHOTO_REQUIRED")
      && (await statusOf(b1!.id)) === WarpBeamStatus.READY, [eR, eT, eBig, eTyp, eReq].map(show).join(" | "));

    // ── Ret ──────────────────────────────────────────────────────────────
    const tok1 = randomUUID();
    const rj1 = await createWarpingBeamRejection({ clientToken: tok1, warpingOrderId: A, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true, photos: [{ fileName: "kopuk.png", contentBase64: PNG }] }, U);
    const st1 = await loadWarpingSettlement(prisma, A);
    const body1 = await prisma.beamBody.findUniqueOrThrow({ where: { id: G1 }, select: { status: true, subcontractorId: true, currentWarpBeamId: true } });
    check("C10 DR-YYMM-NNNN doğuşta · kalem 1 · foto 1 · kip REWORK", /^DR-\d{4}-\d{4}$/.test(rj1.data.docNo) && rj1.data.items.length === 1 && rj1.data.photos.length === 1 && rj1.data.mode === "REWORK" && !rj1.replayed, rj1.data.docNo);
    check("Ret: sarım REJECTED · tutma geri (150 → 200)", (await statusOf(b1!.id)) === WarpBeamStatus.REJECTED && (await holds(A)) === 200, String(await holds(A)));
    check("Ret: mutabakat gelen 3000 → 2000 m, reddedilen 1000 m / 1 sarım ayrı", n3(st1.metre.receivedM) === 2000 && n3(st1.metre.rejectedM) === 1000 && st1.metre.rejectedBeamCount === 1, JSON.stringify(st1.metre));
    check("Ret: beklenen ücret ölçüsü 1000 m düşer (K3)", (await feeQty(A)) === fee0 - 1000, `${fee0} → ${await feeQty(A)}`);
    check("Ret: gövde G1 'Deverecide' (AT_SUBCONTRACTOR, devereci, üstündeki sarım boş)", body1.status === "AT_SUBCONTRACTOR" && body1.subcontractorId === sub.id && body1.currentWarpBeamId === null, JSON.stringify(body1));
    const rp = await createWarpingBeamRejection({ clientToken: tok1, warpingOrderId: A, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true }, U);
    const eCol = await errOf(() => createWarpingBeamRejection({ clientToken: tok1, warpingOrderId: A, beamIds: [b2!.id], reasonCode: "TEL_KOPUK", expectRework: true }, U));
    check("Replay: aynı deneme aynı belge (çift olay yok) · başka içerik 409", rp.replayed && rp.data.id === rj1.data.id && (await prisma.warpBeamEvent.count({ where: { beamId: b1!.id, kind: "REJECT_OUT" } })) === 1 && eCol?.code === "CLIENT_TOKEN_COLLISION", show(eCol));

    // ── C7 · C5 ──────────────────────────────────────────────────────────
    const eSt = await errOf(() => cancelWarpingReceipt(A, r1.receiptKey, `${TAG} storno`, U));
    const pSt = await previewCancelWarpingReceipt(A, r1.receiptKey);
    check("C7 reddedilmiş sarımlı kabul stornosu 409 (önizleme engeli)", eSt?.code === "WARPING_RECEIPT_HAS_REJECTION" && pSt.blockers.some((b) => b.includes("ret")), show(eSt));
    const eAgain = await errOf(() => reject(A, [b1!.id]));
    const eAdj = await errOf(() => reject(A, [b3!.id]));
    check("C5 reddedilmiş sarım yeniden 409 · düzeltme geçmişli sarım 409", eAgain?.code === "WARPING_BEAM_NOT_REJECTABLE" && eAdj?.code === "WARPING_BEAM_NOT_REJECTABLE", `${show(eAgain)} | ${show(eAdj)}`);

    // ── Yarış: aynı sarıma iki eşzamanlı ret ─────────────────────────────
    const race = await Promise.allSettled([reject(A, [b2!.id], { expectRework: false }), reject(A, [b2!.id], { expectRework: false })]);
    const won = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason as { statusCode?: number });
    check("Yarış: aynı sarıma iki eşzamanlı ret → biri belge, biri 409 · tek REJECT_OUT", won.length === 1 && lost.length === 1 && lost[0]!.statusCode === 409 && (await prisma.warpBeamEvent.count({ where: { beamId: b2!.id, kind: "REJECT_OUT" } })) === 1);
    const rj2 = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof reject>>>).value;

    // ── C3 · C2 yeniden sarım ────────────────────────────────────────────
    const eNx = await errOf(() => previewWarpingReceive(A, { beams: [{ lengthM: 1000, reworkOfBeamId: b2!.id }] }));
    check("C3 'iptal, iplik deverecide' kipinde yeniden sarım bağı 400", eNx?.code === "WARPING_REWORK_NOT_EXPECTED", show(eNx));
    const tok3 = randomUUID();
    const reLine = (rework: string | null): WarpingReceiveBeamInput => ({ lengthM: 1000, beamBodyId: G1, reworkOfBeamId: rework });
    const r3 = await receive(A, [reLine(b1!.id)], tok3);
    const [b4] = await beamsOf(r3.receiptKey);
    const b4row = await prisma.warpBeam.findUniqueOrThrow({ where: { id: b4!.id }, select: { reworkOfBeamId: true } });
    const g1r = await prisma.beamBody.findUniqueOrThrow({ where: { id: G1 }, select: { status: true, currentWarpBeamId: true } });
    check("C2 yeniden sarım reddedilene bağlı · aynı gövdeye dolar (FULL_STOCK)", b4row.reworkOfBeamId === b1!.id && g1r.status === "FULL_STOCK" && g1r.currentWarpBeamId === b4!.id, JSON.stringify({ b4row, g1r }));
    const r3b = await receive(A, [reLine(b1!.id)], tok3);
    const eRk = await errOf(() => receive(A, [reLine(null)], tok3));
    check("C2 replay kimliği yeniden sarım bağını içerir: aynısı replay · bağsız aynı token 409", r3b.replayed && r3b.receiptKey === r3.receiptKey && eRk?.code === "CLIENT_TOKEN_COLLISION", show(eRk));
    const eTk = await errOf(() => previewWarpingReceive(A, { beams: [{ lengthM: 1000, reworkOfBeamId: b1!.id }] }));
    check("C2 ikinci canlı yeniden sarım 409", eTk?.code === "WARPING_REWORK_TAKEN", show(eTk));
    const qOn = await feeQty(A);
    await setSetting(SETTING_KEYS.DEVERE_REWORK_BILLABLE, "false");
    const qOff = await feeQty(A);
    await setSetting(SETTING_KEYS.DEVERE_REWORK_BILLABLE, "true");
    check("C2 reworkBillable açık: yeniden sarım beklenene girer · kapalı: girmez (fark 1000 m)", qOn - qOff === 1000, `${qOn} / ${qOff}`);

    // ── C4 ret iptali ────────────────────────────────────────────────────
    const cp1 = await previewCancelWarpingBeamRejection(rj1.data.id);
    const eAct = await errOf(() => cancelWarpingBeamRejection(rj1.data.id, `${TAG} iptal`, U));
    check("C4 canlı yeniden sarım varken ret iptali 409 (önizleme engeli)", !cp1.cancellable && cp1.blockers.some((b) => b.code === "WARPING_REWORK_ACTIVE") && eAct?.code === "WARPING_REWORK_ACTIVE", show(eAct));
    await cancelWarpingReceipt(A, r3.receiptKey, `${TAG} yeniden sarım geri`, U);
    const hBefore = await holds(A);
    const cp2 = await previewCancelWarpingBeamRejection(rj1.data.id);
    const cdto = await cancelWarpingBeamRejection(rj1.data.id, `${TAG} iptal`, U);
    const g1c = await prisma.beamBody.findUniqueOrThrow({ where: { id: G1 }, select: { status: true, currentWarpBeamId: true } });
    const back = await prisma.warpBeamEvent.findFirst({ where: { beamId: b1!.id, kind: "REJECT_OUT_CANCEL" }, select: { reversesEventId: true } });
    check("C4 iptal: önizleme 50 kg yeniden düşecek · sarım READY · tutma 50 düşer · tipli ters · belge CANCELLED",
      cp2.cancellable && cp2.yarn[0]?.kg === "50.000" && (await statusOf(b1!.id)) === WarpBeamStatus.READY && (await holds(A)) === hBefore - 50 && back?.reversesEventId !== null && cdto.status === "CANCELLED", JSON.stringify(cp2.blockers));
    check("C4 iptal: gövde G1 yeniden FULL_STOCK, üstünde b1", g1c.status === "FULL_STOCK" && g1c.currentWarpBeamId === b1!.id, JSON.stringify(g1c));
    const ePh = await errOf(() => addRejectionPhotos(rj1.data.id, [{ contentBase64: PNG }], U));
    check("İptal edilmiş belgeye fotoğraf 409", ePh?.code === "WARPING_REJECTION_CANCELLED", show(ePh));
    // Tutma yetmez: A'nın kaleminden iade → tutma < b2 dağıtımı.
    const item = (await listWarpingYarnHoldings(A))[0]!;
    await returnWarpingYarn(A, { dispatchItemId: item.dispatchItemId, qtyKg: Number(item.holdingKg) - 40, reasonCode: "KALAN_IPLIK" }, U);
    const cp3 = await previewCancelWarpingBeamRejection(rj2.data.id);
    const eIns = await errOf(() => cancelWarpingBeamRejection(rj2.data.id, `${TAG} iptal`, U));
    check("C4 tutma dağıtıma yetmez (40 < 50) → önizleme engeli + iptal 409", cp3.blockers.some((b) => b.code === "WARPING_HOLDING_INSUFFICIENT") && eIns?.code === "WARPING_HOLDING_INSUFFICIENT" && (await statusOf(b2!.id)) === WarpBeamStatus.REJECTED, show(eIns));

    // ── C6 · faturalı ────────────────────────────────────────────────────
    await prisma.warpingOrder.update({ where: { id: A }, data: { status: WarpingOrderStatus.COMPLETED, completedAt: new Date(), completedById: U } });
    const eDone = await errOf(() => reject(A, [b1!.id]));
    const cpDone = await previewCancelWarpingBeamRejection(rj2.data.id);
    await prisma.warpingOrder.update({ where: { id: A }, data: { status: WarpingOrderStatus.IN_PROGRESS, completedAt: null, completedById: null } });
    check("C6 kapanmış sipariş: ret 409 · ret iptali önizleme engeli", eDone?.code === "WARPING_ORDER_COMPLETED" && cpDone.blockers.some((b) => b.code === "WARPING_ORDER_COMPLETED"), show(eDone));
    custId = (await prisma.customer.create({ data: { code: `${TAG}-C`.slice(0, 32), name: `${TAG} fatura carisi` }, select: { id: true } })).id;
    cariId = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: custId }, select: { id: true } })).id;
    const inv = await prisma.invoice.create({ data: { docNo: `${TAG}-F`.slice(0, 32), type: "PURCHASE", cariId, issueDate: new Date() }, select: { id: true } });
    invoiceIds.push(inv.id);
    await prisma.invoiceToWarpingReceipt.create({ data: { invoiceId: inv.id, warpingOrderId: A, warpingReceiptKey: r1.receiptKey } });
    const pInv = await previewWarpingBeamRejection({ warpingOrderId: A, beamIds: [b1!.id], reasonCode: "TEL_KOPUK", expectRework: true });
    const eInv = await errOf(() => reject(A, [b1!.id]));
    await prisma.invoice.delete({ where: { id: inv.id } });
    check("Faturalı kabulün sarımı: önizleme engeli + ret 409 WARPING_RECEIPT_INVOICED", pInv.blockers.some((b) => b.code === "WARPING_RECEIPT_INVOICED") && pInv.beams[0]?.invoiceDocNo !== null && eInv?.code === "WARPING_RECEIPT_INVOICED", show(eInv));

    // ── C8 devirli dağıtım ───────────────────────────────────────────────
    const C = await newOrder();
    await send(C, 40);
    await prisma.warpingOrder.update({ where: { id: C }, data: { status: WarpingOrderStatus.COMPLETED, completedAt: new Date(), completedById: U } });
    const B = await newOrder();
    await send(B, 20);
    const rB = await receive(B, [{ lengthM: 1000 }]);
    const [b5] = await beamsOf(rB.receiptKey);
    const hC0 = await holds(C);
    const pvB = await previewWarpingBeamRejection({ warpingOrderId: B, beamIds: [b5!.id], reasonCode: "GERGI", expectRework: false });
    await reject(B, [b5!.id], { reasonCode: "GERGI", expectRework: false });
    const toC = pvB.returnedYarn.find((y) => y.holderWarpingOrderId === C);
    check("C8 devirli dağıtım: 30 kg TUTANA (kapanmış C) döner, 20 kg B'ye", toC?.kg === "30.000" && pvB.returnedYarn.find((y) => y.holderWarpingOrderId === B)?.kg === "20.000" && (await holds(C)) === hC0 + 30 && (await holds(B)) === 20, JSON.stringify(pvB.returnedYarn));

    // ── Liste · belge · foto · DB ────────────────────────────────────────
    const list = await listWarpingBeamRejections({ warpingOrderId: A, subcontractorId: null, status: "all", limit: 1 });
    const active = await listWarpingBeamRejections({ warpingOrderId: A, subcontractorId: null, status: "active", limit: 50 });
    check("Liste: tek where — özet 2 belge / 2 sarım, sayfa 1 + imleç; aktif süzgeç 1", list.summary.count === 2 && list.summary.beamCount === 2 && list.data.length === 1 && list.nextCursor !== null && active.summary.count === 1, JSON.stringify(list.summary));
    const doc = await getWarpingBeamRejection(rj1.data.id);
    const ph = await readRejectionPhoto(rj1.data.id, doc.photos[0]!.id);
    check("Belge DTO (basım verisi): sipariş/devereci/sebep/sarım metresi; foto baytı geri okunur (PNG)", doc.order.id === A && doc.subcontractor.id === sub.id && doc.reason.code === "TEL_KOPUK" && doc.items[0]?.lengthM === "1000.000" && ph.mimeType === "image/png" && Buffer.from(ph.content).toString("base64") === PNG);
    const eCk = await errOf(() => prisma.$executeRaw`UPDATE warp_beams SET "reworkOfBeamId" = id WHERE id = ${b3!.id}::uuid`);
    check("DB: sarım kendisinin yeniden sarımı olamaz (warp_beams_rework_ck)", eCk !== null && eCk.msg.includes("warp_beams_rework_ck"), show(eCk));
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { OR: [{ warpingOrderId: { in: orderIds } }, { beamNo: { startsWith: TAG } }] }, select: { id: true } })).map((b) => b.id);
    const rejIds = (await prisma.warpingBeamRejection.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((r) => r.id);
    const bodyIds = (await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } })).map((b) => b.id);
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((d) => d.id);
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (cariId) await prisma.cariAccount.delete({ where: { id: cariId } }).catch(() => undefined);
    if (custId) await prisma.customer.delete({ where: { id: custId } }).catch(() => undefined);
    await prisma.warpingBeamRejectionPhoto.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejectionItem.deleteMany({ where: { rejectionId: { in: rejIds } } });
    await prisma.warpingBeamRejection.deleteMany({ where: { id: { in: rejIds } } });
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
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: orderIds } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: yarnIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...beamIds, ...rejIds, ...bodyIds] } } });
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
