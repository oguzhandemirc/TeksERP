// =============================================================================
// LEVENT GÖVDESİ HAREKETLERİ — devere ek B2 (GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §1 OFF: gövdesiz sevk bayt-aynı (beamBodies []) · gövdeli sevk / elle geçiş / iade belgesi 403 BEAM_BODY_MODE_OFF
//   §2 elle geçiş: bakım giriş/çıkış (depo korunur) · yanlış durum 409 BEAM_BODY_STATE · hurda sebepsiz 400 · boş
//      gönderim devereci zorunlu 400 · önizleme yazmaz
//   §3 son hareketi geri al: yer bir önceki olaya döner · geri alınmış çift zinciri bozmaz · son olmayan 409 · undoable
//   §4 sevkte boş gövde: SHIP_EMPTY + dispatch bağı · sevk listesi gövde nosu · replay/çakışma · belgeli olay elle
//      geri alınmaz 409 · durum uyumsuz gövde sevki tümüyle geri alır
//   §5 sevk iptali: gövde sonra hareket ettiyse önizleme engeli + 409 · iptal gövdeleri depoya (boş) döndürür
//   §6 sahibine iade belgesi: aday listesi · LGI-YYMM-NNNN · sahip uyuşmazlığı 400 (tümü geri) · replay · iptal
//      önizlemesi + iptal · çift iptal 409 · iptal edilmiş belgenin token'ı 409
// NEGATİF SONDA: §5 — `cancelWarpingDispatchTx`ten `reverseDispatchBeamBodiesTx` çağrısı çıkarılınca §5b kırmızı, bekçi §5c öncesi düşer (2026-11-20).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { BeamBodyStatus, Prisma, YarnMovementKind } from "@prisma/client";
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
import { cancelWarpingDispatch, previewCancelWarpingDispatch } from "../src/services/warping-order/dispatch-cancel";
import { listWarpingDispatches } from "../src/services/warping-order/dispatches-read";
import { createBeamBody, type BeamBodyOwnerInput } from "../src/services/beam-body/write";
import { getBeamBody, listBeamBodyEvents } from "../src/services/beam-body/read";
import { applyBeamBodyTransition, previewBeamBodyTransition, previewUndoBeamBodyEvent, undoBeamBodyEvent } from "../src/services/beam-body/transition";
import {
  cancelBeamBodyReturn, createBeamBodyReturn, listBeamBodyReturns, listOwnerReturnCandidates, previewCancelBeamBodyReturn,
} from "../src/services/beam-body/returns";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LGH${process.pid}`;
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
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_BEAM_BODY_MODE] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== LEVENT GÖVDESİ HAREKETLERİ (devere ek B2) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const customerIds: string[] = [];
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const specIds: string[] = [];
  const orderIds: string[] = [];
  const returnTokens: string[] = [];
  let n = 0;
  const body = async (owner: BeamBodyOwnerInput = { kind: "OURS" }) =>
    (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${++n}`, owner, warehouseId: W }, U)).data;
  const st = async (id: string) => getBeamBody(id);
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");

    // Fikstür: iplik + lot + stok, çözgü kartı, sipariş üreteci.
    const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    yarnIds.push(yarn.id);
    const lot = await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L` }, select: { id: true } });
    lotIds.push(lot.id);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: W, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot.id, reason: `${TAG} giriş` }));
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} kart`, yarnItemId: yarn.id, endsCount: 3000, yarns: { create: [{ yarnItemId: yarn.id, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } });
    specIds.push(spec.id);
    const newOrder = async () => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec.id, beamLines: [{ beamCount: 1, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const send = (orderId: string, beamBodyIds?: string[], clientToken = randomUUID()) =>
      dispatchWarpingOrder(orderId, { clientToken, lines: [{ yarnItemId: yarn.id, warehouseId: W, lotId: lot.id, qtyKg: 5 }], ...(beamBodyIds ? { beamBodyIds } : {}) }, U);

    // ── §1 OFF ────────────────────────────────────────────────────────────
    const A = await body();
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OFF");
    const o1 = await newOrder();
    const plain = await send(o1);
    check("§1a OFF: gövdesiz sevk açılır, beamBodies [] (bayt-aynı)", !plain.replayed && Array.isArray(plain.beamBodies) && plain.beamBodies.length === 0);
    const offShip = await errOf(() => send(o1, [A.id]));
    check("§1b OFF: gövdeli sevk → 403 BEAM_BODY_MODE_OFF", offShip?.status === 403 && offShip.code === "BEAM_BODY_MODE_OFF", show(offShip));
    const offTr = await errOf(() => applyBeamBodyTransition(A.id, { kind: "MAINTENANCE_IN" }, U));
    const offRet = await errOf(() => createBeamBodyReturn({ clientToken: randomUUID(), ownerCustomerId: randomUUID(), bodyIds: [A.id] }, U));
    check("§1c OFF: elle geçiş ve iade belgesi → 403 BEAM_BODY_MODE_OFF", offTr?.code === "BEAM_BODY_MODE_OFF" && offRet?.code === "BEAM_BODY_MODE_OFF", `${show(offTr)} | ${show(offRet)}`);
    await setSetting(SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL");

    // ── §2 elle geçiş ─────────────────────────────────────────────────────
    const evCount = async (id: string) => prisma.beamBodyEvent.count({ where: { bodyId: id } });
    const before = await evCount(A.id);
    const pv = await previewBeamBodyTransition(A.id, { kind: "MAINTENANCE_IN" });
    check("§2a önizleme hedefi MAINTENANCE, depo korunur, YAZMAZ", pv.to === BeamBodyStatus.MAINTENANCE && pv.place.warehouseId === W && (await evCount(A.id)) === before);
    await applyBeamBodyTransition(A.id, { kind: "MAINTENANCE_IN" }, U);
    let a = await st(A.id);
    check("§2b bakıma alındı: MAINTENANCE · depo aynı", a.status === BeamBodyStatus.MAINTENANCE && a.place.warehouse?.id === W, `${a.status} ${a.place.warehouse?.id}`);
    const wrong = await errOf(() => applyBeamBodyTransition(A.id, { kind: "RETURN_EMPTY" }, U));
    check("§2c yanlış durum (bakımdaki gövdeye boş dönüş) → 409 BEAM_BODY_STATE", wrong?.status === 409 && wrong.code === "BEAM_BODY_STATE", show(wrong));
    const noReason = await errOf(() => applyBeamBodyTransition(A.id, { kind: "SCRAP", reason: " " }, U));
    check("§2d hurda sebepsiz → 400 BEAM_BODY_SCRAP_REASON_REQUIRED", noReason?.status === 400 && noReason.code === "BEAM_BODY_SCRAP_REASON_REQUIRED", show(noReason));
    await applyBeamBodyTransition(A.id, { kind: "MAINTENANCE_OUT" }, U);
    const noSub = await errOf(() => applyBeamBodyTransition(A.id, { kind: "SHIP_EMPTY" }, U));
    check("§2e boş gönderim deverecisiz → 400 BEAM_BODY_PLACE_REQUIRED", noSub?.status === 400 && noSub.code === "BEAM_BODY_PLACE_REQUIRED", show(noSub));
    await applyBeamBodyTransition(A.id, { kind: "SHIP_EMPTY", subcontractorId: sub.id }, U);
    a = await st(A.id);
    check("§2f boş gönderildi: AT_SUBCONTRACTOR · devereci · depo yok", a.status === BeamBodyStatus.AT_SUBCONTRACTOR && a.place.subcontractor?.id === sub.id && a.place.warehouse === null);

    // ── §3 son hareketi geri al ───────────────────────────────────────────
    let evs = await listBeamBodyEvents(A.id);
    const ship = evs[evs.length - 1]!;
    const maintIn = evs.find((e) => e.kind === "MAINTENANCE_IN")!;
    check("§3a undoable yalnız son etkin hareket (SHIP_EMPTY)", ship.kind === "SHIP_EMPTY" && ship.undoable && evs.filter((e) => e.undoable).length === 1, evs.map((e) => `${e.kind}:${e.undoable}`).join(" "));
    const pvU = await previewUndoBeamBodyEvent(A.id, ship.id);
    check("§3b geri alma önizlemesi: geri alınabilir, EMPTY_STOCK'a döner", pvU.undoable && pvU.restoresTo?.status === BeamBodyStatus.EMPTY_STOCK);
    await undoBeamBodyEvent(A.id, ship.id, "yanlış gövde", U);
    a = await st(A.id);
    check("§3c geri alındı: EMPTY_STOCK · depo bir önceki olaydan (W) · devereci yok", a.status === BeamBodyStatus.EMPTY_STOCK && a.place.warehouse?.id === W && a.place.subcontractor === null, `${a.status} ${a.place.warehouse?.id}`);
    evs = await listBeamBodyEvents(A.id);
    const maintOut = evs.find((e) => e.kind === "MAINTENANCE_OUT")!;
    check("§3d geri alınmış çift zinciri bozmaz: şimdi son etkin hareket MAINTENANCE_OUT", maintOut.undoable && evs.find((e) => e.id === ship.id)?.reversed === true, evs.map((e) => `${e.kind}:${e.undoable}`).join(" "));
    const notLatest = await errOf(() => undoBeamBodyEvent(A.id, maintIn.id, "deneme", U));
    check("§3e son olmayan hareket → 409 BEAM_BODY_EVENT_NOT_LATEST", notLatest?.status === 409 && notLatest.code === "BEAM_BODY_EVENT_NOT_LATEST", show(notLatest));
    await undoBeamBodyEvent(A.id, maintOut.id, "bakım sürüyor", U);
    a = await st(A.id);
    check("§3f MAINTENANCE_OUT geri alındı → MAINTENANCE · depo W", a.status === BeamBodyStatus.MAINTENANCE && a.place.warehouse?.id === W);
    const again = await errOf(() => undoBeamBodyEvent(A.id, maintOut.id, "tekrar", U));
    check("§3g çift geri alma → 409 BEAM_BODY_EVENT_REVERSED", again?.status === 409 && again.code === "BEAM_BODY_EVENT_REVERSED", show(again));

    // ── §4 sevkte boş gövde ───────────────────────────────────────────────
    const B = await body();
    const C = await body();
    const o2 = await newOrder();
    const tok = randomUUID();
    const d2 = await send(o2, [C.id, B.id], tok);
    const b4 = await st(B.id);
    const c4 = await st(C.id);
    const shipEvs = await prisma.beamBodyEvent.findMany({ where: { subcontractorDispatchId: d2.dispatch.id }, select: { kind: true } });
    check("§4a iki gövde AT_SUBCONTRACTOR · sevkin deverecisi · SHIP_EMPTY olayları sevke bağlı",
      [b4, c4].every((x) => x.status === BeamBodyStatus.AT_SUBCONTRACTOR && x.place.subcontractor?.id === sub.id) && shipEvs.length === 2 && shipEvs.every((e) => e.kind === "SHIP_EMPTY"));
    const list = (await listWarpingDispatches(o2)).find((d) => d.dispatchId === d2.dispatch.id);
    check("§4b sonuç + sevk listesi gövde nolarını taşır (irsaliye)", d2.beamBodies.length === 2 && list?.beamBodies.map((x) => x.bodyNo).sort().join(",") === [B.bodyNo, C.bodyNo].sort().join(","), JSON.stringify(list?.beamBodies));
    const rep = await send(o2, [B.id, C.id], tok);
    check("§4c aynı deneme (gövde sırası farklı) → replayed, aynı sevk", rep.replayed && rep.dispatch.id === d2.dispatch.id);
    const coll = await errOf(() => send(o2, [B.id], tok));
    check("§4d aynı token farklı gövde kümesi → 409 CLIENT_TOKEN_COLLISION", coll?.status === 409 && coll.code === "CLIENT_TOKEN_COLLISION", show(coll));
    const bShip = (await listBeamBodyEvents(B.id)).find((e) => e.kind === "SHIP_EMPTY")!;
    const docUndo = await errOf(() => undoBeamBodyEvent(B.id, bShip.id, "deneme", U));
    check("§4e sevke bağlı olay elle geri alınmaz → 409 BEAM_BODY_EVENT_DOCUMENT; geçmişte belge no", docUndo?.code === "BEAM_BODY_EVENT_DOCUMENT" && bShip.document?.no === d2.dispatch.dispatchNo && !bShip.undoable, show(docUndo));
    const dCount = await prisma.subcontractorDispatch.count({ where: { warpingOrderId: o2 } });
    const busy = await errOf(() => send(o2, [A.id]));
    check("§4f bakımdaki gövdeyle sevk → 409 BEAM_BODY_STATE, sevk hiç yazılmaz", busy?.status === 409 && busy.code === "BEAM_BODY_STATE" && (await prisma.subcontractorDispatch.count({ where: { warpingOrderId: o2 } })) === dCount, show(busy));

    // ── §5 sevk iptali ────────────────────────────────────────────────────
    await applyBeamBodyTransition(C.id, { kind: "RETURN_EMPTY", warehouseId: W }, U);
    const pvC = await previewCancelWarpingDispatch(o2, d2.dispatch.id);
    check("§5a gövde sonra hareket etti → önizleme engeli + gövdeler listede", !pvC.canCancel && (pvC.blockedReason ?? "").includes(C.bodyNo) && pvC.beamBodies.length === 2, String(pvC.blockedReason));
    const moved = await errOf(() => cancelWarpingDispatch(o2, d2.dispatch.id, "yanlış sevk", U));
    check("§5b iptal → 409 BEAM_BODY_EVENT_NOT_LATEST (iplik iptali de geri alınır)", moved?.status === 409 && moved.code === "BEAM_BODY_EVENT_NOT_LATEST" && !(await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d2.dispatch.id }, select: { cancelledAt: true } })).cancelledAt, show(moved));
    const cRet = (await listBeamBodyEvents(C.id)).find((e) => e.kind === "RETURN_EMPTY")!;
    await undoBeamBodyEvent(C.id, cRet.id, "dönmemiş", U);
    await cancelWarpingDispatch(o2, d2.dispatch.id, "yanlış sevk", U);
    const b5 = await st(B.id);
    const c5 = await st(C.id);
    check("§5c sevk iptali gövdeleri depoya döndürür: EMPTY_STOCK · depo W", [b5, c5].every((x) => x.status === BeamBodyStatus.EMPTY_STOCK && x.place.warehouse?.id === W && x.place.subcontractor === null), `${b5.status} ${c5.status}`);
    const rev = await prisma.beamBodyEvent.count({ where: { bodyId: { in: [B.id, C.id] }, kind: "SHIP_EMPTY_CANCEL" } });
    check("§5d her gövdeye tipli ters SHIP_EMPTY_CANCEL (ileri satır kalır)", rev === 2 && (await prisma.beamBodyEvent.count({ where: { subcontractorDispatchId: d2.dispatch.id } })) === 2);

    // ── §6 sahibine iade belgesi ──────────────────────────────────────────
    const c1 = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} MUSTERI 1` }, select: { id: true } });
    const c2 = await prisma.customer.create({ data: { code: `${TAG}-C2`, name: `${TAG} FIRMA 2` }, select: { id: true } });
    customerIds.push(c1.id, c2.id);
    const D = await body({ kind: "CUSTOMER", customerId: c1.id });
    const E = await body({ kind: "CUSTOMER", customerId: c1.id });
    const F = await body({ kind: "OTHER", customerId: c2.id });
    const cand = await listOwnerReturnCandidates(c1.id);
    check("§6a aday listesi sahip bazında: c1 → D, E", cand.length === 1 && cand[0]!.owner.id === c1.id && cand[0]!.bodies.map((x) => x.id).sort().join(",") === [D.id, E.id].sort().join(","));
    const docsBefore = await prisma.beamBodyReturn.count({ where: { ownerCustomerId: c1.id } });
    const mis = await errOf(() => { const t = randomUUID(); returnTokens.push(t); return createBeamBodyReturn({ clientToken: t, ownerCustomerId: c1.id, bodyIds: [D.id, F.id] }, U); });
    const dAfterMis = await st(D.id);
    check("§6b başka sahibin gövdesi → 400 BEAM_BODY_OWNER_MISMATCH, belge ve geçiş tümüyle geri", mis?.status === 400 && mis.code === "BEAM_BODY_OWNER_MISMATCH" && dAfterMis.status === BeamBodyStatus.EMPTY_STOCK && (await prisma.beamBodyReturn.count({ where: { ownerCustomerId: c1.id } })) === docsBefore, show(mis));
    const ours = await errOf(() => { const t = randomUUID(); returnTokens.push(t); return createBeamBodyReturn({ clientToken: t, ownerCustomerId: c1.id, bodyIds: [B.id] }, U); });
    check("§6c bizim gövde → 400 BEAM_BODY_OWNER_MISMATCH", ours?.status === 400 && ours.code === "BEAM_BODY_OWNER_MISMATCH", show(ours));
    const rTok = randomUUID();
    returnTokens.push(rTok);
    const r1 = await createBeamBodyReturn({ clientToken: rTok, ownerCustomerId: c1.id, bodyIds: [E.id, D.id], plateNumber: "34 TST 01" }, U);
    const yymm = r1.data.createdAt.slice(2, 4) + r1.data.createdAt.slice(5, 7);
    check("§6d belge LGI-YYMM-NNNN · 2 kalem · ACTIVE", new RegExp(`^LGI-\\d{4}-\\d{4,}$`).test(r1.data.docNo) && r1.data.items.length === 2 && r1.data.status === "ACTIVE", `${r1.data.docNo} (${yymm})`);
    const d6 = await st(D.id);
    check("§6e gövde RETURNED_TO_OWNER · yer boş · artık aday değil", d6.status === BeamBodyStatus.RETURNED_TO_OWNER && !d6.place.warehouse && !d6.place.subcontractor && (await listOwnerReturnCandidates(c1.id)).length === 0);
    const r2 = await createBeamBodyReturn({ clientToken: rTok, ownerCustomerId: c1.id, bodyIds: [D.id, E.id] }, U);
    check("§6f aynı deneme → replayed, aynı belge", r2.replayed && r2.data.id === r1.data.id);
    const dRet = (await listBeamBodyEvents(D.id)).find((e) => e.kind === "RETURN_TO_OWNER")!;
    const retUndo = await errOf(() => undoBeamBodyEvent(D.id, dRet.id, "deneme", U));
    check("§6g iade olayı elle geri alınmaz → 409 BEAM_BODY_EVENT_DOCUMENT; geçmişte belge no", retUndo?.code === "BEAM_BODY_EVENT_DOCUMENT" && dRet.document?.kind === "OWNER_RETURN" && dRet.document.no === r1.data.docNo, show(retUndo));
    const lst = await listBeamBodyReturns({ ownerCustomerId: c1.id, status: "all", limit: 50 });
    check("§6h liste + özet tek where: 1 belge · 2 gövde", lst.data.length === 1 && lst.summary.count === 1 && lst.summary.bodyCount === 2);
    const pvR = await previewCancelBeamBodyReturn(r1.data.id);
    check("§6i iptal önizlemesi: iptal edilebilir · etkilenen 2 gövde listelenir", pvR.cancellable && pvR.items.length === 2 && pvR.items.every((i) => i.blocker === null));
    const cancelled = await cancelBeamBodyReturn(r1.data.id, "yanlış sahip", U);
    const d7 = await st(D.id);
    check("§6j iptal: belge CANCELLED · gövde EMPTY_STOCK · depo W · kalem olayları ters", cancelled.status === "CANCELLED" && d7.status === BeamBodyStatus.EMPTY_STOCK && d7.place.warehouse?.id === W && cancelled.items.every((i) => i.reversed));
    const twice = await errOf(() => cancelBeamBodyReturn(r1.data.id, "tekrar", U));
    check("§6k çift iptal → 409 BEAM_BODY_RETURN_CANCELLED", twice?.status === 409 && twice.code === "BEAM_BODY_RETURN_CANCELLED", show(twice));
    const deadTok = await errOf(() => createBeamBodyReturn({ clientToken: rTok, ownerCustomerId: c1.id, bodyIds: [D.id, E.id] }, U));
    check("§6l iptal edilmiş belgenin token'ı → 409 BEAM_BODY_RETURN_CANCELLED", deadTok?.status === 409 && deadTok.code === "BEAM_BODY_RETURN_CANCELLED", show(deadTok));
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const rets = await prisma.beamBodyReturn.findMany({ where: { OR: [{ clientToken: { in: returnTokens } }, { items: { some: { bodyId: { in: ids } } } }] }, select: { id: true } });
    await prisma.beamBodyReturnItem.deleteMany({ where: { returnId: { in: rets.map((r) => r.id) } } });
    await prisma.beamBodyReturn.deleteMany({ where: { id: { in: rets.map((r) => r.id) } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    const ds = await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } });
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
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...dids, ...ids, ...rets.map((r) => r.id)] } } });
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
