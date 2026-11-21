// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ (devere ek E1): tek irsaliye, aynı deverecinin N siparişi
// =============================================================================
// Fikstür: kart X 3000 tel × 150 den → 1000 m = 50 kg. A ve B (aynı devereci) 300'er kg; C başka devereci.
//   §0  tek kaynak: sarım yazımı yalnız `receive-core.receiveOrderLinesTx`; ayar varsayılanları = bugün (WARN · OPTIONAL)
//   E1  önizleme (sipariş başı, YAZMAZ) → belge DK- no, sipariş başı ayrı kabul anahtarı, her sarımda belge bağı, tutmalar
//   E7  replay aynı belge; başka içerik 409 · E2 tek sipariş belge · E9 eski /receive çalışır + uyarı
//   E5  irsaliye tekrarı WARN uyarı (harf duyarsız) · ALLOW sessiz · BLOCK 409 (önizlemede uyarı) · yarış: BLOCK'ta iki belge → biri 409
//   E3  karışık devereci / devereci uyuşmazlığı 400 · sipariş tekrarı, belge içi gövde no tekrarı 400
//   E4  bir sipariş kapalı → 409 ve HİÇBİR sipariş yazılmaz · E8 tartı REQUIRED 400 / OFF 400
//   B3/C1 gövde ve yeniden sarım satır başına korunur · okuma: irsaliye no ile grup (belgeli + eski), liste/özet, DTO
//   sipariş kısmı stornosu (LIFO, belgenin diğer siparişine dokunmaz) → belge replay'i 409 WARP_BEAM_CANCELLED · DB CHECK
// NEGATİF SONDA: `receive.ts` `receiveWarpingOrder`dan `lockDeliveryNoteTx` çıkarılınca ikinci yarış KIRMIZI (belgeleri belge no
// kilidi de serileştirir; ilk yarış o yüzden sonda değildir — arşiv "Devere ek E1").
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, WarpingOrderStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA, TEST_SANDING } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { readDevereDuplicateDeliveryNote, readDevereReceiveWeighing } from "../src/services/system-setting/devere-receive";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { listWarpingYarnHoldings } from "../src/services/warping-order/yarn-return";
import { receiveWarpingOrder, type WarpingReceiveBeamInput } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { listWarpingReceipts } from "../src/services/warping-order/receipts";
import { createWarpingBeamRejection } from "../src/services/warping-order/beam-rejection";
import { createWarpingReceiveDoc, previewWarpingReceiveDoc, type WarpingReceiveDocOrderInput } from "../src/services/warping-order/receive-doc";
import { getDeliveryNoteGroup, getWarpingReceiveDoc, listWarpingReceiveDocs } from "../src/services/warping-order/receive-doc-read";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDKB-${process.pid}`;
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
  console.log("=== FASON DEVERE DÖNÜŞ KABUL BELGESİ (E1) ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sub2 = await ensureTestSubcontractor(TEST_SANDING);
  const whId = await fixtureWarehouseId();
  const yarnIds: string[] = [];
  const lotIds: string[] = [];
  const orderIds: string[] = [];
  const specIds: string[] = [];
  try {
    // ── §0 tek kaynak + varsayılan = bugün ───────────────────────────────
    const svc = path.join(__dirname, "../src/services/warping-order");
    const src = (f: string) => fs.readFileSync(path.join(svc, f), "utf8");
    check("§0 sarım yazımı yalnız receive-core (tek sipariş ve belge aynı çekirdeği çağırır)",
      src("receive-core.ts").includes("tx.warpBeam.create(") && !src("receive.ts").includes("warpBeam.create(") && !src("receive-doc.ts").includes("warpBeam.create(")
      && src("receive.ts").includes("receiveOrderLinesTx(") && src("receive-doc.ts").includes("receiveOrderLinesTx("));
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, SETTING_KEYS.DEVERE_RECEIVE_WEIGHING] } } });
    check("§0 satır yokken irsaliye tekrarı WARN, tartı OPTIONAL (bugünkü davranış)", (await readDevereDuplicateDeliveryNote()) === "WARN" && (await readDevereReceiveWeighing()) === "OPTIONAL");
    await setSetting(SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "çöp");
    check("§0 tanınmayan değer varsayılana düşer", (await readDevereDuplicateDeliveryNote()) === "WARN");

    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.IPLIK_ENABLED, "true"], [SETTING_KEYS.DEVERE_LOT_REQUIRED, "false"], [SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_REJECT_PHOTO_REQUIRED, "false"], [SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "WARN"], [SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "OPTIONAL"]] as const) await setSetting(k, v);
    await reconcileReasonPresets();

    const X = (await prisma.item.create({ data: { code: `${TAG}-X`, name: `${TAG} iplik X`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    yarnIds.push(X);
    const lx = (await prisma.yarnLot.create({ data: { itemId: X, lotNo: `${TAG}-XL` }, select: { id: true } })).id;
    lotIds.push(lx);
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: X, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 2000, lotId: lx, reason: `${TAG} giriş` }));
    const spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} zemin`, yarnItemId: X, endsCount: 3000, yarns: { create: [{ yarnItemId: X, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    specIds.push(spec);
    const newOrder = async (subcontractorId: string, kg: number) => {
      const r = await createWarpingOrder({ subcontractorId, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: spec, beamLines: [{ beamCount: 10, beamLengthM: 1000 }] }, U);
      orderIds.push(r.data.id);
      await dispatchWarpingOrder(r.data.id, { clientToken: randomUUID(), lines: [{ yarnItemId: X, warehouseId: whId, lotId: lx, qtyKg: kg }] }, U);
      return r.data.id;
    };
    const holds = async (orderId: string) => (await listWarpingYarnHoldings(orderId)).reduce((s, h) => s + Number(h.holdingKg), 0);
    const beamCount = (orderId: string) => prisma.warpBeam.count({ where: { warpingOrderId: orderId } });
    const L = (n: number, extra: Partial<WarpingReceiveBeamInput> = {}): WarpingReceiveBeamInput[] => Array.from({ length: n }, () => ({ lengthM: 1000, ...extra }));
    const doc = (orders: WarpingReceiveDocOrderInput[], deliveryNoteNo: string, clientToken: string = randomUUID(), subcontractorId?: string) =>
      createWarpingReceiveDoc({ clientToken, deliveryNoteNo, orders, ...(subcontractorId ? { subcontractorId } : {}) }, U);

    const A = await newOrder(sub.id, 300);
    const B = await newOrder(sub.id, 300);
    const C = await newOrder(sub2.id, 100);
    const NOTE = `${TAG}-IRS1`;

    // ── E1 önizleme ──────────────────────────────────────────────────────
    const pv = await previewWarpingReceiveDoc({ deliveryNoteNo: NOTE, orders: [{ warpingOrderId: B, beams: L(1) }, { warpingOrderId: A, beams: L(2) }] });
    const sortedAB = [A, B].sort();
    check("E1 önizleme: 2 sipariş (id sırası) · 3 levent · 3000 m · ilk kullanım uyarısız · YAZMAZ",
      pv.totals.orderCount === 2 && pv.totals.beamCount === 3 && pv.totals.lengthM === "3000.000" && pv.orders.map((o) => o.warpingOrderId).join() === sortedAB.join()
      && pv.deliveryNoteUses.length === 0 && pv.subcontractorId === sub.id && (await beamCount(A)) === 0 && (await beamCount(B)) === 0, JSON.stringify(pv.totals));

    // ── E1 kabul ─────────────────────────────────────────────────────────
    const tok1 = randomUUID();
    const body1: WarpingReceiveDocOrderInput[] = [{ warpingOrderId: A, beams: [{ lengthM: 1000, physicalBeamNo: `${TAG}-G1`, newBody: { owner: { kind: "OURS" } } }, { lengthM: 1000, grossKg: 80, tareKg: 30 }] }, { warpingOrderId: B, beams: L(1) }];
    const d1 = await doc(body1, NOTE, tok1);
    const beamsD1 = await prisma.warpBeam.findMany({ where: { warpingReceiveDocId: d1.data.id }, select: { warpingOrderId: true, warpingReceiptKey: true, beamBodyId: true, events: { where: { kind: "WOUND" }, select: { deliveryNoteNo: true, clientToken: true } } } });
    const keys = new Set(beamsD1.map((b) => b.warpingReceiptKey));
    const orderA = await prisma.warpingOrder.findUniqueOrThrow({ where: { id: A }, select: { status: true } });
    check("E1 belge: DK-YYMM-NNNN · 2 sipariş · 3 levent · sipariş başı AYRI kabul anahtarı · WOUND'da irsaliye no, token yok",
      /^DK-\d{4}-\d{4}$/.test(d1.data.docNo) && !d1.replayed && d1.data.totals.orderCount === 2 && beamsD1.length === 3 && keys.size === 2
      && beamsD1.every((b) => b.events[0]?.deliveryNoteNo === NOTE && b.events[0]?.clientToken === null), `${d1.data.docNo} ${keys.size}`);
    check("E1 tutmalar: A 300−100=200 · B 300−50=250 · A IN_PROGRESS · gövde (B3) satırda bağlı",
      (await holds(A)) === 200 && (await holds(B)) === 250 && orderA.status === WarpingOrderStatus.IN_PROGRESS && beamsD1.filter((b) => b.beamBodyId).length === 1);
    const recA = await listWarpingReceipts(A);
    check("E1 sipariş kabul DTO'su belgeyi taşır (receiveDoc.docNo) · tartı satırda korunur", recA.receipts[0]?.receiveDoc?.docNo === d1.data.docNo && recA.receipts[0]?.beams.some((b) => b.weighedNetKg === "50.000") === true);

    // ── E7 replay ────────────────────────────────────────────────────────
    const r1 = await doc(body1, NOTE, tok1);
    const eCol = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }], NOTE, tok1));
    check("E7 replay: aynı token + içerik → aynı belge, yeni levent yok · başka içerik 409 CLIENT_TOKEN_COLLISION",
      r1.replayed && r1.data.id === d1.data.id && (await beamCount(A)) === 2 && eCol?.code === "CLIENT_TOKEN_COLLISION", show(eCol));

    // ── E5 irsaliye tekrarı · E9 eski uç ─────────────────────────────────
    const old = await receiveWarpingOrder(A, { clientToken: randomUUID(), deliveryNoteNo: NOTE.toLowerCase(), beams: L(1) }, U);
    check("E9 eski /receive çalışır · E5 WARN: aynı no (harf duyarsız) uyarı verir, belge no'su anılır",
      old.liveBeamCount === 1 && old.receiveDoc === null && old.warnings.some((w) => w.includes("daha önce kullanıldı") && w.includes(d1.data.docNo)), JSON.stringify(old.warnings));
    await setSetting(SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "ALLOW");
    const allow = await doc([{ warpingOrderId: B, beams: L(1) }], NOTE);
    check("E5 ALLOW: aynı no sessiz kabul", !allow.warnings.some((w) => w.includes("daha önce kullanıldı")), JSON.stringify(allow.warnings));
    await setSetting(SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "BLOCK");
    const nB = await beamCount(B);
    const eBlk = await errOf(() => doc([{ warpingOrderId: B, beams: L(1) }], NOTE));
    const eBlkOld = await errOf(() => receiveWarpingOrder(B, { clientToken: randomUUID(), deliveryNoteNo: NOTE, beams: L(1) }, U));
    const pvBlk = await previewWarpingReceiveDoc({ deliveryNoteNo: NOTE, orders: [{ warpingOrderId: B, beams: L(1) }] });
    check("E5 BLOCK: belge ve eski uç 409 WARPING_DELIVERY_NOTE_USED, yazılmaz · önizleme engeli uyarı olarak gösterir",
      eBlk?.code === "WARPING_DELIVERY_NOTE_USED" && eBlk.status === 409 && eBlkOld?.code === "WARPING_DELIVERY_NOTE_USED" && (await beamCount(B)) === nB
      && pvBlk.deliveryNoteUses.length >= 2 && pvBlk.warnings.some((w) => w.includes("engelli")), show(eBlk));
    const NOTE2 = `${TAG}-IRS2`;
    const race = await Promise.allSettled([doc([{ warpingOrderId: A, beams: L(1) }], NOTE2), doc([{ warpingOrderId: B, beams: L(1) }], NOTE2)]);
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as { details?: { code?: string } }).details?.code);
    check("Yarış: BLOCK'ta aynı yeni no ile iki eşzamanlı belge → biri kabul, biri 409 WARPING_DELIVERY_NOTE_USED",
      race.filter((r) => r.status === "fulfilled").length === 1 && lost.length === 1 && lost[0] === "WARPING_DELIVERY_NOTE_USED", JSON.stringify(lost));
    // Belgeleri belge no kilidi de serileştirir; irsaliye kilidinin tek bekçisi eski uç × eski uç / belge yarışıdır.
    const NOTE3 = `${TAG}-IRS3`;
    const race2 = await Promise.allSettled([
      receiveWarpingOrder(A, { clientToken: randomUUID(), deliveryNoteNo: NOTE3, beams: L(1) }, U),
      receiveWarpingOrder(B, { clientToken: randomUUID(), deliveryNoteNo: NOTE3, beams: L(1) }, U),
      doc([{ warpingOrderId: B, beams: L(1) }], NOTE3),
    ]);
    const lost2 = race2.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as { details?: { code?: string } }).details?.code);
    check("Yarış: BLOCK'ta aynı yeni no ile iki eski /receive (farklı sipariş) + bir belge → yalnız biri kabul, ikisi 409",
      race2.filter((r) => r.status === "fulfilled").length === 1 && lost2.length === 2 && lost2.every((c) => c === "WARPING_DELIVERY_NOTE_USED"), JSON.stringify(lost2));
    await setSetting(SETTING_KEYS.DEVERE_DUPLICATE_DELIVERY_NOTE, "WARN");

    // ── E3 · kapılar ─────────────────────────────────────────────────────
    const eMix = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: C, beams: L(1) }], `${TAG}-M`));
    const eSub = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }], `${TAG}-M`, randomUUID(), sub2.id));
    const eMixPv = await errOf(() => previewWarpingReceiveDoc({ deliveryNoteNo: null, orders: [{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: C, beams: L(1) }] }));
    const eDup = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: A, beams: L(1) }], `${TAG}-M`));
    const ePhy = await errOf(() => doc([{ warpingOrderId: A, beams: L(1, { physicalBeamNo: `${TAG}-P` }) }, { warpingOrderId: B, beams: L(1, { physicalBeamNo: `${TAG}-P` }) }], `${TAG}-M`));
    check("E3 karışık devereci 400 (kabul + önizleme) · seçilen devereci uyuşmazlığı 400 · sipariş tekrarı 400 · belge içi gövde no tekrarı 400 · C'ye levent yazılmaz",
      eMix?.code === "WARPING_RECEIVE_DOC_MIXED_SUBCONTRACTOR" && eSub?.code === "WARPING_RECEIVE_DOC_MIXED_SUBCONTRACTOR" && eMixPv?.code === "WARPING_RECEIVE_DOC_MIXED_SUBCONTRACTOR"
      && eDup?.code === "WARPING_RECEIVE_DOC_DUPLICATE_ORDER" && ePhy?.code === "WARPING_RECEIVE_DUPLICATE_PHYSICAL" && (await beamCount(C)) === 0, `${show(eMix)} | ${show(ePhy)}`);

    // ── E4 hep-ya-hiç ────────────────────────────────────────────────────
    await prisma.warpingOrder.update({ where: { id: B }, data: { status: WarpingOrderStatus.COMPLETED, completedAt: new Date() } });
    const [nA4, nB4, docs4] = [await beamCount(A), await beamCount(B), await prisma.warpingReceiveDoc.count({ where: { subcontractorId: sub.id } })];
    const eClosed = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: B, beams: L(1) }], `${TAG}-K`));
    check("E4 bir sipariş kapalı → 409 WARPING_ORDER_NOT_RECEIVABLE · A'ya da yazılmaz · belge doğmaz",
      eClosed?.code === "WARPING_ORDER_NOT_RECEIVABLE" && (await beamCount(A)) === nA4 && (await beamCount(B)) === nB4 && (await prisma.warpingReceiveDoc.count({ where: { subcontractorId: sub.id } })) === docs4, show(eClosed));
    await prisma.warpingOrder.update({ where: { id: B }, data: { status: WarpingOrderStatus.IN_PROGRESS, completedAt: null } });

    // ── E8 tartı kipi ────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "REQUIRED");
    const eReq = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }], `${TAG}-T`));
    const eReqOld = await errOf(() => receiveWarpingOrder(A, { clientToken: randomUUID(), deliveryNoteNo: `${TAG}-T`, beams: L(1) }, U));
    const okReq = await doc([{ warpingOrderId: A, beams: L(1, { grossKg: 90, tareKg: 40 }) }], `${TAG}-T`);
    await setSetting(SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "OFF");
    const eOff = await errOf(() => doc([{ warpingOrderId: A, beams: L(1, { grossKg: 90 }) }], `${TAG}-T2`));
    await setSetting(SETTING_KEYS.DEVERE_RECEIVE_WEIGHING, "OPTIONAL");
    check("E8 REQUIRED: tartısız satır 400 (belge + eski uç), tartılı kabul · OFF: tartı girdisi 400",
      eReq?.code === "WARPING_RECEIVE_WEIGHING_REQUIRED" && eReqOld?.code === "WARPING_RECEIVE_WEIGHING_REQUIRED" && okReq.data.totals.liveBeamCount === 1 && eOff?.code === "WARPING_RECEIVE_WEIGHING_OFF", `${show(eReq)} | ${show(eOff)}`);

    // ── C1 yeniden sarım satır başına ────────────────────────────────────
    const bOnly = await prisma.warpBeam.findFirstOrThrow({ where: { warpingOrderId: B, warpingReceiveDocId: d1.data.id }, select: { id: true } });
    await createWarpingBeamRejection({ clientToken: randomUUID(), warpingOrderId: B, beamIds: [bOnly.id], reasonCode: "TEL_KOPUK", expectRework: true }, U);
    const d2 = await doc([{ warpingOrderId: A, beams: L(1) }, { warpingOrderId: B, beams: [{ lengthM: 1000, reworkOfBeamId: bOnly.id }] }], `${TAG}-RW`);
    const rw = await prisma.warpBeam.findFirst({ where: { warpingReceiveDocId: d2.data.id, reworkOfBeamId: bOnly.id }, select: { warpingOrderId: true } });
    check("C1 yeniden sarım bağı belge satırında korunur (B'nin reddedilen sarımı)", rw?.warpingOrderId === B && d2.data.totals.orderCount === 2);

    // ── Okuma ────────────────────────────────────────────────────────────
    const grp = await getDeliveryNoteGroup(sub.id, NOTE.toLowerCase());
    check("Okuma: irsaliye no ile grup — belgeler (d1 + ALLOW) ve belgesiz eski kabul birlikte",
      grp.docs.map((d) => d.id).includes(d1.data.id) && grp.docs.length === 2 && grp.receipts.length === 1 && grp.receipts[0]!.warpingOrderId === A, `${grp.docs.length} ${grp.receipts.length}`);
    const list = await listWarpingReceiveDocs({ subcontractorId: sub.id, deliveryNoteNo: NOTE, limit: 1 });
    const dto = await getWarpingReceiveDoc(d1.data.id);
    check("Okuma: liste tek where — süzgeç irsaliye no: özet 2 belge, sayfa 1 + imleç · DTO sipariş başı kabul + toplam 3000 m",
      list.summary.count === 2 && list.data.length === 1 && list.nextCursor !== null && dto.orders.length === 2 && dto.totals.lengthM === "3000.000" && dto.orders.every((o) => o.receipt.receiveDoc?.id === d1.data.id), JSON.stringify(list.summary));

    // ── Sipariş kısmı stornosu (LIFO) + replay ───────────────────────────
    const keyA2 = (await prisma.warpBeam.findFirstOrThrow({ where: { warpingReceiveDocId: d2.data.id, warpingOrderId: A }, select: { warpingReceiptKey: true } })).warpingReceiptKey!;
    await cancelWarpingReceipt(A, keyA2, `${TAG} storno`, U);
    const liveB = await prisma.warpBeam.count({ where: { warpingReceiveDocId: d2.data.id, warpingOrderId: B, status: { not: "CANCELLED" } } });
    const d2dto = await getWarpingReceiveDoc(d2.data.id);
    check("Sipariş kısmı stornosu: belgenin A kabulü geri alınır, B kısmı canlı kalır, belge DTO'su iptali gösterir",
      liveB === 1 && d2dto.totals.liveBeamCount === 1 && d2dto.totals.beamCount === 2);
    const tokRp = randomUUID();
    const d3 = await doc([{ warpingOrderId: A, beams: L(1) }], `${TAG}-RP`, tokRp);
    await cancelWarpingReceipt(A, d3.data.orders[0]!.receipt.receiptKey, `${TAG} storno`, U);
    const eDead = await errOf(() => doc([{ warpingOrderId: A, beams: L(1) }], `${TAG}-RP`, tokRp));
    check("E2 tek sipariş belge · stornolu belgenin replay'i 409 WARP_BEAM_CANCELLED", d3.data.totals.orderCount === 1 && eDead?.code === "WARP_BEAM_CANCELLED", show(eDead));

    const ck = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_constraint WHERE conname = 'warp_beams_receive_doc_ck'`;
    check("DB: warp_beams_receive_doc_ck var", Number(ck[0]?.n ?? 0) === 1);
  } finally {
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
    const docIds = (await prisma.warpingReceiveDoc.findMany({ where: { beams: { some: { id: { in: beamIds } } } }, select: { id: true } })).map((d) => d.id);
    docIds.push(...(await prisma.warpingReceiveDoc.findMany({ where: { deliveryNoteNo: { startsWith: TAG } }, select: { id: true } })).map((d) => d.id));
    const rejIds = (await prisma.warpingBeamRejection.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((r) => r.id);
    const bodyIds = (await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } })).map((b) => b.id);
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((d) => d.id);
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
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
