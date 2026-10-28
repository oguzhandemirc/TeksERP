// =============================================================================
// GELEN BELGE — irsaliye taslağı SATIRLARI (D2): satır ekle/düzelt/sil + DRAFT claim
// =============================================================================
// Her satır yolu önce başlığı `updateMany WHERE {id, status: DRAFT}` ile ATOMİK CLAIM eder (count 0
// → 404/409); satır kilidi = başlık satırıdır. Taslak defter değildir; satır silme ④ sınıfı
// (`docs/kurallar/defter.md`). Başlık CRUD'u `gelen-belge-note.service.ts`te (bu dosya oradan import
// EDİLİR; ters yön yok — döngü yok).
// =============================================================================
import { DeliveryNoteLineKind, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";

export interface DeliveryNoteLineInput {
  lineKind?: DeliveryNoteLineKind;
  blockNo?: number;
  senderRollNo?: string | null;
  meters: number;
  weightKg?: number | null;
  widthCm?: number | null;
  itemText?: string | null;
  itemId?: string | null;
  colorText?: string | null;
  colorId?: string | null;
  processText?: string | null;
  needsReview?: boolean;
}
export const LINE_SELECT = {
  id: true, noteId: true, lineNo: true, blockNo: true, lineKind: true, senderRollNo: true, meters: true, weightKg: true,
  widthCm: true, itemText: true, itemId: true, colorText: true, colorId: true, processText: true, confidence: true,
  needsReview: true, sourceRects: true, status: true, failReason: true, rollId: true, createdAt: true, updatedAt: true,
  item: { select: { id: true, code: true, name: true } },
  color: { select: { id: true, code: true, name: true } },
} as const;

export const text = (v: string | null | undefined): string | null => (v === undefined ? null : (v?.trim() || null));

/** Audit yükü: satır künyesi (sourceRects/confidence yok — OCR ham izi audit'e girmez). */
export function auditLine(l: { lineNo: number; blockNo: number; lineKind: string; senderRollNo: string | null; meters: Prisma.Decimal; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; itemText: string | null; itemId: string | null; colorText: string | null; colorId: string | null; processText: string | null; needsReview: boolean; status: string }) {
  return {
    lineNo: l.lineNo, blockNo: l.blockNo, lineKind: l.lineKind, senderRollNo: l.senderRollNo, meters: l.meters.toString(),
    weightKg: l.weightKg?.toString() ?? null, widthCm: l.widthCm?.toString() ?? null, itemText: l.itemText, itemId: l.itemId,
    colorText: l.colorText, colorId: l.colorId, processText: l.processText, needsReview: l.needsReview, status: l.status,
  };
}

export function lineColumns(input: DeliveryNoteLineInput) {
  if (!(input.meters > 0)) throw AppError.badRequest("Satır metrajı sıfırdan büyük olmalı.", { code: "DELIVERY_NOTE_LINE_METERS" });
  return {
    lineKind: input.lineKind ?? "TOP",
    blockNo: input.blockNo ?? 1,
    senderRollNo: text(input.senderRollNo),
    meters: new Prisma.Decimal(input.meters),
    weightKg: input.weightKg === undefined || input.weightKg === null ? null : new Prisma.Decimal(input.weightKg),
    widthCm: input.widthCm === undefined || input.widthCm === null ? null : new Prisma.Decimal(input.widthCm),
    itemText: text(input.itemText),
    itemId: input.itemId ?? null,
    colorText: text(input.colorText),
    colorId: input.colorId ?? null,
    processText: text(input.processText),
    needsReview: input.needsReview ?? false,
    // Elle/Excel satır: güven 1 (OCR satırları D3b'de kendi güvenini yazar).
    confidence: new Prisma.Decimal(1),
  };
}

export async function notDraft(id: string): Promise<never> {
  const cur = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { status: true, noteNo: true } });
  if (!cur) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  throw AppError.conflict(`${cur.noteNo} taslak değil (${cur.status}); yalnız taslak düzenlenir/silinir. Onaylı belge ancak İPTAL edilir.`, { code: "DELIVERY_NOTE_NOT_DRAFT", status: cur.status });
}

// ── Satır yazma — her yol önce başlığı DRAFT olarak claim eder (satır kilidi = başlık satırı) ──
async function claimDraft(tx: Prisma.TransactionClient, noteId: string, userId: string): Promise<void> {
  const c = await tx.customerDeliveryNote.updateMany({ where: { id: noteId, status: "DRAFT" }, data: { updatedById: userId } });
  if (c.count === 0) await notDraft(noteId);
}

export async function addDeliveryNoteLines(noteId: string, inputs: DeliveryNoteLineInput[], userId: string) {
  if (inputs.length === 0) throw AppError.badRequest("En az bir satır gerekli.", { code: "DELIVERY_NOTE_LINES_EMPTY" });
  const cols = inputs.map(lineColumns);
  const created = await prisma.$transaction(async (tx) => {
    await claimDraft(tx, noteId, userId);
    const last = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId }, _max: { lineNo: true } });
    let lineNo = last._max.lineNo ?? 0;
    const rows = [];
    for (const c of cols) {
      lineNo += 1;
      rows.push(await tx.customerDeliveryNoteLine.create({ data: { ...c, noteId, lineNo }, select: LINE_SELECT }));
    }
    return rows;
  });
  await AuditService.logMany(created.map((l) => ({ userId, action: "CREATE" as const, tableName: LINE_TABLE, recordId: l.id, newData: { noteId, ...auditLine(l) } })));
  return created;
}

export async function updateDeliveryNoteLine(noteId: string, lineId: string, patch: Partial<DeliveryNoteLineInput>, userId: string) {
  const before = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: lineId }, select: LINE_SELECT });
  if (!before || before.noteId !== noteId) throw AppError.notFound("Satır bulunamadı.", { code: "DELIVERY_NOTE_LINE_NOT_FOUND" });
  const merged: DeliveryNoteLineInput = {
    lineKind: patch.lineKind ?? before.lineKind, blockNo: patch.blockNo ?? before.blockNo,
    senderRollNo: patch.senderRollNo === undefined ? before.senderRollNo : patch.senderRollNo,
    meters: patch.meters ?? Number(before.meters),
    weightKg: patch.weightKg === undefined ? (before.weightKg === null ? null : Number(before.weightKg)) : patch.weightKg,
    widthCm: patch.widthCm === undefined ? (before.widthCm === null ? null : Number(before.widthCm)) : patch.widthCm,
    itemText: patch.itemText === undefined ? before.itemText : patch.itemText, itemId: patch.itemId === undefined ? before.itemId : patch.itemId,
    colorText: patch.colorText === undefined ? before.colorText : patch.colorText, colorId: patch.colorId === undefined ? before.colorId : patch.colorId,
    processText: patch.processText === undefined ? before.processText : patch.processText,
    needsReview: patch.needsReview ?? before.needsReview,
  };
  const { confidence: _c, ...cols } = lineColumns(merged);
  const after = await prisma.$transaction(async (tx) => {
    await claimDraft(tx, noteId, userId);
    // Elle düzeltilen satır gözden geçirildi sayılır (operatör değeri gördü ve yazdı).
    return tx.customerDeliveryNoteLine.update({ where: { id: lineId }, data: { ...cols, needsReview: patch.needsReview ?? false }, select: LINE_SELECT });
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: LINE_TABLE, recordId: lineId, oldData: auditLine(before), newData: auditLine(after) });
  return after;
}

export async function deleteDeliveryNoteLine(noteId: string, lineId: string, userId: string): Promise<{ id: string }> {
  const before = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: lineId }, select: LINE_SELECT });
  if (!before || before.noteId !== noteId) throw AppError.notFound("Satır bulunamadı.", { code: "DELIVERY_NOTE_LINE_NOT_FOUND" });
  await prisma.$transaction(async (tx) => {
    await claimDraft(tx, noteId, userId);
    await tx.customerDeliveryNoteLine.deleteMany({ where: { id: lineId, noteId } });
  });
  void AuditService.log({ userId, action: "DELETE", tableName: LINE_TABLE, recordId: lineId, oldData: auditLine(before) });
  return { id: lineId };
}
