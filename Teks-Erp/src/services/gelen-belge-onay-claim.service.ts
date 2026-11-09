// Gelen belge onayı — başlık claim'i TEK tx: [8046 aynı müşteri parti no kapısı] → claim DRAFT|PARTIAL → APPROVING →
// [PER_DOCUMENT özet/parti satırları]. Kapı ile satır yazımı aynı kilit altında: eşzamanlı iki onay aynı partiyi geçiremez
// (ikincisi birincinin satırlarını görür). Ayak izi çağıranda, tx DIŞINDA. Onay servisinden ayrıldı (dosya sınırı).
import { DeliveryNoteStatus, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { duplicateBatchNoGateTx } from "./helpers/gelen-belge-mukerrer.helper";
import { approvalBatchNos, writePerDocumentTx, type PartyEntry, type PerDocumentWritten, type SummaryDeclared } from "./gelen-belge-onay-parti.service";
import type { DuplicateBatchNoMode } from "./system-setting.service";

/** Yarıda kalmış APPROVING (süreç ölümü) bu süreden sonra yeniden claim edilebilir. */
export const STALE_APPROVING_MS = 10 * 60 * 1000;

type ClaimNote = Parameters<typeof writePerDocumentTx>[1] & { ownerCustomerId: string | null; status: DeliveryNoteStatus; updatedAt: Date };

/** Başlık claim — ön kontrol görüntüsüne (`snap`) bağlı; count 0 → 409 (CHANGED ya da NOT_APPROVABLE). */
async function claimHeaderTx(tx: Prisma.TransactionClient, snap: { id: string; status: DeliveryNoteStatus; updatedAt: Date }, userId: string, varianceReason: string | undefined): Promise<void> {
  const { id } = snap;
  // `updatedAt` eşitliği ön kontrolün anlık görüntüsünü bağlar: başlık PATCH'i ya da satır yazımı (claimDraft başlığı
  // tazeler) arada olduysa claim düşer → sahip/toplam ESKİ görüntüyle top doğurmaz.
  const claim = await tx.customerDeliveryNote.updateMany({
    where: {
      id,
      updatedAt: snap.updatedAt,
      OR: [
        { status: { in: [DeliveryNoteStatus.DRAFT, DeliveryNoteStatus.PARTIAL] } },
        { status: DeliveryNoteStatus.APPROVING, updatedAt: { lt: new Date(Date.now() - STALE_APPROVING_MS) } },
      ],
    },
    data: { status: DeliveryNoteStatus.APPROVING, updatedById: userId, ...(varianceReason ? { varianceReason } : {}) },
  });
  if (claim.count === 0) {
    const cur = await tx.customerDeliveryNote.findUnique({ where: { id }, select: { status: true, noteNo: true } });
    if (cur && cur.status === snap.status && cur.status !== DeliveryNoteStatus.APPROVING) {
      throw AppError.conflict(`${cur.noteNo} ön kontrolden sonra değişti (başlık ya da satır düzenlendi); yeniden deneyin.`, { code: "DELIVERY_NOTE_CHANGED", status: cur.status });
    }
    throw AppError.conflict(`${cur?.noteNo ?? id} şu an onaylanamaz (${cur?.status ?? "?"}): başka bir onay sürüyor ya da belge kapanmış.`, { code: "DELIVERY_NOTE_NOT_APPROVABLE", status: cur?.status ?? null });
  }
}

/** Kapı + claim + (PER_DOCUMENT) özet satırları; `batchMode` tx DIŞINDA okunur (kilit tx'in İLK ifadesi kalsın). */
export async function claimForApproval(note: ClaimNote & { noteNo: string }, a: { userId: string; varianceReason?: string; entryMode: string; batchMode: DuplicateBatchNoMode; confirmDuplicateBatchNo?: boolean; parties?: ReadonlyArray<PartyEntry>; summary?: SummaryDeclared; auditExtra?: Record<string, unknown> }): Promise<{ batch: { warnings: string[]; confirmedPeers: string[] }; perDocument: PerDocumentWritten | null }> {
  const res = await prisma.$transaction(async (tx) => {
    const batch = await duplicateBatchNoGateTx(tx, note, approvalBatchNos(note, a.entryMode, a), { mode: a.batchMode, confirmed: a.confirmDuplicateBatchNo });
    await claimHeaderTx(tx, note, a.userId, a.varianceReason);
    const perDocument = a.entryMode === "PER_DOCUMENT" ? await writePerDocumentTx(tx, note, a.parties, a.summary) : null;
    return { batch, perDocument };
  });
  // Claim'in ayak izi yazanla aynı dosyada, tx DIŞINDA (çağıranın ek alanlarıyla).
  await AuditService.log({ userId: a.userId, action: "UPDATE", tableName: "CUSTOMER_DELIVERY_NOTE", recordId: note.id, oldData: { status: note.status }, newData: { status: "APPROVING", noteNo: note.noteNo, ...(a.varianceReason ? { varianceReason: a.varianceReason } : {}), ...a.auditExtra, ...(res.batch.confirmedPeers.length ? { duplicateBatchNoConfirmed: res.batch.confirmedPeers } : {}), ...(a.entryMode === "PER_DOCUMENT" ? { entryMode: a.entryMode } : {}) } });
  return res;
}
