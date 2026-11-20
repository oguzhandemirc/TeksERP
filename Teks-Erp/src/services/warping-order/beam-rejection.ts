// =============================================================================
// FASON DEVERE — kusurlu levent RET BELGESİ (`DR-YYMM-NNNN`): önizleme + ret (devere ek C1)
// =============================================================================
// Ret İLERİ olaydır (storno değil): sarım başına `REJECT_OUT` (READY→REJECTED) + kalem; iplik için satır YAZILMAZ —
// reddedilen sarımın dağıtımı `LIVE_ALLOCATION`dan düşer, tutan siparişin tutmasına kendiliğinden döner. Tx sırası:
// no kilidi İLK (8029) → sipariş claim'i (kabul/storno/iade aynı satırda sıraya girer) → dağıtım kalemleri `id` sırasıyla
// → TAZE değerlendirme → başlık → sarımlar `id` sırasıyla → fotoğraflar. Faturalı kabul / kapanmış sipariş 409.
// =============================================================================
import { Prisma, ReasonPresetKind, WarpBeamStatus, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { lockDispatchItemsTx } from "../helpers/warping-yarn-open.helper";
import { activeWarpingReceiptInvoiceTx } from "../helpers/warping-receipt-guard.helper";
import { readDevereRejectPhotoRequired } from "../system-setting";
import { decodeRejectPhoto, writeRejectPhotosTx, WARPING_BEAM_REJECTION_TABLE, WARPING_REJECT_PHOTOS_PER_REQUEST, type RejectPhotoInput } from "./beam-rejection-photo";
import { loadRejectBeams, loadRejectionDto, woundOf, yarnLinesOf, type RejectBeamRow, type RejectYarnLine, type WarpingBeamRejectionDto } from "./beam-rejection-read";

type Db = Prisma.TransactionClient | typeof prisma;
const CODE_SCOPE = "warpingBeamRejection";
const REJECTABLE_ORDER: WarpingOrderStatus[] = [WarpingOrderStatus.OPEN, WarpingOrderStatus.IN_PROGRESS];
export const WARPING_REJECT_MAX_BEAMS = 50;

export interface WarpingBeamRejectionInput {
  clientToken: string;
  warpingOrderId: string;
  beamIds: string[];
  reasonCode: string;
  reasonText?: string | null;
  notes?: string | null;
  /** true = "yeniden sarılsın" (kabulde yeniden sarım bağı), false = "iptal, iplik deverecide kalsın". */
  expectRework: boolean;
  rejectedAt?: string | null;
  photos?: RejectPhotoInput[];
}
export type WarpingBeamRejectionPreviewInput = Omit<WarpingBeamRejectionInput, "clientToken" | "photos"> & { photoCount?: number };

interface Reason { code: string; text: string }
interface Evaluation {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractorId: string; subcontractor: { id: string; code: string; name: string } };
  beams: RejectBeamRow[];
  rows: WarpingBeamRejectionPreview["beams"];
  yarn: RejectYarnLine[];
  blockers: Array<{ code: string; message: string }>;
}

const kg3 = (v: Prisma.Decimal.Value | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toFixed(3));

function normalizeBeamIds(ids: string[]): string[] {
  const out = [...new Set(ids)].sort();
  if (out.length === 0) throw AppError.badRequest("Ret belgesinde en az bir sarım olmalı.", { code: "WARPING_REJECT_EMPTY" });
  if (out.length > WARPING_REJECT_MAX_BEAMS) throw AppError.badRequest(`Bir ret belgesinde en çok ${WARPING_REJECT_MAX_BEAMS} sarım olur.`, { code: "WARPING_REJECT_TOO_MANY" });
  return out;
}

/** Sebep kataloğundan (`WARP_BEAM_REJECT`, aktif) — "Diğer" gibi metin isteyen satırda metin zorunlu. */
async function resolveReason(db: Db, code: string, text: string | null | undefined): Promise<Reason> {
  const row = await db.reasonPreset.findFirst({ where: { kind: ReasonPresetKind.WARP_BEAM_REJECT, code: code.trim(), isActive: true }, select: { code: true, label: true, fullText: true, requiresText: true } });
  if (!row) throw AppError.badRequest("Ret sebebi seçin (sebep listesinde olmayan ya da pasif kod).", { code: "WARPING_REJECT_REASON_INVALID" });
  const free = text?.trim() ?? "";
  if (row.requiresText && free.length < 3) throw AppError.badRequest(`"${row.label}" sebebinde açıklama zorunlu (en az 3 karakter).`, { code: "WARPING_REJECT_REASON_TEXT_REQUIRED" });
  return { code: row.code, text: (free || row.fullText || row.label).slice(0, 300) };
}

function parseRejectedAt(raw: string | null | undefined, now: Date): Date {
  if (!raw) return now;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest("Ret tarihi geçersiz.", { code: "WARPING_REJECT_DATE_INVALID" });
  if (d.getTime() > now.getTime() + 5 * 60_000) throw AppError.badRequest("Ret tarihi ileri bir an olamaz.", { code: "WARPING_REJECT_DATE_INVALID" });
  return d;
}

/** Sarım başına engel: aynı sipariş, HAZIR, canlı doğuş, doğuş dışında geri alınmamış ileri hareket yok. */
function beamBlocker(b: RejectBeamRow, orderId: string): string | null {
  if (b.warpingOrderId !== orderId) return "bu siparişin dönüşü değil";
  if (b.status !== WarpBeamStatus.READY) return `durumu ${b.status} — yalnız depoda HAZIR sarım reddedilir`;
  if (!woundOf(b)) return "doğuş kaydı geri alınmış";
  const moved = b.events.find((e) => e.kind !== "WOUND" && !e.kind.endsWith("_CANCEL") && e.reversal === null);
  return moved ? `${moved.kind} hareketi var (tüketim/düzeltme/sevk geçmişi) — reddedilemez` : null;
}

async function evaluate(db: Db, orderId: string, beamIds: string[]): Promise<Evaluation> {
  const order = await db.warpingOrder.findUnique({ where: { id: orderId }, select: { id: true, orderNo: true, status: true, subcontractorId: true, subcontractor: { select: { id: true, code: true, name: true } } } });
  if (!order) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const blockers: Evaluation["blockers"] = [];
  if (!REJECTABLE_ORDER.includes(order.status)) {
    blockers.push(order.status === WarpingOrderStatus.COMPLETED
      ? { code: "WARPING_ORDER_COMPLETED", message: `${order.orderNo} kapanmış — sarım reddi için önce siparişi yeniden açın.` }
      : { code: "WARPING_ORDER_NOT_REJECTABLE", message: `${order.orderNo} durumu ${order.status} — sarım reddedilemez.` });
  }
  const beams = await loadRejectBeams(db, beamIds);
  if (beams.length !== beamIds.length) throw AppError.badRequest("Seçilen sarımlardan biri bulunamadı.", { code: "WARPING_BEAM_NOT_REJECTABLE" });
  const invoiceByKey = new Map<string, string | null>();
  const rows: Evaluation["rows"] = [];
  for (const b of beams) {
    const w = woundOf(b);
    const key = b.warpingReceiptKey;
    if (key && !invoiceByKey.has(key)) invoiceByKey.set(key, (await activeWarpingReceiptInvoiceTx(db, key))?.docNo ?? null);
    const invoiceDocNo = key ? invoiceByKey.get(key) ?? null : null;
    const blocker = beamBlocker(b, order.id);
    if (blocker) blockers.push({ code: "WARPING_BEAM_NOT_REJECTABLE", message: `${b.beamNo}: ${blocker}.` });
    if (invoiceDocNo) blockers.push({ code: "WARPING_RECEIPT_INVOICED", message: `${b.beamNo}: kabulü faturalı (${invoiceDocNo}) — önce faturayı iptal edin ya da bağını kaldırın.` });
    rows.push({
      id: b.id, beamNo: b.beamNo, status: b.status, lengthM: kg3(w?.lengthM), nominalKg: kg3(w?.theoreticalKg), bodyNo: b.beamBody?.bodyNo ?? null,
      receiptKey: key, deliveryNoteNo: w?.deliveryNoteNo ?? null, receivedAt: w?.createdAt.toISOString() ?? null, invoiceDocNo, blocker,
    });
  }
  return { order, beams, rows, yarn: yarnLinesOf(beams), blockers };
}

function throwFirstBlocker(ev: Evaluation): void {
  const b = ev.blockers[0];
  if (!b) return;
  if (b.code === "WARPING_ORDER_COMPLETED" || b.code === "WARPING_ORDER_NOT_REJECTABLE") throw AppError.conflict(b.message, { code: b.code, status: ev.order.status });
  throw AppError.conflict(b.message, { code: b.code });
}

// ── Önizleme ─────────────────────────────────────────────────────────────────

export interface WarpingBeamRejectionPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractor: { id: string; code: string; name: string } };
  beams: Array<{ id: string; beamNo: string; status: WarpBeamStatus; lengthM: string | null; nominalKg: string | null; bodyNo: string | null; receiptKey: string | null; deliveryNoteNo: string | null; receivedAt: string | null; invoiceDocNo: string | null; blocker: string | null }>;
  /** Retle deverecinin tutmasına DÖNECEK iplik (kalem × tutan sipariş) — istemci sayı türetmez. */
  returnedYarn: RejectYarnLine[];
  totals: { beamCount: number; lengthM: string; nominalKg: string; returnedKg: string };
  reason: Reason | null;
  photoRequired: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
  rejectable: boolean;
}

export async function previewWarpingBeamRejection(input: WarpingBeamRejectionPreviewInput): Promise<WarpingBeamRejectionPreview> {
  const beamIds = normalizeBeamIds(input.beamIds);
  const ev = await evaluate(prisma, input.warpingOrderId, beamIds);
  const photoRequired = await readDevereRejectPhotoRequired();
  const blockers = [...ev.blockers];
  let reason: Reason | null = null;
  if (input.reasonCode) {
    try { reason = await resolveReason(prisma, input.reasonCode, input.reasonText); } catch (e) {
      if (!(e instanceof AppError)) throw e;
      blockers.push({ code: String(e.details?.code ?? "WARPING_REJECT_REASON_INVALID"), message: e.message });
    }
  }
  if (photoRequired && (input.photoCount ?? 0) === 0) blockers.push({ code: "WARPING_REJECT_PHOTO_REQUIRED", message: "Bu kurulumda ret fotoğrafı zorunlu — en az bir fotoğraf ekleyin." });
  const sum = (f: (r: WarpingBeamRejectionPreview["beams"][number]) => string | null) => ev.rows.reduce((s, r) => s.plus(f(r) ?? 0), new Prisma.Decimal(0)).toFixed(3);
  const warnings = ev.yarn.length === 0 && ev.beams.length > 0 ? ["Sarımların iplik dağıtımı yok — tutmaya dönecek iplik görünmüyor."] : [];
  return {
    order: { id: ev.order.id, orderNo: ev.order.orderNo, status: ev.order.status, subcontractor: ev.order.subcontractor },
    beams: ev.rows,
    returnedYarn: ev.yarn,
    totals: { beamCount: ev.rows.length, lengthM: sum((r) => r.lengthM), nominalKg: sum((r) => r.nominalKg), returnedKg: ev.yarn.reduce((s, y) => s.plus(y.kg), new Prisma.Decimal(0)).toFixed(3) },
    reason, photoRequired, blockers, warnings, rejectable: blockers.length === 0 && reason !== null,
  };
}

// ── Ret ──────────────────────────────────────────────────────────────────────

interface PriorRejection { id: string; docNo: string; warpingOrderId: string; reasonCode: string; expectRework: boolean; cancelledAt: Date | null; items: Array<{ warpBeamId: string }> }
export interface CreateWarpingBeamRejectionResult { data: WarpingBeamRejectionDto; replayed: boolean }

function replayFor(input: WarpingBeamRejectionInput, beamIds: string[]) {
  return tokenReplay<PriorRejection, CreateWarpingBeamRejectionResult>({
    find: (db, clientToken) => db.warpingBeamRejection.findUnique({ where: { clientToken }, select: { id: true, docNo: true, warpingOrderId: true, reasonCode: true, expectRework: true, cancelledAt: true, items: { select: { warpBeamId: true } } } }),
    alive: (p) => {
      if (!p.cancelledAt) return;
      throw AppError.conflict(`Bu ret denemesi daha önce kaydedilmiş ve İPTAL edilmiş (${p.docNo}) — yeni ret belgesi açın.`, { code: "WARPING_REJECTION_CANCELLED", rejectionId: p.id });
    },
    identity: (p) => [
      { ad: "warpingOrderId", mevcut: p.warpingOrderId, gelen: input.warpingOrderId },
      { ad: "beamIds", mevcut: p.items.map((i) => i.warpBeamId).sort().join(","), gelen: beamIds.join(",") },
      { ad: "reasonCode", mevcut: p.reasonCode, gelen: input.reasonCode.trim() },
      { ad: "expectRework", mevcut: String(p.expectRework), gelen: String(input.expectRework) },
    ],
    collision: (p) => `Bu işlem kimliği başka içerikli bir ret belgesine (${p.docNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (p) => ({ data: await loadRejectionDto(prisma, p.id), replayed: true }),
  });
}

async function claimOrderTx(tx: Prisma.TransactionClient, orderId: string, userId: string): Promise<void> {
  const claim = await tx.warpingOrder.updateMany({ where: { id: orderId, status: { in: REJECTABLE_ORDER } }, data: { updatedById: userId } });
  if (claim.count === 1) return;
  const o = await tx.warpingOrder.findUnique({ where: { id: orderId }, select: { orderNo: true, status: true } });
  if (!o) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
  const done = o.status === WarpingOrderStatus.COMPLETED;
  throw AppError.conflict(`${o.orderNo} ${done ? "kapanmış — sarım reddi için önce siparişi yeniden açın" : `durumu ${o.status} — sarım reddedilemez`}.`, { code: done ? "WARPING_ORDER_COMPLETED" : "WARPING_ORDER_NOT_REJECTABLE", status: o.status });
}

interface TxOut { id: string; docNo: string; orderNo: string; events: Array<{ beamId: string; beamNo: string; eventId: string; lengthM: string | null }>; photoCount: number }

interface WriteCtx { input: WarpingBeamRejectionInput; beamIds: string[]; photos: ReturnType<typeof decodeRejectPhoto>[]; userId: string }

async function writeRejectionTx(tx: Prisma.TransactionClient, { input, beamIds, photos, userId }: WriteCtx): Promise<TxOut> {
  const now = new Date();
  const fmt = resolveSeriesFormat(CODE_SCOPE);
  await lockCodeScopeTx(tx, CODE_SCOPE, seriesPrefix(fmt, now));
  await claimOrderTx(tx, input.warpingOrderId, userId);
  const pre = await loadRejectBeams(tx, beamIds);
  await lockDispatchItemsTx(tx, yarnLinesOf(pre).map((l) => l.dispatchItemId));
  // Kilitlerden sonra TAZE: eşzamanlı ret/storno/sevk aynı sarımı değiştirmiş olabilir.
  const ev = await evaluate(tx, input.warpingOrderId, beamIds);
  throwFirstBlocker(ev);
  const reason = await resolveReason(tx, input.reasonCode, input.reasonText);
  if (photos.length === 0 && (await readDevereRejectPhotoRequired(tx))) {
    throw AppError.badRequest("Bu kurulumda ret fotoğrafı zorunlu — en az bir fotoğraf ekleyin.", { code: "WARPING_REJECT_PHOTO_REQUIRED" });
  }
  const docNo = await nextSeriesNo(CODE_SCOPE, async (prefix) =>
    tx.warpingBeamRejection.findMany({ where: { docNo: { gte: prefix, startsWith: prefix } }, select: { docNo: true, createdAt: true } })
      .then((rows) => rows.map((x) => ({ code: x.docNo, createdAt: x.createdAt }))), now, fmt);
  const head = await tx.warpingBeamRejection.create({
    data: {
      docNo, clientToken: input.clientToken, warpingOrderId: ev.order.id, subcontractorId: ev.order.subcontractorId, reasonCode: reason.code, reasonText: reason.text,
      notes: input.notes?.trim() || null, expectRework: input.expectRework, rejectedAt: parseRejectedAt(input.rejectedAt, now), createdById: userId,
    },
    select: { id: true },
  });
  const events: TxOut["events"] = [];
  for (const b of ev.beams) {
    const w = woundOf(b)!;
    const e = await applyWarpBeamEventTx(tx, {
      beamId: b.id, kind: "REJECT_OUT", from: WarpBeamStatus.READY, to: WarpBeamStatus.REJECTED,
      data: { lengthM: w.lengthM, reasonCode: reason.code, reason: reason.text, createdById: userId },
    });
    await tx.warpingBeamRejectionItem.create({ data: { rejectionId: head.id, warpBeamId: b.id, eventId: e.id } });
    events.push({ beamId: b.id, beamNo: b.beamNo, eventId: e.id, lengthM: kg3(w.lengthM) });
  }
  await writeRejectPhotosTx(tx, head.id, photos, userId);
  return { id: head.id, docNo, orderNo: ev.order.orderNo, events, photoCount: photos.length };
}

export async function createWarpingBeamRejection(input: WarpingBeamRejectionInput, userId: string): Promise<CreateWarpingBeamRejectionResult> {
  const beamIds = normalizeBeamIds(input.beamIds);
  const photoInputs = input.photos ?? [];
  if (photoInputs.length > WARPING_REJECT_PHOTOS_PER_REQUEST) throw AppError.badRequest(`Bir seferde en çok ${WARPING_REJECT_PHOTOS_PER_REQUEST} fotoğraf.`, { code: "WARPING_REJECT_PHOTO_TOO_MANY" });
  return replayFor(input, beamIds).run(input.clientToken, async () => {
    const photos = photoInputs.map(decodeRejectPhoto);
    const out = await prisma.$transaction((tx) => writeRejectionTx(tx, { input, beamIds, photos, userId }));
    await AuditService.log({
      userId, action: "CREATE", tableName: WARPING_BEAM_REJECTION_TABLE, recordId: out.id,
      newData: { docNo: out.docNo, warpingOrderId: input.warpingOrderId, orderNo: out.orderNo, beamNos: out.events.map((e) => e.beamNo), reasonCode: input.reasonCode.trim(), expectRework: input.expectRework, photoCount: out.photoCount },
    });
    for (const e of out.events) {
      await logWarpBeamEventAudit({ userId, eventId: e.eventId, kind: "REJECT_OUT", data: { beamId: e.beamId, beamNo: e.beamNo, lengthM: e.lengthM, warpingBeamRejectionId: out.id, docNo: out.docNo } });
    }
    return { data: await loadRejectionDto(prisma, out.id), replayed: false };
  });
}
