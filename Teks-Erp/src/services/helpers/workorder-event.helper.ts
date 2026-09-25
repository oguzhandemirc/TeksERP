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
import { Prisma, WorkOrderEventType, WorkOrderStatus } from "@prisma/client";
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
