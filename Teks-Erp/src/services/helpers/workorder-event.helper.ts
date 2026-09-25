// =============================================================================
// İŞ EMRİ HAREKET DEFTERİ — tek yazar (docs/design/IS-EMRI-HAREKET-DEFTERI.md)
// =============================================================================
// `work_order_events` satırı YALNIZ bu dosyadan doğar (defter-beyan §5 ölçer) ve
// iş emri STATÜSÜ yalnız `claimWorkOrderStatusTx` ile yazılır
// (`test_workorder_event_yazar` ölçer): statüyü değiştirip deftere yazmayan yol
// açılamaz. Kanal/cihaz/aktör istek bağlamından türer — çağıran yalnız NEDENİ
// (`trigger`) verir. Audit'ten okunmaz; audit yazımı çağıran eylemde kalır.
// =============================================================================

import { randomUUID } from "crypto";
import { Prisma, WorkOrderEventType, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import { currentOrigin } from "../../lib/request-context";

type Tx = Prisma.TransactionClient;

export type WorkOrderEventChannel = "PANEL" | "TABLET" | "SYSTEM" | "BACKFILL";

/** Satırın o anki görünen adı donar — panelin `workOrderStatusLabels` ile aynı metin. */
export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  SUPERSEDED: "Devredildi",
};

/** Panelin `workOrderTypeLabels` ile aynı metin. */
export const WORK_ORDER_TYPE_LABEL: Record<WorkOrderType, string> = {
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stok",
};

export interface WorkOrderEventCtx {
  /** Olayı tetikleyen işlem — sabit kod (`TAMBUR_FINALIZE`, `MANUAL_COMPLETE` …). */
  trigger: string;
  userId?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Aynı eylemin birden çok satırı tek grupta; verilmezse yeni grup. */
  groupId?: string;
}

export interface WorkOrderFieldChange {
  field: string;
  from: string | null;
  to: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
}

/** Panel mi tablet mi — cihaz türünden; istek bağlamı yoksa (job/script) SYSTEM. */
export function resolveWorkOrderEventChannel(): WorkOrderEventChannel {
  const origin = currentOrigin();
  if (!origin.requestId) return "SYSTEM";
  return origin.deviceKind === "TABLET" || origin.deviceKind === "PHONE" ? "TABLET" : "PANEL";
}

interface EventRow {
  workOrderId: string;
  type: WorkOrderEventType;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  payload?: Prisma.InputJsonValue;
}

async function writeWorkOrderEventsTx(tx: Tx, rows: EventRow[], ctx: WorkOrderEventCtx): Promise<void> {
  if (rows.length === 0) return;
  const origin = currentOrigin();
  const channel = resolveWorkOrderEventChannel();
  const groupId = ctx.groupId ?? randomUUID();
  await tx.workOrderEvent.createMany({
    data: rows.map((r) => ({
      workOrderId: r.workOrderId,
      type: r.type,
      groupId,
      field: r.field ?? null,
      fromValue: r.fromValue ?? null,
      toValue: r.toValue ?? null,
      fromLabel: r.fromLabel ?? null,
      toLabel: r.toLabel ?? null,
      trigger: ctx.trigger,
      channel,
      reason: ctx.reason ?? null,
      reasonCode: ctx.reasonCode ?? null,
      refType: ctx.refType ?? null,
      refId: ctx.refId ?? null,
      ...(r.payload !== undefined ? { payload: r.payload } : {}),
      createdById: ctx.userId ?? origin.userId ?? null,
      deviceId: origin.deviceId,
    })),
  });
}

/** Geçmiş doldurma satırı — kanal BACKFILL, zaman olayın GERÇEK (geçmiş) anı. */
export interface BackfillEventRow {
  workOrderId: string;
  type: WorkOrderEventType;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  trigger: string;
  reason?: string | null;
  createdById?: string | null;
  deviceId?: string | null;
  groupId: string;
  createdAt: Date;
  payload?: Prisma.InputJsonValue;
}

/**
 * Bir kerelik göçün yazıcısı (`scripts/backfill_workorder_events.ts`): satırlar `BACKFILL`
 * kanalıyla ve olayın geçmiş anıyla doğar — ekranda "sonradan türetildi" rozeti buradan.
 */
export async function recordBackfillEventsTx(tx: Tx, rows: BackfillEventRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await tx.workOrderEvent.createMany({
    data: rows.map((r) => ({
      workOrderId: r.workOrderId,
      type: r.type,
      groupId: r.groupId,
      field: r.field ?? null,
      fromValue: r.fromValue ?? null,
      toValue: r.toValue ?? null,
      fromLabel: r.fromLabel ?? null,
      toLabel: r.toLabel ?? null,
      trigger: r.trigger,
      channel: "BACKFILL",
      reason: r.reason ?? null,
      ...(r.payload !== undefined ? { payload: r.payload } : {}),
      createdById: r.createdById ?? null,
      deviceId: r.deviceId ?? null,
      createdAt: r.createdAt,
    })),
  });
  return res.count;
}

/**
 * İş emrini DOĞURAN tek yol — satır ve CREATED defter satırı aynı tx'te.
 * `args` `tx.workOrder.create`e aynen gider; `select` kullanılmaz (doğuş satırı
 * `id/status/workOrderNumber` skalerlerini okur).
 */
export async function createWorkOrderTx<T extends Prisma.WorkOrderCreateArgs>(
  tx: Tx,
  ctx: WorkOrderEventCtx,
  args: Prisma.SelectSubset<T, Prisma.WorkOrderCreateArgs>,
  payload?: Record<string, Prisma.InputJsonValue | null>,
): Promise<Prisma.WorkOrderGetPayload<T>> {
  const wo = await tx.workOrder.create<T>(args);
  const row = wo as unknown as {
    id: string; status: WorkOrderStatus; workOrderNumber: string; type: string;
    routeTemplateId: string | null; targetItemId: string | null; targetColorId: string | null;
  };
  await writeWorkOrderEventsTx(
    tx,
    [{
      workOrderId: row.id,
      type: WorkOrderEventType.CREATED,
      toValue: row.status,
      toLabel: row.workOrderNumber,
      payload: {
        type: row.type,
        routeTemplateId: row.routeTemplateId,
        targetItemId: row.targetItemId,
        targetColorId: row.targetColorId,
        ...payload,
      },
    }],
    ctx,
  );
  return wo;
}

/** Statü dışı alan değişimleri — tek eylem, tek grup, alan başına bir satır. */
export async function recordWorkOrderFieldChangesTx(
  tx: Tx,
  workOrderId: string,
  changes: WorkOrderFieldChange[],
  ctx: WorkOrderEventCtx,
): Promise<void> {
  await writeWorkOrderEventsTx(
    tx,
    changes
      .filter((c) => c.from !== c.to)
      .map((c) => ({
        workOrderId,
        type: WorkOrderEventType.FIELD_CHANGED,
        field: c.field,
        fromValue: c.from,
        toValue: c.to,
        fromLabel: c.fromLabel ?? null,
        toLabel: c.toLabel ?? null,
      })),
    ctx,
  );
}

/**
 * İş emri statüsünü değiştiren TEK yol. Mevcut statü okunur; izinli çıkışlardan
 * biriyse claim TAM o statüye karşı koşar (atomik) ve geçiş deftere yazılır.
 * `count === 0` eşzamanlı bir geçiştir → taze okumayla bir kez daha denenir.
 * Satır kilidi ALINMAZ: eski `updateMany WHERE status` yazımları eşleşmeyen
 * satırı kilitlemiyordu, kilit sırası değişmesin. Dönüş: geçişin ÇIKIŞ statüsü
 * ya da null (geçiş olmadı — çağıran kendi 409/sessiz dalını seçer).
 */
export async function claimWorkOrderStatusTx(
  tx: Tx,
  workOrderId: string,
  opts: {
    from: readonly WorkOrderStatus[];
    to: WorkOrderStatus;
    /** Claim'e eklenen atomik şart (ör. `isActive: true`). */
    where?: Prisma.WorkOrderWhereInput;
    /** Statüyle AYNI yazımda giden kolonlar (iptal künyesi). */
    data?: Omit<Prisma.WorkOrderUncheckedUpdateManyInput, "status">;
    ctx: WorkOrderEventCtx;
  },
): Promise<WorkOrderStatus | null> {
  let current: WorkOrderStatus | undefined;
  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    const row = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true } });
    current = row?.status;
    if (!current || !opts.from.includes(current) || current === opts.to) return null;
    const claim = await tx.workOrder.updateMany({
      where: { ...opts.where, id: workOrderId, status: current },
      data: { ...opts.data, status: opts.to },
    });
    claimed = claim.count === 1;
  }
  if (!claimed || !current) return null;
  await writeWorkOrderEventsTx(
    tx,
    [{
      workOrderId,
      type: WorkOrderEventType.STATUS_CHANGED,
      field: "status",
      fromValue: current,
      toValue: opts.to,
      fromLabel: WORK_ORDER_STATUS_LABEL[current],
      toLabel: WORK_ORDER_STATUS_LABEL[opts.to],
    }],
    opts.ctx,
  );
  return current;
}

/**
 * Tamamlanmış iş emrini yeniden açar (COMPLETED → IN_PROGRESS) — geri alma
 * yollarının TEK boğazı. Tamamlanma satırının karşı kaydını yazar; kart
 * statüsü çağıranın işidir (sıra: önce iş emri, sonra kart).
 */
export async function reopenWorkOrderTx(
  tx: Tx,
  workOrderId: string,
  ctx: WorkOrderEventCtx,
): Promise<boolean> {
  const from = await claimWorkOrderStatusTx(tx, workOrderId, {
    from: [WorkOrderStatus.COMPLETED],
    to: WorkOrderStatus.IN_PROGRESS,
    ctx,
  });
  return from !== null;
}

const OTHER_TYPE: Record<WorkOrderType, WorkOrderType> = {
  ORDER_PRODUCTION: WorkOrderType.STOCK_PRODUCTION,
  STOCK_PRODUCTION: WorkOrderType.ORDER_PRODUCTION,
};

/**
 * İş emri TİPİNİ çeviren tek yol (tip = sipariş bağının aynası). Claim karşı
 * tipe koşar; `count === 0` tanısı aynı tx'te taze sayımla: zaten hedef tipteyse
 * `ALREADY`, `where` tutmuyorsa (iptal/devredildi/kumaşsız) `NO_MATCH`.
 */
export async function setWorkOrderTypeTx(
  tx: Tx,
  workOrderId: string,
  to: WorkOrderType,
  opts: { where?: Prisma.WorkOrderWhereInput; ctx: WorkOrderEventCtx },
): Promise<"CHANGED" | "ALREADY" | "NO_MATCH"> {
  const from = OTHER_TYPE[to];
  const claim = await tx.workOrder.updateMany({
    where: { ...opts.where, id: workOrderId, type: from },
    data: { type: to },
  });
  if (claim.count === 1) {
    await recordWorkOrderFieldChangesTx(
      tx,
      workOrderId,
      [{ field: "type", from, to, fromLabel: WORK_ORDER_TYPE_LABEL[from], toLabel: WORK_ORDER_TYPE_LABEL[to] }],
      opts.ctx,
    );
    return "CHANGED";
  }
  const already = await tx.workOrder.count({ where: { ...opts.where, id: workOrderId, type: to } });
  return already > 0 ? "ALREADY" : "NO_MATCH";
}

/** Rota/adım planı değişimi; `step` null ise satır rotanın bütününe aittir (istasyon sırası). */
export async function recordStepPlanChangesTx(
  tx: Tx,
  workOrderId: string,
  plan: { step: { id: string; stepSequence: number; stationName: string } | null; changes: WorkOrderFieldChange[] },
  ctx: WorkOrderEventCtx,
): Promise<void> {
  const { step, changes } = plan;
  await writeWorkOrderEventsTx(
    tx,
    changes
      .filter((c) => c.from !== c.to)
      .map((c) => ({
        workOrderId,
        type: WorkOrderEventType.STEP_PLAN_CHANGED,
        field: c.field,
        fromValue: c.from,
        toValue: c.to,
        fromLabel: c.fromLabel ?? null,
        toLabel: c.toLabel ?? null,
        ...(step ? { payload: { stepId: step.id, stepSequence: step.stepSequence, stationName: step.stationName } } : {}),
      })),
    ctx,
  );
}

/** "Parti Ekle" — açık iş emrine yeni parti doğdu (DOĞUŞ; geri yolu toplarına Top Çıkar). */
export async function recordBatchAddedTx(tx: Tx, workOrderId: string, batch: { id: string; batchNumber: string; rollIds: string[]; totalQty: number }, ctx: WorkOrderEventCtx): Promise<void> {
  const payload = { rollIds: batch.rollIds, rollCount: batch.rollIds.length, totalQty: batch.totalQty };
  await writeWorkOrderEventsTx(tx, [{ workOrderId, type: WorkOrderEventType.BATCH_ADDED, field: "batch", toValue: batch.id, toLabel: batch.batchNumber, payload }], ctx);
}

/**
 * Plan düzeltmesinin toplara uygulanması — değer başına bir satır. Yük top başına
 * ESKİ değeri taşır: geri alma o değerleri toplara yeniden uygulayan yeni satırdır.
 */
export async function recordRollAttributesAppliedTx(
  tx: Tx,
  workOrderId: string,
  result: {
    applied: { field: "rollColor" | "rollWidth"; to: string | null; toLabel?: string | null }[];
    rolls: { rollId: string; fromColorId: string | null; fromWidth: string | null }[];
    failedRollIds: string[];
  },
  ctx: WorkOrderEventCtx,
): Promise<void> {
  await writeWorkOrderEventsTx(
    tx,
    result.applied.map((a) => ({
      workOrderId,
      type: WorkOrderEventType.ROLL_ATTRIBUTES_APPLIED,
      field: a.field,
      toValue: a.to,
      toLabel: a.toLabel ?? null,
      payload: { rolls: result.rolls, failedRollIds: result.failedRollIds },
    })),
    ctx,
  );
}
