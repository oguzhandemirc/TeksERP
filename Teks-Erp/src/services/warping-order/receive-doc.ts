// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ (`DK-YYMM-NNNN`): tek irsaliye, aynı deverecinin N siparişi (devere ek E1)
// =============================================================================
// Hep-ya-hiç TEK tx. Sıra: belge no kilidi İLK (8029) → irsaliye no kilidi (8029, aynı uzay) → siparişler `id` sırasıyla
// CLAIM → irsaliye tekrarı kararı → N siparişin dağıtım adayı kalemleri BİRLEŞİK `id` sırasıyla FOR UPDATE → başlık →
// siparişler `id` sırasıyla `receiveOrderLinesTx` (tek sipariş `/receive` ile AYNI çekirdek; sipariş başı
// `warpingReceiptKey`, gövde B3, yeniden sarım C1 satır başına). Tek sipariş = bu ucun özel hali; eski `/receive` aynen.
// Replay: token belgede; kimlik devereci + irsaliye + sipariş başı satır imzası (sarım + yeniden sarım).
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { lockDispatchItemsTx } from "../helpers/warping-yarn-open.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import { readDevereDuplicateDeliveryNote, readDevereReceiveWeighing } from "../system-setting/devere-receive";
import { reworkReplaySig } from "./receive-rework";
import { auditReceiveOrder, claimForReceiveTx, inputBeamSig, normalizeReceiveBeams, receiveCandidateItemIds, receiveOrderLinesTx, storedBeamSig, WARPING_RECEIVE_MAX_BEAMS, type ReceiveOrderLinesOut, type WarpingReceiveBeamInput } from "./receive-core";
import { previewWarpingReceive, type WarpingReceivePreview } from "./receive";
import { assertReceiveWeighing, deliveryNoteVerdict, lockDeliveryNoteTx, normalizeDeliveryNoteNo, type DeliveryNoteUse } from "./receive-note";
import { loadWarpingReceiveDoc, type WarpingReceiveDocDto } from "./receive-doc-read";

const CODE_SCOPE = "warpingReceiveDoc";
export const WARPING_RECEIVE_DOC_TABLE = "WARPING_RECEIVE_DOC";
export const WARPING_RECEIVE_DOC_MAX_ORDERS = 20;

export interface WarpingReceiveDocOrderInput { warpingOrderId: string; beams: WarpingReceiveBeamInput[] }
export interface WarpingReceiveDocInput {
  clientToken: string;
  /** İsteğe bağlı: verilirse siparişlerin deverecisiyle aynı olmalı (seçilen devereci ↔ sipariş tutarlılığı). */
  subcontractorId?: string | null;
  deliveryNoteNo?: string | null;
  orders: WarpingReceiveDocOrderInput[];
}
export type WarpingReceiveDocPreviewInput = Omit<WarpingReceiveDocInput, "clientToken">;

/** DB'siz kapılar: sipariş sayısı/tekrarı, toplam satır, satır doğrulaması, siparişler ARASI gövde/levent no tekrarı. Sipariş `id` sırasıyla döner. */
export function normalizeDocOrders(orders: WarpingReceiveDocOrderInput[]): WarpingReceiveDocOrderInput[] {
  if (orders.length === 0) throw AppError.badRequest("Kabul belgesinde en az bir sipariş olmalı.", { code: "WARPING_RECEIVE_DOC_EMPTY" });
  if (orders.length > WARPING_RECEIVE_DOC_MAX_ORDERS) throw AppError.badRequest(`Bir kabul belgesinde en çok ${WARPING_RECEIVE_DOC_MAX_ORDERS} sipariş olur.`, { code: "WARPING_RECEIVE_DOC_TOO_MANY" });
  const ids = new Set(orders.map((o) => o.warpingOrderId));
  if (ids.size !== orders.length) throw AppError.badRequest("Aynı sipariş belgede iki kez seçilmiş — satırları tek siparişte toplayın.", { code: "WARPING_RECEIVE_DOC_DUPLICATE_ORDER" });
  const total = orders.reduce((s, o) => s + o.beams.length, 0);
  if (total > WARPING_RECEIVE_MAX_BEAMS) throw AppError.badRequest(`Bir kabul belgesinde en çok ${WARPING_RECEIVE_MAX_BEAMS} levent olur.`, { code: "WARPING_RECEIVE_DOC_TOO_MANY" });
  const physical = new Set<string>();
  const bodies = new Set<string>();
  for (const o of orders) {
    normalizeReceiveBeams(o.beams);
    for (const b of o.beams) {
      const no = (b.newBody?.bodyNo ?? b.physicalBeamNo)?.trim();
      if (no) {
        if (physical.has(no)) throw AppError.badRequest(`"${no}" gövde numarası bu belgede iki kez yazılmış.`, { code: "WARPING_RECEIVE_DUPLICATE_PHYSICAL" });
        physical.add(no);
      }
      if (b.beamBodyId) {
        if (bodies.has(b.beamBodyId)) throw AppError.badRequest("Aynı levent gövdesi bu belgede iki satırda okutulmuş.", { code: "WARPING_RECEIVE_DUPLICATE_BODY" });
        bodies.add(b.beamBodyId);
      }
    }
  }
  return [...orders].sort((a, b) => a.warpingOrderId.localeCompare(b.warpingOrderId));
}

function mixedSubcontractor(): AppError {
  return AppError.badRequest("Bir kabul belgesindeki siparişler aynı deverecinin olmalı.", { code: "WARPING_RECEIVE_DOC_MIXED_SUBCONTRACTOR" });
}

// ── Önizleme ─────────────────────────────────────────────────────────────────

export interface WarpingReceiveDocPreview {
  subcontractorId: string;
  deliveryNoteNo: string | null;
  /** Bu irsaliye no ile yapılmış önceki canlı kabuller (ayar ALLOW'da boş). */
  deliveryNoteUses: DeliveryNoteUse[];
  orders: Array<{ warpingOrderId: string; preview: WarpingReceivePreview }>;
  totals: { orderCount: number; beamCount: number; lengthM: string };
  warnings: string[];
}

/** Sipariş başı önizleme (tek sipariş önizlemesiyle aynı) + belge düzeyi irsaliye tekrarı. Yazmaz. */
export async function previewWarpingReceiveDoc(input: WarpingReceiveDocPreviewInput): Promise<WarpingReceiveDocPreview> {
  const orders = normalizeDocOrders(input.orders);
  assertReceiveWeighing(orders.flatMap((o) => o.beams), await readDevereReceiveWeighing());
  const deliveryNoteNo = normalizeDeliveryNoteNo(input.deliveryNoteNo);
  const out: WarpingReceiveDocPreview["orders"] = [];
  for (const o of orders) out.push({ warpingOrderId: o.warpingOrderId, preview: await previewWarpingReceive(o.warpingOrderId, { deliveryNoteNo, beams: o.beams }, { noteCheck: false }) });
  const subIds = new Set(out.map((o) => o.preview.order.subcontractorId));
  const subcontractorId = [...subIds][0]!;
  if (subIds.size > 1 || (input.subcontractorId && input.subcontractorId !== subcontractorId)) throw mixedSubcontractor();
  const note = await deliveryNoteVerdict(prisma, { subcontractorId, deliveryNoteNo, mode: await readDevereDuplicateDeliveryNote(), enforce: false });
  return {
    subcontractorId, deliveryNoteNo, deliveryNoteUses: note.uses, orders: out,
    totals: { orderCount: out.length, beamCount: out.reduce((s, o) => s + o.preview.incoming.beamCount, 0), lengthM: out.reduce((s, o) => s.plus(o.preview.incoming.lengthM), new Prisma.Decimal(0)).toFixed(3) },
    warnings: [...note.warnings, ...out.flatMap((o) => o.preview.warnings.map((w) => `${o.preview.order.orderNo}: ${w}`))],
  };
}

// ── Kabul ────────────────────────────────────────────────────────────────────

export interface CreateWarpingReceiveDocResult { data: WarpingReceiveDocDto; warnings: string[]; replayed: boolean }

const orderSig = (orderId: string, beamSig: string, reworkSig: string) => `${orderId}#${beamSig}#${reworkSig}`;

function replayFor(input: WarpingReceiveDocInput, orders: WarpingReceiveDocOrderInput[]) {
  type Hit = { id: string; docNo: string; subcontractorId: string; deliveryNoteNo: string; orders: string; dead: string | null };
  return tokenReplay<Hit, CreateWarpingReceiveDocResult>({
    find: async (db, clientToken) => {
      const doc = await sequentialTx(db).warpingReceiveDoc.findUnique({
        where: { clientToken },
        select: {
          id: true, docNo: true, subcontractorId: true, deliveryNoteNo: true,
          beams: { select: { warpingOrderId: true, beamNo: true, status: true, physicalBeamNo: true, beamBodyId: true, reworkOfBeamId: true, events: { where: { kind: "WOUND" }, select: { lengthM: true, grossKg: true, tareKg: true } } }, orderBy: { beamNo: "asc" } },
        },
      });
      if (!doc) return null;
      const byOrder = new Map<string, typeof doc.beams>();
      for (const b of doc.beams) byOrder.set(b.warpingOrderId ?? "", [...(byOrder.get(b.warpingOrderId ?? "") ?? []), b]);
      const sig = [...byOrder.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([oid, rows]) => orderSig(oid, storedBeamSig(rows), reworkReplaySig(rows.map((r) => r.reworkOfBeamId)))).join("|");
      return { id: doc.id, docNo: doc.docNo, subcontractorId: doc.subcontractorId, deliveryNoteNo: doc.deliveryNoteNo ?? "", orders: sig, dead: doc.beams.find((b) => b.status === WarpBeamStatus.CANCELLED)?.beamNo ?? null };
    },
    alive: (hit) => {
      if (!hit.dead) return;
      throw AppError.conflict(`Bu kabul denemesi kaydedilmiş (${hit.docNo}) ama sonra levent dönüşü İPTAL edilmiş (${hit.dead}) — yeniden deneme yerine yeni kabul açın.`, { code: "WARP_BEAM_CANCELLED" });
    },
    identity: (hit) => [
      ...(input.subcontractorId ? [{ ad: "subcontractorId", mevcut: hit.subcontractorId, gelen: input.subcontractorId }] : []),
      { ad: "deliveryNoteNo", mevcut: hit.deliveryNoteNo, gelen: normalizeDeliveryNoteNo(input.deliveryNoteNo) ?? "" },
      { ad: "orders", mevcut: hit.orders, gelen: orders.map((o) => orderSig(o.warpingOrderId, inputBeamSig(o.beams), reworkReplaySig(o.beams.map((b) => b.reworkOfBeamId)))).join("|") },
    ],
    collision: (hit) => `Bu işlem kimliği başka içerikli bir dönüş kabul belgesine (${hit.docNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (hit) => ({ data: await loadWarpingReceiveDoc(prisma, hit.id), warnings: [], replayed: true }),
  });
}

interface TxOut { docId: string; docNo: string; subcontractorId: string; lines: ReceiveOrderLinesOut[]; warnings: string[] }

async function writeReceiveDocTx(tx: Prisma.TransactionClient, p: { input: WarpingReceiveDocInput; orders: WarpingReceiveDocOrderInput[]; deliveryNoteNo: string | null; noteMode: Awaited<ReturnType<typeof readDevereDuplicateDeliveryNote>>; userId: string }): Promise<TxOut> {
  const now = new Date();
  const fmt = resolveSeriesFormat(CODE_SCOPE);
  await lockCodeScopeTx(tx, CODE_SCOPE, seriesPrefix(fmt, now));
  await lockDeliveryNoteTx(tx, p.deliveryNoteNo);
  // Siparişler `id` sırasıyla (deterministik kilit sırası); biri alınamazsa (kapalı/iptal) tümü geri döner.
  const claimed: Array<Awaited<ReturnType<typeof claimForReceiveTx>> & { beams: WarpingReceiveBeamInput[] }> = [];
  for (const o of p.orders) claimed.push({ ...(await claimForReceiveTx(tx, o.warpingOrderId, p.userId)), beams: o.beams });
  const subcontractorId = claimed[0]!.order.subcontractorId;
  if (claimed.some((c) => c.order.subcontractorId !== subcontractorId) || (p.input.subcontractorId && p.input.subcontractorId !== subcontractorId)) throw mixedSubcontractor();
  const note = await deliveryNoteVerdict(tx, { subcontractorId, deliveryNoteNo: p.deliveryNoteNo, mode: p.noteMode, enforce: true });
  // N siparişin aday kalemleri BİRLEŞİK sırayla — çekirdeğin sipariş başı kilidi bundan sonra yeniden alımdır (bekleme yok).
  const itemIds: string[] = [];
  for (const c of claimed) itemIds.push(...(await receiveCandidateItemIds(tx, c.order, c.beams)));
  await lockDispatchItemsTx(tx, itemIds);
  const docNo = await nextSeriesNo(CODE_SCOPE, async (prefix) =>
    tx.warpingReceiveDoc.findMany({ where: { docNo: { gte: prefix, startsWith: prefix } }, select: { docNo: true, createdAt: true } })
      .then((rows) => rows.map((x) => ({ code: x.docNo, createdAt: x.createdAt }))), now, fmt);
  const doc = await tx.warpingReceiveDoc.create({ data: { docNo, clientToken: p.input.clientToken, subcontractorId, deliveryNoteNo: p.deliveryNoteNo, createdById: p.userId }, select: { id: true } });
  const lines: ReceiveOrderLinesOut[] = [];
  for (const c of claimed) {
    lines.push(await receiveOrderLinesTx(tx, { order: c.order, wasOpen: c.wasOpen, beams: c.beams, deliveryNoteNo: p.deliveryNoteNo, clientToken: null, receiveDocId: doc.id, userId: p.userId }));
  }
  const orderNo = new Map(claimed.map((c) => [c.order.id, c.order.orderNo]));
  return { docId: doc.id, docNo, subcontractorId, lines, warnings: [...note.warnings, ...lines.flatMap((l) => l.warnings.map((w) => `${orderNo.get(l.orderId)}: ${w}`))] };
}

export async function createWarpingReceiveDoc(input: WarpingReceiveDocInput, userId: string): Promise<CreateWarpingReceiveDocResult> {
  const orders = normalizeDocOrders(input.orders);
  const deliveryNoteNo = normalizeDeliveryNoteNo(input.deliveryNoteNo);
  return replayFor(input, orders).run(input.clientToken, async () => {
    assertReceiveWeighing(orders.flatMap((o) => o.beams), await readDevereReceiveWeighing());
    const noteMode = await readDevereDuplicateDeliveryNote();
    const out = await prisma.$transaction((tx) => writeReceiveDocTx(tx, { input, orders, deliveryNoteNo, noteMode, userId }));
    await AuditService.log({
      userId, action: "CREATE", tableName: WARPING_RECEIVE_DOC_TABLE, recordId: out.docId,
      newData: { docNo: out.docNo, subcontractorId: out.subcontractorId, deliveryNoteNo, orders: out.lines.map((l) => ({ warpingOrderId: l.orderId, receiptKey: l.receiptKey, beams: l.created.length })) },
    });
    for (const l of out.lines) await auditReceiveOrder(userId, l, deliveryNoteNo, out.docId);
    return { data: await loadWarpingReceiveDoc(prisma, out.docId), warnings: out.warnings, replayed: false };
  });
}
