// =============================================================================
// GELEN BELGE — "Bu iş emri hangi belgeyle geldi" (K28: İE detayında "Geldiği belge" + fotoğraf aç)
// =============================================================================
// Salt okuma. Toplar İE'nin TEK tanımından (`whereRollsOfWorkOrder`, durumdan bağımsız: tüketilmiş ata da geçmiştir),
// belge satırı en yakın atadan (`resolveDeliveryNoteLinesForRolls`). Tarama künyesi bayt saklama durumuyla döner;
// SİLİNDİ fotoğraf istemcide "Fotoğraf saklama ayarı gereği silindi" olarak çizilir (bayt ucu 410).
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { resolveDeliveryNoteLinesForRolls } from "./helpers/roll-delivery-note-line.helper";
import { whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";

/** Yanıttaki en çok belge (çok partili büyük İE'de liste taşmasın; `total` tam sayı). */
export const WORK_ORDER_NOTES_LIMIT = 20;

export interface WorkOrderSourceNote {
  id: string;
  noteNo: string;
  status: string;
  senderDocNo: string | null;
  scans: Array<{ id: string; pageNo: number; regionNo: number | null; mimeType: string; contentState: string; contentStateAt: Date | null }>;
}

export async function workOrderSourceNotes(workOrderId: string): Promise<{ total: number; notes: WorkOrderSourceNote[] }> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!wo) throw AppError.notFound("İş emri bulunamadı.", { code: "WORK_ORDER_NOT_FOUND" });
  const rolls = await prisma.roll.findMany({ where: whereRollsOfWorkOrder(workOrderId), select: { id: true } });
  if (rolls.length === 0) return { total: 0, notes: [] };
  const lines = await resolveDeliveryNoteLinesForRolls(rolls.map((r) => r.id));
  const noteIds = [...new Set([...lines.values()].map((l) => l.noteId))];
  if (noteIds.length === 0) return { total: 0, notes: [] };
  const notes = await prisma.customerDeliveryNote.findMany({
    where: { id: { in: noteIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: WORK_ORDER_NOTES_LIMIT,
    select: {
      id: true, noteNo: true, status: true, senderDocNo: true,
      scans: { select: { id: true, pageNo: true, regionNo: true, mimeType: true, contentState: true, contentStateAt: true }, orderBy: [{ pageNo: "asc" }, { regionNo: "asc" }] },
    },
  });
  return { total: noteIds.length, notes };
}
