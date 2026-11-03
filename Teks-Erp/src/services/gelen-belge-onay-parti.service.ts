// Gelen belge onayı — PER_DOCUMENT özet satırları (S1 çok partili belge: parti başına bir özet satırı/top). Onay servisinden
// ayrıldı (dosya sınırı); claim ve döngü onay servisinde kalır, burası yalnız özet satırlarını TEK tx'te hazırlar.
import { DeliveryNoteLineStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { isOpenForApproval, isSummaryLine, partyLineId, summaryLineId } from "./gelen-belge-kontrol.service";

const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";

export type PartyEntry = { blockNo: number; meters: number };

/** Onay ön okumasının bu dosyanın kullandığı alt kümesi. */
type PartyNote = {
  id: string;
  noteNo: string;
  kursunMeters: Prisma.Decimal | null;
  kursunMetersSource: string | null;
  lines: ReadonlyArray<{ id: string; blockNo: number; rollId: string | null; status: DeliveryNoteLineStatus }>;
};

/**
 * PER_DOCUMENT hazırlık — TEK tx: özet satırı (sabit kimlik; varsa metresi tazelenir) + belgenin topsuz açık satırları INFO.
 * Satır claim'i ve döngü bundan sonra yalnız özet satırını görür (ikinci giriş motoru yok).
 */
/** Özet satırı hedefleri: partiler verildiyse blok başına (`partyLineId`), yoksa tek özet satırı = kurşun metresi (bugünkü). */
export function summaryTargets(note: PartyNote, parties?: ReadonlyArray<PartyEntry>): Array<{ id: string; blockNo: number; meters: Prisma.Decimal }> {
  if (!parties?.length) return [{ id: summaryLineId(note.id), blockNo: 1, meters: note.kursunMeters ?? new Prisma.Decimal(0) }];
  return [...parties].sort((a, b) => a.blockNo - b.blockNo).map((p) => ({ id: partyLineId(note.id, p.blockNo), blockNo: p.blockNo, meters: new Prisma.Decimal(p.meters) }));
}

export async function preparePerDocument(note: PartyNote, userId: string, parties?: ReadonlyArray<PartyEntry>): Promise<void> {
  const targets = summaryTargets(note, parties);
  const infoIds = note.lines.filter((l) => !isSummaryLine(note.id, l) && !l.rollId && isOpenForApproval(l)).map((l) => l.id);
  // Başlık APPROVING'de claim'li: satır yazan başka yol yok, numara (son + 1) yarışsız.
  const created = await prisma.$transaction(async (tx) => {
    const made: Array<{ id: string; lineNo: number; blockNo: number; meters: Prisma.Decimal }> = [];
    for (const t of targets) {
      const has = await tx.customerDeliveryNoteLine.updateMany({ where: { id: t.id, noteId: note.id, rollId: null }, data: { meters: t.meters } });
      if (has.count > 0 || (await tx.customerDeliveryNoteLine.count({ where: { id: t.id } }))) continue;
      const last = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId: note.id }, _max: { lineNo: true } });
      const lineNo = (last._max.lineNo ?? 0) + 1;
      await tx.customerDeliveryNoteLine.create({ data: { id: t.id, noteId: note.id, lineNo, blockNo: t.blockNo, lineKind: "ARABA", meters: t.meters, status: DeliveryNoteLineStatus.PENDING, confidence: new Prisma.Decimal(1) } });
      made.push({ ...t, lineNo });
    }
    if (infoIds.length) {
      await tx.customerDeliveryNoteLine.updateMany({ where: { id: { in: infoIds }, rollId: null, status: { in: [DeliveryNoteLineStatus.PENDING, DeliveryNoteLineStatus.FAILED, DeliveryNoteLineStatus.ENTERING] } }, data: { status: DeliveryNoteLineStatus.INFO, failReason: null } });
    }
    return made;
  });
  if (created.length) {
    await AuditService.logMany(created.map((c) => ({ userId, action: "CREATE" as const, tableName: LINE_TABLE, recordId: c.id, newData: { noteId: note.id, noteNo: note.noteNo, lineNo: c.lineNo, blockNo: c.blockNo, lineKind: "ARABA", meters: c.meters.toString(), kursunMetersSource: note.kursunMetersSource, entryMode: "PER_DOCUMENT", ...(parties?.length ? { party: true } : {}) } })));
  }
  if (infoIds.length) await AuditService.logMany(infoIds.map((lid) => ({ userId, action: "UPDATE" as const, tableName: LINE_TABLE, recordId: lid, oldData: { status: note.lines.find((l) => l.id === lid)?.status ?? null }, newData: { status: "INFO", noteNo: note.noteNo, entryMode: "PER_DOCUMENT" } })));
}
