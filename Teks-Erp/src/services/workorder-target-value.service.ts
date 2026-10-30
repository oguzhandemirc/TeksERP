// =============================================================================
// İŞ EMRİ HEDEF ÇEŞİT DEĞERİ ve GRAMAJ ÖZETİ uçları (KQ-D6, 2026-10-24)
// =============================================================================
// PUT hedefi ÖZELLİK KAPSAMLI ve fark bazlıdır (eski satır damgalanır, aynısı no-op); audit tx
// DIŞINDA ve yalnız gerçek değişimde yazılır. Özetler `process-summary.helper.ts`ten.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import {
  assertTargetValueItems,
  readActiveTargetValues,
  setWorkOrderTargetValuesTx,
  type TargetValueUpdateItem,
} from "./helpers/workorder-target-value.helper";
import { summarizeKursunApplications, type KursunSummary } from "./helpers/process-summary.helper";
import { effectiveIncomingDocsEnabled } from "./system-setting.service";
import { suggestWorkOrderGramaj, type WorkOrderGramajSuggestion } from "./workorder-gramaj-suggestion.service";

export async function replaceWorkOrderTargetValues(workOrderId: string, items: TargetValueUpdateItem[], userId?: string) {
  await assertTargetValueItems(prisma, items);
  const change = await prisma.$transaction(async (tx) => {
    // İE satır kilidi tx'in İLK ifadesi: aynı İE'ye eşzamanlı iki hedef yazımı serileşir.
    await touchWorkOrderTx(tx, workOrderId);
    const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
    if (!wo) throw AppError.notFound("Terbiye iş emri bulunamadı");
    return setWorkOrderTargetValuesTx(tx, { workOrderId, items, userId: userId ?? null });
  });
  for (const r of change.revoked) {
    await AuditService.log({
      userId, action: "UPDATE", tableName: "WORK_ORDER_TARGET_VALUE", recordId: r.id,
      oldData: { workOrderId, propertyId: r.propertyId, valueId: r.valueId, revokedAt: null },
      newData: { workOrderId, propertyId: r.propertyId, valueId: r.valueId, revoked: true },
    });
  }
  for (const c of change.created) {
    await AuditService.log({
      userId, action: "CREATE", tableName: "WORK_ORDER_TARGET_VALUE", recordId: c.id,
      newData: { workOrderId, propertyId: c.propertyId, valueId: c.valueId },
    });
  }
  const changed = change.revoked.length + change.created.length > 0;
  return {
    success: true as const,
    data: { changed, targetValues: await readActiveTargetValues(prisma, workOrderId) },
    message: changed ? "Hedef güncellendi" : "Hedef zaten aynı",
  };
}

/** Kurşun DIŞI aktif hedef (brode deseni vb., D4-D2) — İE detayında "desen hedefi". */
export interface VariantTarget {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly valueId: string;
  readonly valueName: string;
}

type ProcessSummaryData = { kursun: KursunSummary; deliveryNoteGramaj?: WorkOrderGramajSuggestion | null; variantTargets?: VariantTarget[] };

export async function getWorkOrderProcessSummary(workOrderId: string): Promise<{ success: true; data: ProcessSummaryData }> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!wo) throw AppError.notFound("Terbiye iş emri bulunamadı");
  const kursun = await summarizeKursunApplications({ workOrderId });
  // D4-D2: kurşun dışı hedef yalnız VARSA anahtar olarak eklenir (yanıt bugünkü İE'lerde bayt-aynı).
  const variantTargets: VariantTarget[] = (await readActiveTargetValues(prisma, workOrderId))
    .filter((t) => t.propertyId !== kursun.target?.propertyId)
    .map((t) => ({ propertyId: t.propertyId, propertyName: t.property.name, valueId: t.valueId, valueName: t.value.name }));
  const extra = variantTargets.length > 0 ? { variantTargets } : {};
  // H9b: modül kapalıyken anahtar HİÇ yok (yanıt bayt-aynı); açıkken gelen belgesiz İE'de null.
  if (!(await effectiveIncomingDocsEnabled())) return { success: true, data: { kursun, ...extra } };
  return { success: true, data: { kursun, deliveryNoteGramaj: await suggestWorkOrderGramaj(workOrderId), ...extra } };
}

export async function getBatchProcessSummary(batchId: string): Promise<{ success: true; data: { kursun: KursunSummary } }> {
  const b = await prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
  if (!b) throw AppError.notFound("Parti bulunamadı");
  return { success: true, data: { kursun: await summarizeKursunApplications({ batchId }) } };
}
