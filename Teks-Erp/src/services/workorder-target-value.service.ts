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
import { staleTargetNoteWarnings } from "./helpers/fason-step-target-note.helper";
import {
  assertTargetValueItems,
  readActiveTargetValues,
  setWorkOrderTargetValuesTx,
  type TargetValueUpdateItem,
} from "./helpers/workorder-target-value.helper";
import { listKursunApplications, readKursunTarget, summarizeKursunApplications, type KursunSummary } from "./helpers/process-summary.helper";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";
import { PLAN_CHANGE_FROZEN_STATUSES } from "./helpers/workorder-target-color.helper";
import { recordWorkOrderFieldChangesTx } from "./helpers/workorder-event.helper";
import { whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";
import { NO_LIVE_MATERIAL_STATUSES } from "./batch.service";
import { KURSUN_GRAMAJ_EVENT_FIELD } from "../constants/workorder-event-labels";
import { effectiveIncomingDocsEnabled } from "./system-setting.service";
import { suggestWorkOrderGramaj, type WorkOrderGramajSuggestion } from "./workorder-gramaj-suggestion.service";
import { TERIM } from "../constants/terim";

/**
 * `kursunOnly`: tablet Düzelt kapısı (`mobile:is-emri-duzelt`, `workorder:write` YOK) — gövde yalnız kurşun gramajı
 * özelliğini taşıyabilir ve donmuş (bitmiş/iptal) İE'ye yazamaz; panel yolu bugünkü gibi serbest.
 */
export interface TargetValueWriteOpts {
  kursunOnly?: boolean;
  reason?: string | null;
}

export async function replaceWorkOrderTargetValues(workOrderId: string, items: TargetValueUpdateItem[], userId?: string, opts: TargetValueWriteOpts = {}) {
  await assertTargetValueItems(prisma, items);
  if (opts.kursunOnly) await assertKursunOnlyItems(items);
  const reason = opts.reason?.trim() || null;
  const change = await prisma.$transaction(async (tx) => {
    // İE satır kilidi tx'in İLK ifadesi: aynı İE'ye eşzamanlı iki hedef yazımı serileşir.
    await touchWorkOrderTx(tx, workOrderId);
    const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (opts.kursunOnly && PLAN_CHANGE_FROZEN_STATUSES.includes(wo.status)) {
      throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} kapanmış; gramaj değiştirilemez.`, { code: "WORK_ORDER_PLAN_FROZEN" });
    }
    const before = await readKursunTarget(workOrderId, tx);
    const out = await setWorkOrderTargetValuesTx(tx, { workOrderId, items, userId: userId ?? null });
    const after = await readKursunTarget(workOrderId, tx);
    // Gramaj değişimi İE hareket defterine (FIELD_CHANGED, sebep varsa satırda) — geçmiş uygulamalar RollOperation'da donar.
    if ((before?.valueId ?? null) !== (after?.valueId ?? null)) {
      await recordWorkOrderFieldChangesTx(tx, workOrderId, [{
        field: KURSUN_GRAMAJ_EVENT_FIELD, from: before?.valueId ?? null, to: after?.valueId ?? null,
        fromLabel: before?.valueName ?? null, toLabel: after?.valueName ?? null,
      }], { trigger: "KURSUN_GRAMAJ_CHANGE", userId: userId ?? null, reason });
    }
    return { ...out, kursunChanged: (before?.valueId ?? null) !== (after?.valueId ?? null) };
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
  // SY-F4: dış adım notu yalnız doğuşta yazılır; hedef değişince eski talimat kaldıysa uyarılır (yoksa yanıt bayt-aynı).
  const warnings = await staleTargetNoteWarnings(prisma, workOrderId, change.revoked);
  if (change.kursunChanged) {
    const split = await kursunRollSplit(workOrderId);
    if (split.applied > 0) warnings.push(`${split.applied} topa kurşun eski gramajla uygulandı (geçmiş değişmez); yeni gramaj kalan ${split.pending} topa işler.`);
  }
  return {
    success: true as const,
    data: { changed, targetValues: await readActiveTargetValues(prisma, workOrderId) },
    message: changed ? "Hedef güncellendi" : "Hedef zaten aynı",
    ...(warnings.length > 0 ? { warnings } : {}),
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
  if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
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

/** Tablet gramaj düzeltmesi: gövdede kurşun gramajı dışında özellik → 403 (dar izin geniş yazıma açılmaz). */
async function assertKursunOnlyItems(items: TargetValueUpdateItem[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.propertyId))];
  const ok = ids.length === 0 ? 0 : await prisma.fabricProperty.count({ where: { id: { in: ids }, variantOf: { code: KURSUN_PROPERTY_CODE } } });
  if (ids.length === 0 || ok !== ids.length) {
    throw AppError.forbidden("Tablet düzeltmesi yalnız kurşun gramajını değiştirebilir.", { code: "PERMISSION_DENIED" });
  }
}

/** Kurşunu uygulanmış toplar (TABLET + KAĞIT, tek kaynak `listKursunApplications`) ↔ kalan canlı toplar. */
export async function kursunRollSplit(workOrderId: string): Promise<{ applied: number; pending: number }> {
  const appliedIds = [...new Set((await listKursunApplications({ workOrderId })).map((a) => a.rollId))];
  const pending = await prisma.roll.count({
    where: { AND: [whereRollsOfWorkOrder(workOrderId), { status: { notIn: NO_LIVE_MATERIAL_STATUSES } }, ...(appliedIds.length ? [{ id: { notIn: appliedIds } }] : [])] },
  });
  return { applied: appliedIds.length, pending };
}

export interface WorkOrderKursunGramaj {
  /** Kurşun gramajı çeşit özelliği; yoksa (katalog kurulmamış) null — tablet düğmeyi göstermez. */
  propertyId: string | null;
  target: { valueId: string; valueName: string } | null;
  options: Array<{ id: string; name: string; isDefault: boolean }>;
  appliedRollCount: number;
  pendingRollCount: number;
  /** İE donmuş (bitmiş/iptal) değilse true. */
  editable: boolean;
}

/** Tablet "Gramajı Değiştir" önizlemesi — salt okuma; seçenekler fabric-property izni istemeden buradan gelir. */
export async function getWorkOrderKursunGramaj(workOrderId: string): Promise<WorkOrderKursunGramaj> {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
  if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
  const property = await prisma.fabricProperty.findFirst({
    where: { isActive: true, variantOf: { code: KURSUN_PROPERTY_CODE } },
    select: {
      id: true,
      values: { where: { isActive: true }, select: { id: true, name: true, isDefault: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const target = await readKursunTarget(workOrderId);
  const split = await kursunRollSplit(workOrderId);
  return {
    propertyId: property?.id ?? null,
    target: target ? { valueId: target.valueId, valueName: target.valueName } : null,
    options: property?.values ?? [],
    appliedRollCount: split.applied,
    pendingRollCount: split.pending,
    editable: !PLAN_CHANGE_FROZEN_STATUSES.includes(wo.status),
  };
}
