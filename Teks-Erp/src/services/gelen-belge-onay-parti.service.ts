// Gelen belge onayı — PER_DOCUMENT özet satırları (S1 çok partili belge: parti başına bir özet satırı/top). Onay servisinden
// ayrıldı (dosya sınırı); claim ve döngü onay servisinde kalır, burası yalnız özet satırlarını TEK tx'te hazırlar.
import { DeliveryNoteLineKind, DeliveryNoteLineStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { isOpenForApproval, isSummaryLine, partyLineId, summaryLineId } from "./gelen-belge-kontrol.service";
import { sayiMetni } from "./reports/anlati/sayi-bicim";

const LINE_TABLE = "CUSTOMER_DELIVERY_NOTE_LINE";

/** `senderRollNo`/`lineKind` yalnız "Toplar ayrı geldi"de (özet satırı = bir top). `weightKg`/`widthCm` ARABA'da belgenin GELEN
 *  kg'si / eni (2026-11-09): satıra yazılır, topa YAZILMAZ (onay döngüsü korur — top kg'si/eni "ölçülmüş" anlamını korur). */
export type PartyEntry = { blockNo: number; meters: number; weightKg?: number | null; widthCm?: number | null; customerBatchNo?: string | null; senderRollNo?: string | null; lineKind?: DeliveryNoteLineKind; itemText?: string | null; colorText?: string | null };
/** Tek özet satırının (partisiz ARABA) belge beyanı: gelen kg + gelen en + gelen kumaş adı/renk (satıra yazılır, topa geçmez). */
export type SummaryDeclared = { kg?: number | null; widthCm?: number | null; itemText?: string | null; colorText?: string | null };
type SummaryTarget = { id: string; blockNo: number; meters: Prisma.Decimal; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; customerBatchNo: string | null; senderRollNo: string | null; lineKind: DeliveryNoteLineKind; itemText: string | null; colorText: string | null };

const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n));
const batchText = (v: string | null | undefined) => v?.trim().slice(0, 64) || null;
/** Beyan metni (kolon tavanı: itemText 160, colorText 120); boş → null. */
const declText = (v: string | null | undefined, max: number) => v?.replace(/\s+/g, " ").trim().slice(0, max) || null;

/** Onay ön okumasının bu dosyanın kullandığı alt kümesi. */
type PartyNote = {
  id: string;
  noteNo: string;
  customerBatchNo: string | null;
  kursunMeters: Prisma.Decimal | null;
  kursunMetersSource: string | null;
  lines: ReadonlyArray<{ id: string; blockNo: number; rollId: string | null; status: DeliveryNoteLineStatus }>;
};

/**
 * PER_DOCUMENT hazırlık — TEK tx: özet satırı (sabit kimlik; varsa metresi tazelenir) + belgenin topsuz açık satırları INFO.
 * Satır claim'i ve döngü bundan sonra yalnız özet satırını görür (ikinci giriş motoru yok).
 */
/** Özet satırı hedefleri: partiler verildiyse blok başına (`partyLineId`), yoksa tek özet satırı = kurşun metresi (bugünkü).
 *  Müşteri parti no: çok partide partinin (formda onaylanan), tek partide / ayrı toplarda başlığınki. */
export function summaryTargets(note: PartyNote, parties?: ReadonlyArray<PartyEntry>, summary?: SummaryDeclared): SummaryTarget[] {
  if (!parties?.length) return [{ id: summaryLineId(note.id), blockNo: 1, meters: note.kursunMeters ?? new Prisma.Decimal(0), weightKg: dec(summary?.kg), widthCm: dec(summary?.widthCm), customerBatchNo: batchText(note.customerBatchNo), senderRollNo: null, lineKind: DeliveryNoteLineKind.ARABA, itemText: declText(summary?.itemText, 160), colorText: declText(summary?.colorText, 120) }];
  return [...parties].sort((a, b) => a.blockNo - b.blockNo).map((p) => ({
    id: partyLineId(note.id, p.blockNo), blockNo: p.blockNo, meters: new Prisma.Decimal(p.meters),
    weightKg: dec(p.weightKg), widthCm: dec(p.widthCm), senderRollNo: p.senderRollNo ?? null, lineKind: p.lineKind ?? DeliveryNoteLineKind.ARABA,
    customerBatchNo: p.lineKind === DeliveryNoteLineKind.TOP ? batchText(note.customerBatchNo) : batchText(p.customerBatchNo),
    itemText: declText(p.itemText, 160), colorText: declText(p.colorText, 120),
  }));
}

/** Onay ön kontrolünün kip uyarısı: ayrı toplar · çok parti · tek kayıt (operatörün gördüğü özet). */
export function perDocumentEntryWarning(targets: ReadonlyArray<{ meters: Prisma.Decimal }>, o: { separateRolls?: boolean; itemName: string; infoLines: number; kursunMeters: Prisma.Decimal | null }): string {
  const metres = targets.map((t) => `${sayiMetni(Number(t.meters), 3)} m`).join(" + ");
  const tail = `${o.infoLines} satır bilgi olarak kaldı.`;
  if (o.separateRolls) return `Toplar ayrı: ${targets.length} top ayrı top olarak ${o.itemName} ürünüyle girildi (${metres}); ${tail}`;
  if (targets.length > 1) return `Çok partili belge: ${targets.length} parti ayrı top olarak ${o.itemName} ürünüyle girildi (${metres}); ${tail}`;
  return `Belge başına tek kayıt: ${sayiMetni(Number(o.kursunMeters), 3)} m tek top olarak ${o.itemName} ürünüyle girildi; ${tail}`;
}

export async function preparePerDocument(note: PartyNote, userId: string, parties?: ReadonlyArray<PartyEntry>, summary?: SummaryDeclared): Promise<void> {
  const targets = summaryTargets(note, parties, summary);
  const infoIds = note.lines.filter((l) => !isSummaryLine(note.id, l) && !l.rollId && isOpenForApproval(l)).map((l) => l.id);
  // Başlık APPROVING'de claim'li: satır yazan başka yol yok, numara (son + 1) yarışsız.
  const created = await prisma.$transaction(async (tx) => {
    const made: Array<SummaryTarget & { lineNo: number }> = [];
    for (const t of targets) {
      const has = await tx.customerDeliveryNoteLine.updateMany({ where: { id: t.id, noteId: note.id, rollId: null }, data: { meters: t.meters, weightKg: t.weightKg, widthCm: t.widthCm, customerBatchNo: t.customerBatchNo, itemText: t.itemText, colorText: t.colorText, ...(t.lineKind === DeliveryNoteLineKind.TOP ? { senderRollNo: t.senderRollNo, lineKind: t.lineKind } : {}) } });
      if (has.count > 0 || (await tx.customerDeliveryNoteLine.count({ where: { id: t.id } }))) continue;
      const last = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId: note.id }, _max: { lineNo: true } });
      const lineNo = (last._max.lineNo ?? 0) + 1;
      await tx.customerDeliveryNoteLine.create({ data: { id: t.id, noteId: note.id, lineNo, blockNo: t.blockNo, lineKind: t.lineKind, meters: t.meters, weightKg: t.weightKg, widthCm: t.widthCm, customerBatchNo: t.customerBatchNo, itemText: t.itemText, colorText: t.colorText, senderRollNo: t.senderRollNo, status: DeliveryNoteLineStatus.PENDING, confidence: new Prisma.Decimal(1) } });
      made.push({ ...t, lineNo });
    }
    if (infoIds.length) {
      await tx.customerDeliveryNoteLine.updateMany({ where: { id: { in: infoIds }, rollId: null, status: { in: [DeliveryNoteLineStatus.PENDING, DeliveryNoteLineStatus.FAILED, DeliveryNoteLineStatus.ENTERING] } }, data: { status: DeliveryNoteLineStatus.INFO, failReason: null } });
    }
    return made;
  });
  if (created.length) {
    await AuditService.logMany(created.map((c) => ({ userId, action: "CREATE" as const, tableName: LINE_TABLE, recordId: c.id, newData: { noteId: note.id, noteNo: note.noteNo, lineNo: c.lineNo, blockNo: c.blockNo, lineKind: c.lineKind, meters: c.meters.toString(), ...(c.weightKg ? { weightKg: c.weightKg.toString() } : {}), ...(c.widthCm ? { widthCm: c.widthCm.toString() } : {}), ...(c.senderRollNo ? { senderRollNo: c.senderRollNo } : {}), ...(c.customerBatchNo ? { customerBatchNo: c.customerBatchNo } : {}), ...(c.itemText ? { itemText: c.itemText } : {}), ...(c.colorText ? { colorText: c.colorText } : {}), kursunMetersSource: note.kursunMetersSource, entryMode: "PER_DOCUMENT", ...(parties?.length ? { party: true } : {}) } })));
  }
  if (infoIds.length) await AuditService.logMany(infoIds.map((lid) => ({ userId, action: "UPDATE" as const, tableName: LINE_TABLE, recordId: lid, oldData: { status: note.lines.find((l) => l.id === lid)?.status ?? null }, newData: { status: "INFO", noteNo: note.noteNo, entryMode: "PER_DOCUMENT" } })));
}
