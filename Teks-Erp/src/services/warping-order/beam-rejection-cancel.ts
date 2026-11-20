// =============================================================================
// FASON DEVERE — kusurlu levent RET İPTALİ (devere ek C1): önizleme + iptal
// =============================================================================
// İptal başlıkta damgalanır (üçlü CHECK) + her kalemin `REJECT_OUT` olayına tipli ters `REJECT_OUT_CANCEL`
// (REJECTED→READY); dağıtım yeniden sayılır, tutan siparişin tutmasından DÜŞER. Kapılar: canlı yeniden sarım,
// tutma dağıtıma yetmez, kabul faturalı, gövdenin sonraki hareketi, kapanmış sipariş. Tx sırası: sipariş claim →
// başlık claim → dağıtım kalemleri `id` sırasıyla → engeller TAZE ölçülür → sarımlar `id` sırasıyla.
// =============================================================================
import { Prisma, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { loadWarpingYarnHoldings, lockDispatchItemsTx } from "../helpers/warping-yarn-open.helper";
import { activeWarpingReceiptInvoiceTx } from "../helpers/warping-receipt-guard.helper";
import { beamBodyEventNeighborsTx } from "../helpers/beam-body.helper";
import { WARPING_BEAM_REJECTION_TABLE } from "./beam-rejection-photo";
import { loadRejectBeams, loadRejectionDto, yarnLinesOf, type RejectBeamRow, type RejectYarnLine, type WarpingBeamRejectionDto } from "./beam-rejection-read";

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface Blocker { code: string; message: string }
export interface WarpingBeamRejectionCancelPreview {
  doc: WarpingBeamRejectionDto;
  cancellable: boolean;
  blockers: Blocker[];
  /** Etkilenen HER sarım: iptalde "Hazır"a döner; engelli olan nedeniyle. */
  items: Array<{ beamId: string; beamNo: string; status: WarpBeamStatus; blocker: string | null }>;
  /** İptalle tutmadan YENİDEN düşecek iplik (kalem × tutan sipariş) + tutanın bugünkü tutması. */
  yarn: Array<RejectYarnLine & { holdingKg: string; enough: boolean }>;
  reasonRequired: true;
}

interface Measure { head: { id: string; docNo: string; warpingOrderId: string; cancelledAt: Date | null }; orderNo: string; orderStatus: WarpingOrderStatus; beams: RejectBeamRow[]; items: Array<{ warpBeamId: string; eventId: string }>; blockers: Blocker[]; rows: WarpingBeamRejectionCancelPreview["items"]; yarn: WarpingBeamRejectionCancelPreview["yarn"] }

async function loadHead(db: Db, id: string) {
  const head = await db.warpingBeamRejection.findUnique({
    where: { id },
    select: { id: true, docNo: true, warpingOrderId: true, subcontractorId: true, cancelledAt: true, warpingOrder: { select: { orderNo: true, status: true } }, items: { select: { warpBeamId: true, eventId: true }, orderBy: { warpBeamId: "asc" } } },
  });
  if (!head) throw AppError.notFound("Ret belgesi bulunamadı.", { code: "WARPING_REJECTION_NOT_FOUND" });
  return head;
}

/** Tutma yeterliliği: iptalde dağıtım yeniden sayılır → tutan siparişin bugünkü tutması dağıtım kg'ını karşılamalı. */
async function measureYarn(db: Db, subcontractorId: string, beams: RejectBeamRow[]): Promise<Measure["yarn"]> {
  const lines = yarnLinesOf(beams);
  if (lines.length === 0) return [];
  const holdings = await loadWarpingYarnHoldings(db, { subcontractorIds: [subcontractorId], yarnItemIds: [...new Set(lines.map((l) => l.yarnItemId))] });
  const held = new Map<string, Prisma.Decimal>();
  for (const h of holdings) held.set(`${h.dispatchItemId}|${h.warpingOrderId}`, (held.get(`${h.dispatchItemId}|${h.warpingOrderId}`) ?? D(0)).plus(h.kg));
  return lines.map((l) => {
    const have = held.get(`${l.dispatchItemId}|${l.holderWarpingOrderId}`) ?? D(0);
    return { ...l, holdingKg: have.toFixed(3), enough: have.gte(l.kg) };
  });
}

async function bodyMoved(db: Db, b: RejectBeamRow): Promise<boolean> {
  if (!b.beamBody) return false;
  const fwd = await db.beamBodyEvent.findFirst({ where: { bodyId: b.beamBody.id, warpBeamId: b.id, kind: "SHIPPED_FULL", reversal: { is: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, bodyId: true, createdAt: true } });
  if (!fwd) return false;
  return (await beamBodyEventNeighborsTx(db, fwd)).later > 0;
}

/** `selfCancelled`: iptal tx'i başlığı az önce kendisi damgaladı — "zaten iptal" engeli sayılmaz, kalemler ölçülür. */
async function measure(db: Db, id: string, selfCancelled = false): Promise<Measure> {
  const loaded = await loadHead(db, id);
  const head = selfCancelled ? { ...loaded, cancelledAt: null } : loaded;
  const beams = await loadRejectBeams(db, head.items.map((i) => i.warpBeamId));
  const blockers: Blocker[] = [];
  if (head.cancelledAt) blockers.push({ code: "WARPING_REJECTION_CANCELLED", message: `${head.docNo} zaten iptal edilmiş.` });
  const st = head.warpingOrder.status;
  if (st !== WarpingOrderStatus.IN_PROGRESS) {
    blockers.push({ code: st === WarpingOrderStatus.COMPLETED ? "WARPING_ORDER_COMPLETED" : "WARPING_ORDER_NOT_REJECTABLE", message: `${head.warpingOrder.orderNo} durumu ${st}${st === WarpingOrderStatus.COMPLETED ? " — önce siparişi yeniden açın" : ""}.` });
  }
  const rows: Measure["rows"] = [];
  const invoiced = new Map<string, string | null>();
  for (const b of beams) {
    let blocker: Blocker | null = null;
    const key = b.warpingReceiptKey;
    if (key && !invoiced.has(key)) invoiced.set(key, (await activeWarpingReceiptInvoiceTx(db, key))?.docNo ?? null);
    const inv = key ? invoiced.get(key) ?? null : null;
    if (head.cancelledAt) blocker = null;
    else if (b.status !== WarpBeamStatus.REJECTED) blocker = { code: "WARP_BEAM_STATE", message: `${b.beamNo} durumu ${b.status} — reddedilmiş değil` };
    else if (b.reworks[0]) blocker = { code: "WARPING_REWORK_ACTIVE", message: `${b.beamNo} için yeniden sarım kabul edilmiş (${b.reworks[0].beamNo}) — önce o kabulü geri alın` };
    else if (inv) blocker = { code: "WARPING_RECEIPT_INVOICED", message: `${b.beamNo} kabulü faturalı (${inv}) — önce faturayı iptal edin ya da bağını kaldırın` };
    else if (await bodyMoved(db, b)) blocker = { code: "BEAM_BODY_EVENT_NOT_LATEST", message: `${b.beamNo} gövdesinin retten sonra başka hareketi var` };
    if (blocker) blockers.push({ code: blocker.code, message: `${blocker.message}.` });
    rows.push({ beamId: b.id, beamNo: b.beamNo, status: b.status, blocker: blocker?.message ?? null });
  }
  const yarn = head.cancelledAt ? [] : await measureYarn(db, head.subcontractorId, beams);
  const short = yarn.find((y) => !y.enough);
  if (short) {
    blockers.push({ code: "WARPING_HOLDING_INSUFFICIENT", message: `${short.dispatchNo} (${short.name || short.code}) ${short.holderOrderNo} tutması ${short.holdingKg} kg — iptal ${short.kg} kg ister (iplik iade/aktarma/fire ile tüketilmiş).` });
  }
  return { head, orderNo: head.warpingOrder.orderNo, orderStatus: st, beams, items: head.items, blockers, rows, yarn };
}

export async function previewCancelWarpingBeamRejection(id: string): Promise<WarpingBeamRejectionCancelPreview> {
  const m = await measure(prisma, id);
  return { doc: await loadRejectionDto(prisma, id), cancellable: m.blockers.length === 0, blockers: m.blockers, items: m.rows, yarn: m.yarn, reasonRequired: true };
}

async function cancelTx(tx: Prisma.TransactionClient, id: string, reason: string, userId: string) {
  const head = await loadHead(tx, id);
  const oc = await tx.warpingOrder.updateMany({ where: { id: head.warpingOrderId, status: WarpingOrderStatus.IN_PROGRESS }, data: { updatedById: userId } });
  if (oc.count === 0) {
    const o = await tx.warpingOrder.findUniqueOrThrow({ where: { id: head.warpingOrderId }, select: { orderNo: true, status: true } });
    const done = o.status === WarpingOrderStatus.COMPLETED;
    throw AppError.conflict(`${o.orderNo} durumu ${o.status} — ret iptal edilemez${done ? "; önce siparişi yeniden açın" : ""}.`, { code: done ? "WARPING_ORDER_COMPLETED" : "WARPING_ORDER_NOT_REJECTABLE", status: o.status });
  }
  const hc = await tx.warpingBeamRejection.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason } });
  if (hc.count === 0) throw AppError.conflict(`${head.docNo} zaten iptal edilmiş.`, { code: "WARPING_REJECTION_CANCELLED" });
  await lockDispatchItemsTx(tx, yarnLinesOf(await loadRejectBeams(tx, head.items.map((i) => i.warpBeamId))).map((l) => l.dispatchItemId));
  // Kilitlerden sonra TAZE ölçüm (eşzamanlı iade/aktarma/yeniden sarım aynı kalemi/sarımı değiştirmiş olabilir).
  const m = await measure(tx, id, true);
  const blocker = m.blockers[0];
  if (blocker) throw AppError.conflict(blocker.message, { code: blocker.code });
  const lenOf = new Map(m.beams.map((b) => [b.id, b.events.find((e) => e.kind === "REJECT_OUT" && e.reversal === null)?.lengthM ?? null]));
  const done: Array<{ beamId: string; beamNo: string; eventId: string; reversesId: string }> = [];
  for (const it of m.items) {
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: it.warpBeamId, kind: "REJECT_OUT_CANCEL", from: WarpBeamStatus.REJECTED, to: WarpBeamStatus.READY,
      data: { reversesEventId: it.eventId, lengthM: lenOf.get(it.warpBeamId) ?? null, reason, createdById: userId },
    });
    done.push({ beamId: it.warpBeamId, beamNo: m.beams.find((b) => b.id === it.warpBeamId)?.beamNo ?? "", eventId: ev.id, reversesId: it.eventId });
  }
  return { docNo: head.docNo, warpingOrderId: head.warpingOrderId, done };
}

export async function cancelWarpingBeamRejection(id: string, reasonRaw: string, userId: string): Promise<WarpingBeamRejectionDto> {
  const reason = reasonRaw.trim();
  if (reason.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı.", { code: "WARPING_REJECTION_CANCEL_REASON" });
  const out = await prisma.$transaction((tx) => cancelTx(tx, id, reason.slice(0, 300), userId));
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_BEAM_REJECTION_TABLE, recordId: id, newData: { cancelled: true, docNo: out.docNo, warpingOrderId: out.warpingOrderId, reason, beamNos: out.done.map((d) => d.beamNo) } });
  for (const d of out.done) {
    await logWarpBeamEventAudit({ userId, eventId: d.eventId, kind: "REJECT_OUT_CANCEL", data: { beamId: d.beamId, beamNo: d.beamNo, reversesEventId: d.reversesId, warpingBeamRejectionId: id, reason } });
  }
  return loadRejectionDto(prisma, id);
}
