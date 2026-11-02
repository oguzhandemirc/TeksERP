// =============================================================================
// ONAYLI GELEN BELGE İPTALİ — YAZAN YOL (K15, kullanıcı kararı 2026-11-02 "a")
// =============================================================================
// Tek tx: 8043 kilidi (İLK ifade) → belge claim'i {id, APPROVED|PARTIAL} → engellerin TAZE değerlendirmesi →
// seçilen başlamamış iş emirleri MEVCUT iptal gövdesiyle (`cancelWorkOrderTx`) → toplar MEVCUT top iptal
// gövdesiyle (`cancelRollRecordTx`; ENTRY_RECEIPT'in beyanlı karşı olayı ROLL_CANCEL bugüne). Belge satırları,
// doğuş defter satırları ve iş emri geçmişi DURUR. Audit tx DIŞINDA. Replay R kipi (tek boğaz).
// =============================================================================
import { DeliveryNoteStatus, type Prisma, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { DELIVERY_NOTE_CANCEL_CODE } from "../constants/reason-presets";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { cancelRollRecordTx } from "./inventory.service";
import { WorkOrderService } from "./workorder.service";
import { isWorkOrderUntouched } from "./helpers/workorder-locks.helper";
import { CANCELLABLE_NOTE_STATUSES, evaluateNoteCancel, loadNoteCancelContext, type CancelBlocker } from "./gelen-belge-iptal-onizleme.service";

/** Belge iptali serileştirmesi (belge başına anahtar `hashtext(noteId)`). Envanter: `period-guard.helper.ts` — **8043**. */
export const DELIVERY_NOTE_CANCEL_LOCK_NS: number = 8043;
const TRIGGER = "DELIVERY_NOTE_CANCEL";
const REF_TYPE = "CUSTOMER_DELIVERY_NOTE";

export interface NoteCancelInput {
  readonly clientToken: string;
  readonly reason: string;
  readonly workOrderIds?: readonly string[];
}

export interface NoteCancelResult {
  readonly note: { readonly id: string; readonly noteNo: string; readonly status: DeliveryNoteStatus; readonly cancelledAt: Date | null; readonly cancelReason: string | null };
  readonly cancelledRollCount: number;
  readonly cancelledWorkOrders: ReadonlyArray<{ readonly id: string; readonly workOrderNumber: string }>;
}

interface TxOutcome {
  readonly noteNo: string;
  readonly priorStatus: DeliveryNoteStatus;
  readonly rolls: ReadonlyArray<{ id: string; barcode: string | null; from: RollStatus; ledgerRowWritten: boolean }>;
  readonly workOrders: ReadonlyArray<{ id: string; workOrderNumber: string }>;
}

/** Yanıt DB'den kurulur — taze yol ile replay AYNI biçimi döndürür. */
async function buildResult(noteId: string): Promise<NoteCancelResult> {
  const note = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { id: true, noteNo: true, status: true, cancelledAt: true, cancelReason: true } });
  const cancelledRollCount = await prisma.roll.count({ where: { deliveryNoteLine: { noteId }, status: RollStatus.CANCELLED, cancelReasonCode: DELIVERY_NOTE_CANCEL_CODE } });
  const events = await prisma.workOrderEvent.findMany({
    where: { refType: REF_TYPE, refId: noteId, trigger: TRIGGER },
    orderBy: { workOrderId: "asc" },
    distinct: ["workOrderId"],
    select: { workOrder: { select: { id: true, workOrderNumber: true } } },
  });
  return { note, cancelledRollCount, cancelledWorkOrders: events.map((e) => e.workOrder) };
}

type Prior = { id: string; noteNo: string; cancelReason: string | null };

function replayFor(noteId: string, reason: string) {
  return tokenReplay<Prior, NoteCancelResult>({
    find: (db, cancelClientToken) => db.customerDeliveryNote.findUnique({ where: { cancelClientToken }, select: { id: true, noteNo: true, cancelReason: true } }),
    alive: { neverDies: "belge iptali terminaldir — iptal edilmiş belge yeniden açılmaz (kağıt yeni belgeyle girilir)" },
    identity: (p) => [
      { ad: "noteId", mevcut: p.id, gelen: noteId },
      { ad: "reason", mevcut: p.cancelReason, gelen: reason },
    ],
    collision: "Bu işlem kimliği başka bir belge iptaline ait; önizlemeyi yeniden açıp tekrar deneyin.",
    respond: (p) => buildResult(p.id),
  });
}

function blockedError(blockers: ReadonlyArray<CancelBlocker>): AppError {
  return AppError.conflict(`Belge iptal edilemez: ${blockers[0]?.message ?? "engel var"}${blockers.length > 1 ? ` (+${blockers.length - 1} engel)` : ""}`, {
    code: "DELIVERY_NOTE_CANCEL_BLOCKED",
    blockers,
  });
}

/** 8043 kilidi tx'in İLK ifadesi; claim gözlenen durumu WHERE'de taşır. Dönüş: claim öncesi durum (audit için). */
async function claimNoteTx(tx: Prisma.TransactionClient, noteId: string, input: NoteCancelInput, userId: string): Promise<DeliveryNoteStatus> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELIVERY_NOTE_CANCEL_LOCK_NS}::int, hashtext(${noteId}))`;
  const before = await tx.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { status: true } });
  const claim = await tx.customerDeliveryNote.updateMany({
    where: { id: noteId, status: { in: [...CANCELLABLE_NOTE_STATUSES] } },
    data: { status: DeliveryNoteStatus.CANCELLED, cancelledAt: new Date(), cancelledById: userId, cancelReason: input.reason, cancelClientToken: input.clientToken, updatedById: userId },
  });
  if (claim.count === 0) {
    const n = await tx.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { status: true, noteNo: true } });
    if (!n) throw AppError.notFound("Gelen belge bulunamadı", { code: "DELIVERY_NOTE_NOT_FOUND" });
    const why = n.status === DeliveryNoteStatus.CANCELLED ? "zaten iptal edilmiş" : "onaylı değil (taslak silme ayrı yoldur)";
    throw AppError.conflict(`${n.noteNo} ${why}.`, { code: "DELIVERY_NOTE_NOT_CANCELLABLE", status: n.status });
  }
  return before?.status ?? DeliveryNoteStatus.APPROVED;
}

async function cancelTx(tx: Prisma.TransactionClient, noteId: string, input: NoteCancelInput, userId: string): Promise<TxOutcome> {
  const priorStatus = await claimNoteTx(tx, noteId, input, userId);
  const ctx = await loadNoteCancelContext(tx, noteId);
  const selected = new Set(input.workOrderIds ?? []);
  const evald = await evaluateNoteCancel(tx, ctx, selected);
  const related = new Set(evald.workOrders.map((w) => w.id));
  const foreign = [...selected].filter((id) => !related.has(id));
  if (foreign.length > 0) {
    throw AppError.badRequest("Seçilen iş emri bu belgenin toplarını taşımıyor; önizlemeyi yenileyin.", { code: "DELIVERY_NOTE_CANCEL_WO_INVALID", workOrderIds: foreign });
  }
  if (evald.blockers.length > 0) throw blockedError(evald.blockers);

  const wos = evald.workOrders.filter((w) => selected.has(w.id));
  const woService = new WorkOrderService();
  for (const w of wos) {
    // Seçim → iptal arasında iş emri başlamış olabilir: yüklem tx içinde, satır kilidinden sonra yeniden sorulur.
    const fresh = await tx.workOrder.findUniqueOrThrow({ where: { id: w.id }, select: { status: true, steps: { select: { id: true } } } });
    if (!(await isWorkOrderUntouched(tx, w.id, fresh.status))) {
      throw blockedError([{ code: "WORK_ORDER_STARTED", message: `${w.workOrderNumber}: iş emri bu sırada başladı — önizlemeyi yenileyin.`, workOrderId: w.id }]);
    }
    await woService.cancelWorkOrderTx(tx, {
      id: w.id, workOrderNumber: w.workOrderNumber, stepIds: fresh.steps.map((s) => s.id), trigger: TRIGGER, refType: REF_TYPE, refId: noteId,
      reason: `Gelen belge iptali (${ctx.note.noteNo}): ${input.reason}`.slice(0, 300), cancelReasonCode: null, userId,
      fasonPlan: { scrapRollIds: [], residualRollIds: [], remainderClosed: false }, decidedWithFason: [],
    });
  }

  const cancelReasonText = `Gelen belge iptali (${ctx.note.noteNo}): ${input.reason}`.slice(0, 500);
  const rolls: Array<TxOutcome["rolls"][number]> = [];
  const targetIds = evald.rolls.filter((r) => r.outcome === "CANCEL").map((r) => r.rollId).sort();
  for (const rollId of targetIds) {
    // İş emri iptali topu ham stoka çekti: gövde topun TAZE satırıyla (claim gözlenen statüyle) çağrılır.
    const existing = await tx.roll.findUniqueOrThrow({ where: { id: rollId } });
    const r = await cancelRollRecordTx(tx, { existing, isScrap: false, userId, cancelReasonText, cancelReasonCode: DELIVERY_NOTE_CANCEL_CODE });
    rolls.push({ id: rollId, barcode: existing.barcode, from: existing.status, ledgerRowWritten: r.ledgerRowWritten });
  }
  return { noteNo: ctx.note.noteNo, priorStatus, rolls, workOrders: wos.map((w) => ({ id: w.id, workOrderNumber: w.workOrderNumber })) };
}

async function auditOutcome(noteId: string, o: TxOutcome, reason: string, userId: string): Promise<void> {
  await AuditService.log({
    userId, action: "UPDATE", tableName: "CUSTOMER_DELIVERY_NOTE", recordId: noteId,
    oldData: { noteNo: o.noteNo, status: o.priorStatus },
    newData: { status: DeliveryNoteStatus.CANCELLED, event: TRIGGER, reason, rollCount: o.rolls.length, workOrderIds: o.workOrders.map((w) => w.id) },
  });
  for (const w of o.workOrders) {
    await AuditService.log({ userId, action: "DELETE", tableName: "WORK_ORDER", recordId: w.id, oldData: { batchNumber: w.workOrderNumber }, newData: { status: "CANCELLED", trigger: TRIGGER, noteNo: o.noteNo, reason } });
  }
  for (const r of o.rolls) {
    await AuditService.log({
      userId, action: "UPDATE", tableName: "ROLL", recordId: r.id,
      oldData: { status: r.from },
      newData: { status: RollStatus.CANCELLED, mode: "CANCEL", cancelled: true, event: TRIGGER, noteNo: o.noteNo, reasonCode: DELIVERY_NOTE_CANCEL_CODE, ledgerRowWritten: r.ledgerRowWritten },
    });
  }
}

/** POST …/irsaliyeler/:id/iptal — önizlemeyle aynı yüklem, tx içinde taze; engel varsa hiçbir şey yazılmaz. */
export async function cancelDeliveryNote(noteId: string, input: NoteCancelInput, userId: string): Promise<NoteCancelResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw AppError.badRequest("İptal sebebi (en az 3 karakter) zorunludur", { code: "CANCEL_REASON_REQUIRED" });
  const clean = { ...input, reason };
  return replayFor(noteId, reason).run(input.clientToken, async () => {
    const outcome = await prisma.$transaction((tx) => cancelTx(tx, noteId, clean, userId), { timeout: 60_000 });
    await auditOutcome(noteId, outcome, reason, userId);
    return buildResult(noteId);
  });
}
