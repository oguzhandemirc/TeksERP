// =============================================================================
// İŞ EMRİ HEDEF ÇEŞİT DEĞERİ ve GRAMAJ ÖZETİ uçları (KQ-D6, 2026-10-24)
// =============================================================================
// PUT hedefi ÖZELLİK KAPSAMLI ve fark bazlıdır (eski satır damgalanır, aynısı no-op); audit tx
// DIŞINDA ve yalnız gerçek değişimde yazılır. Özetler `process-summary.helper.ts`ten.
// =============================================================================
import { ReasonPresetKind, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { staleTargetNoteWarnings } from "./helpers/fason-step-target-note.helper";
import {
  ACTIVE_TARGET_VALUE,
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
import { KURSUN_GRAMAJ_EVENT_FIELD, TARGET_VALUE_EVENT_FIELD } from "../constants/workorder-event-labels";
import { loadTargetValueEditLocks } from "./helpers/workorder-target-value-step.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { resolveReasonCode } from "./reason-preset.service";
import { effectiveIncomingDocsEnabled } from "./system-setting.service";
import { suggestWorkOrderGramaj, type WorkOrderGramajSuggestion } from "./workorder-gramaj-suggestion.service";
import { TERIM } from "../constants/terim";

/**
 * `tabletFix`: tablet Düzelt yolu (`workorder:write` yok ya da gövde `correction: true`). Donmuş İE 409; kurşun
 * gramajı bugünkü gibi (adım kilidi yok, sebep isteğe bağlı); kurşun DIŞI değer yalnız İE'de zaten olan hedefin
 * DEĞİŞİMİdir (yeni/kaldırma 403), sebep zorunlu, değerin adımı başladıysa 409 (kilit tx içinde yeniden ölçülür).
 * Panel yolu bugünkü gibi serbest.
 */
export interface TargetValueWriteOpts {
  tabletFix?: boolean;
  reason?: string | null;
  reasonCode?: string | null;
}

const MIN_FIX_REASON_LENGTH = 3;
export const TARGET_VALUE_STEP_STARTED = "TARGET_VALUE_STEP_STARTED";

type PropMeta = { id: string; name: string; isKursun: boolean };

async function readPropMeta(items: TargetValueUpdateItem[]): Promise<Map<string, PropMeta>> {
  const ids = [...new Set(items.map((i) => i.propertyId))];
  const rows = ids.length === 0 ? [] : await prisma.fabricProperty.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, variantOf: { select: { code: true } } },
  });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, isKursun: r.variantOf?.code === KURSUN_PROPERTY_CODE }]));
}

/** Tablet düzeltme kapsamı + adım kilidi — tx öncesi ve İE kilidi ALTINDA aynı ölçüm (fold-change kalıbı). */
async function assertTabletFixScope(db: Prisma.TransactionClient | typeof prisma, workOrderId: string, items: TargetValueUpdateItem[], meta: Map<string, PropMeta>): Promise<void> {
  const others = items.filter((i) => !meta.get(i.propertyId)?.isKursun);
  if (items.length === 0) throw AppError.forbidden("Tablet düzeltmesi hedefleri toplu kaldıramaz.", { code: "PERMISSION_DENIED" });
  if (others.length === 0) return;
  const active = await db.workOrderTargetValue.findMany({
    where: { workOrderId, ...ACTIVE_TARGET_VALUE, propertyId: { in: others.map((i) => i.propertyId) } },
    select: { propertyId: true },
  });
  for (const i of others) {
    if (i.valueId === null || !active.some((a) => a.propertyId === i.propertyId)) {
      throw AppError.forbidden(`Tablet düzeltmesi yalnız ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} olan hedef değeri değiştirebilir (ekleme/kaldırma panelden).`, { code: "PERMISSION_DENIED" });
    }
  }
  const locks = await loadTargetValueEditLocks(db, workOrderId, others.map((i) => i.propertyId));
  for (const i of others) {
    const lock = locks.get(i.propertyId);
    if (!lock || lock.locked) {
      throw AppError.conflict(lock?.reason ?? "Hedef değer kilitli.", { code: TARGET_VALUE_STEP_STARTED, propertyId: i.propertyId });
    }
  }
}

function fixLabel(name: string | undefined, value: string | null | undefined): string | null {
  return value ? `${name ?? "Hedef"}: ${value}`.slice(0, 200) : null;
}

export async function replaceWorkOrderTargetValues(workOrderId: string, items: TargetValueUpdateItem[], userId?: string, opts: TargetValueWriteOpts = {}) {
  await assertTargetValueItems(prisma, items);
  const reason = opts.reason?.trim() || null;
  const meta = await readPropMeta(items);
  const nonKursun = items.filter((i) => !meta.get(i.propertyId)?.isKursun);
  let reasonCode: string | null = null;
  if (opts.tabletFix) {
    await assertTabletFixScope(prisma, workOrderId, items, meta);
    if (nonKursun.length > 0) {
      if ((reason ?? "").length < MIN_FIX_REASON_LENGTH) throw AppError.badRequest("Hedef değer düzeltmesi için sebep yazmalısınız.");
      reasonCode = (await resolveReasonCode(ReasonPresetKind.WORK_ORDER_PLAN_CHANGE, { reasonCode: opts.reasonCode, reasonText: reason })).code;
    }
  }
  const change = await prisma.$transaction(async (tx) => {
    // İE satır kilidi tx'in İLK ifadesi: aynı İE'ye eşzamanlı iki hedef yazımı serileşir.
    await touchWorkOrderTx(tx, workOrderId);
    const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (opts.tabletFix && PLAN_CHANGE_FROZEN_STATUSES.includes(wo.status)) {
      throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} kapanmış; hedef değer değiştirilemez.`, { code: "WORK_ORDER_PLAN_FROZEN" });
    }
    // Kilit ALTINDA taze ölçüm: ön kontrolden sonra adım başlamış olabilir.
    if (opts.tabletFix) await assertTabletFixScope(tx, workOrderId, items, meta);
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
    // Tablet düzeltmesi (kurşun dışı): özellik başına sebepli satır + refakat kartı güncel değil.
    if (opts.tabletFix && nonKursun.length > 0) {
      const fixed = nonKursun.map((i) => i.propertyId);
      const names = await tx.fabricPropertyValue.findMany({
        where: { id: { in: [...out.revoked, ...out.created].filter((r) => fixed.includes(r.propertyId)).map((r) => r.valueId) } },
        select: { id: true, name: true },
      });
      const nameOf = (id: string | undefined) => names.find((n) => n.id === id)?.name;
      const rows = fixed.flatMap((pid) => {
        const from = out.revoked.find((r) => r.propertyId === pid)?.valueId ?? null;
        const to = out.created.find((r) => r.propertyId === pid)?.valueId ?? null;
        if (from === to) return [];
        const pName = meta.get(pid)?.name;
        return [{ field: TARGET_VALUE_EVENT_FIELD, from, to, fromLabel: fixLabel(pName, nameOf(from ?? undefined)), toLabel: fixLabel(pName, nameOf(to ?? undefined)) }];
      });
      if (rows.length > 0) {
        await recordWorkOrderFieldChangesTx(tx, workOrderId, rows, { trigger: "TARGET_VALUE_CHANGE", userId: userId ?? null, reason, reasonCode });
        await markTravelerCardDirtyTx(tx, workOrderId);
      }
    }
    return { ...out, kursunChanged: (before?.valueId ?? null) !== (after?.valueId ?? null) };
  });
  const auditReason = reason ? { reason } : {};
  for (const r of change.revoked) {
    await AuditService.log({
      userId, action: "UPDATE", tableName: "WORK_ORDER_TARGET_VALUE", recordId: r.id,
      oldData: { workOrderId, propertyId: r.propertyId, valueId: r.valueId, revokedAt: null },
      newData: { workOrderId, propertyId: r.propertyId, valueId: r.valueId, revoked: true, ...auditReason },
    });
  }
  for (const c of change.created) {
    await AuditService.log({
      userId, action: "CREATE", tableName: "WORK_ORDER_TARGET_VALUE", recordId: c.id,
      newData: { workOrderId, propertyId: c.propertyId, valueId: c.valueId, ...auditReason },
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
