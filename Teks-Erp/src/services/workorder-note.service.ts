// =============================================================================
// İŞ EMRİ PLANLAMA NOTU (2026-11-19)
// =============================================================================
// Panel kullanıcıları (`workorder:read`) görür; refakat kartı, etiket, tablet yanıtı ve
// patron bulutu GÖRMEZ — bu yüzden ayrı tablo (`work_order_notes`) ve ayrı uç. Detay/tablet
// yanıtına, kart HTML'ine EKLEME. Temizleme satırı silmez, `body`yi boş yazar.
// =============================================================================

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";

export const WORK_ORDER_NOTE_MAX = 2000;

export interface WorkOrderNoteView {
  workOrderId: string;
  /** Boş not → null. */
  body: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
}

async function assertWorkOrder(workOrderId: string): Promise<void> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!wo) throw AppError.notFound("İş emri bulunamadı");
}

async function view(workOrderId: string): Promise<WorkOrderNoteView> {
  const row = await prisma.workOrderNote.findUnique({
    where: { workOrderId },
    select: { body: true, updatedAt: true, updatedById: true },
  });
  const updatedAt = row?.updatedAt.toISOString() ?? null;
  if (!row || row.body.length === 0) return { workOrderId, body: null, updatedAt, updatedBy: null };
  const user = row.updatedById
    ? await prisma.user.findUnique({ where: { id: row.updatedById }, select: { id: true, fullName: true } })
    : null;
  return { workOrderId, body: row.body, updatedAt, updatedBy: user };
}

export async function getWorkOrderNote(workOrderId: string): Promise<ApiResponse<WorkOrderNoteView>> {
  await assertWorkOrder(workOrderId);
  return { success: true, data: await view(workOrderId) };
}

/** Boş/yalnız boşluk → temizle. Tek satır upsert (`workOrderId @unique`, native ON CONFLICT). */
export async function setWorkOrderNote(
  workOrderId: string,
  rawBody: string,
  userId?: string,
): Promise<ApiResponse<WorkOrderNoteView>> {
  const body = rawBody.trim();
  if (body.length > WORK_ORDER_NOTE_MAX) {
    throw AppError.badRequest(`Not en fazla ${WORK_ORDER_NOTE_MAX} karakter olabilir.`);
  }
  await assertWorkOrder(workOrderId);
  // Yalnız audit'in "önce" değeri ve "değişmedi" kısa devresi için okunur.
  const before = await prisma.workOrderNote.findUnique({ where: { workOrderId }, select: { body: true } });
  const oldBody = before?.body ?? "";
  if (oldBody === body) return { success: true, data: await view(workOrderId), message: "Not değişmedi." };

  await prisma.workOrderNote.upsert({
    where: { workOrderId },
    create: { workOrderId, body, updatedById: userId ?? null },
    update: { body, updatedById: userId ?? null },
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "WORK_ORDER",
    recordId: workOrderId,
    oldData: { planningNote: oldBody || null },
    newData: { event: body ? "PLANNING_NOTE_SET" : "PLANNING_NOTE_CLEARED", planningNote: body || null },
  });

  return {
    success: true,
    data: await view(workOrderId),
    message: body ? "Planlama notu kaydedildi." : "Planlama notu temizlendi.",
  };
}
