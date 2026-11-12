// =============================================================================
// GELEN BELGE — onaylı belgede fiş no / fiş tarihi düzeltme (künye düzeltmesi, 2026-11-10)
// =============================================================================
// Şablon fiş no'yu okumayınca onaylı belgede boş kalıyordu; istasyon "Belgeden iş bul" fiş no ile arayamıyordu.
// Taslak dışı TEK başlık yazımı budur ve YALNIZ iki tanıtıcı alanı yazar (`senderDocNo`, `senderDocDate`): satır, top,
// defter, sahip değişmez. Claim `updateMany WHERE {id, status ∈ NOTE_IDENTITY_FIX_STATUSES, eski no, eski tarih}`:
// eşzamanlı iki düzeltmede ikincisi 409 DELIVERY_NOTE_CHANGED alır (son yazan sessizce EZMEZ). Mükerrer belge no
// onay kapısıyla AYNI helper'dan (`duplicateDocNoApprovalGate`); BLOCK'ta 8044 kilidi tx'in İLK ifadesi.
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { text } from "./gelen-belge-line.service";
import { getDeliveryNote, parseDay } from "./gelen-belge-note.service";
import { assertDocNoUniqueTx, duplicateDocNoApprovalGate, lockDocNosTx } from "./helpers/gelen-belge-mukerrer.helper";
import { readDuplicateDocNoMode } from "./system-setting.service";

/** Künye düzeltmesine açık durumlar: topları doğmuş, iptal edilmemiş belge (taslak kendi PATCH'iyle düzelir). */
export const NOTE_IDENTITY_FIX_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];
export const isIdentityFixableStatus = (s: DeliveryNoteStatus): boolean => NOTE_IDENTITY_FIX_STATUSES.includes(s);

export interface NoteIdentityFixInput {
  senderDocNo?: string | null;
  /** YYYY-AA-GG — takvim günü; null temizler. */
  senderDocDate?: string | null;
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet (BLOCK'ta yok sayılır). */
  confirmDuplicateDocNo?: boolean;
}

const NOTE_TABLE = "CUSTOMER_DELIVERY_NOTE";
const SELECT = { id: true, noteNo: true, status: true, ownerCustomerId: true, senderDocNo: true, senderDocDate: true } as const;
const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function notFixable(noteNo: string, status: DeliveryNoteStatus): never {
  const why = status === DeliveryNoteStatus.DRAFT ? "taslak; başlık formundan düzeltin"
    : status === DeliveryNoteStatus.CANCELLED ? "iptal edilmiş; düzeltilemez"
    : "onay sürüyor; biraz sonra yeniden deneyin";
  throw AppError.conflict(`${noteNo} ${why}.`, { code: "DELIVERY_NOTE_IDENTITY_NOT_FIXABLE", status });
}

/** Onaylı/kısmi belgede yalnız fiş no + fiş tarihi. Değişiklik yoksa yazmaz, audit atmaz. */
export async function fixNoteIdentity(id: string, input: NoteIdentityFixInput, userId: string) {
  if (input.senderDocNo === undefined && input.senderDocDate === undefined) {
    throw AppError.badRequest("Fiş no ya da fiş tarihi verilmeli.", { code: "DELIVERY_NOTE_IDENTITY_EMPTY" });
  }
  const before = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: SELECT });
  if (!before) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  if (!isIdentityFixableStatus(before.status)) notFixable(before.noteNo, before.status);
  const docNo = input.senderDocNo !== undefined ? text(input.senderDocNo) : before.senderDocNo;
  const docDate = input.senderDocDate !== undefined ? parseDay(input.senderDocDate) : before.senderDocDate;
  if (docNo === before.senderDocNo && day(docDate) === day(before.senderDocDate)) return { note: await getDeliveryNote(id), warnings: [] };

  // Mükerrer: belge no değişiyorsa onay kapısının AYNI yüklemi (BLOCK ön kontrol · WARN 409 + peers / bayrakla uyarı).
  const docNoChanged = docNo !== before.senderDocNo;
  const gate = docNoChanged ? await duplicateDocNoApprovalGate({ ...before, senderDocNo: docNo }, input.confirmDuplicateDocNo) : { warnings: [], confirmedPeers: [] };
  const mode = docNoChanged ? await readDuplicateDocNoMode() : null;
  const res = await prisma.$transaction(async (tx) => {
    if (mode === "BLOCK") await lockDocNosTx(tx, mode, [docNo]);
    const r = await tx.customerDeliveryNote.updateMany({
      where: { id, status: { in: [...NOTE_IDENTITY_FIX_STATUSES] }, senderDocNo: before.senderDocNo, senderDocDate: before.senderDocDate },
      data: { senderDocNo: docNo, senderDocDate: docDate, updatedById: userId },
    });
    if (r.count === 1 && mode === "BLOCK") await assertDocNoUniqueTx(tx, id, mode, [docNo]);
    return r;
  });
  if (res.count === 0) {
    const cur = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: SELECT });
    if (!cur) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
    if (!isIdentityFixableStatus(cur.status)) notFixable(cur.noteNo, cur.status);
    throw AppError.conflict("Belge bu arada değişti; yenileyip yeniden deneyin.", { code: "DELIVERY_NOTE_CHANGED" });
  }
  await AuditService.log({
    userId, action: "UPDATE", tableName: NOTE_TABLE, recordId: id,
    oldData: { noteNo: before.noteNo, status: before.status, senderDocNo: before.senderDocNo, senderDocDate: day(before.senderDocDate) },
    newData: { noteNo: before.noteNo, status: before.status, senderDocNo: docNo, senderDocDate: day(docDate), identityFix: true, ...(gate.confirmedPeers.length ? { duplicateDocNoConfirmedPeers: gate.confirmedPeers } : {}) },
  });
  return { note: await getDeliveryNote(id), warnings: gate.warnings };
}
