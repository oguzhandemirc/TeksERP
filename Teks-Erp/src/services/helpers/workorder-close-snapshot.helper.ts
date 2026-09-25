// =============================================================================
// İŞ EMRİ KAPANIŞ KÜNYESİ — tek yazar (docs/design/IS-EMRI-HAREKET-DEFTERI.md §5)
// =============================================================================
// Künye, COMPLETED geçişiyle AYNI tx'te donar: üretim çıktısı kümesi
// (`producedOutputWhere`, canlı başlıkla aynı tanım) top başına kalem olarak,
// toplamlar/verim başlık olarak. Satırlar `defter_block_tamper` mühürlüdür —
// yeniden açılma künyeyi değiştirmez, sonraki kapanış yeni `version` yazar.
// Okuyucu (`loadCloseSnapshotView`) en yüksek sürümü "kapanıştaki" diye döner.
// =============================================================================

import { Prisma, PrismaClient, WorkOrderEventType, WorkOrderStatus } from "@prisma/client";
import { currentOrigin } from "../../lib/request-context";
import { producedOutputWhere } from "./produced-output.helper";
import { loadProducedBuckets } from "./roll-finalize.helper";
import { computeWoInput } from "./coverage.helper";
import type { WorkOrderEventCtx } from "./workorder-event.helper";

type Tx = Prisma.TransactionClient;
type ReadDb = Tx | PrismaClient;

export type CloseKind = "AUTO_LAST_STEP" | "MANUAL" | "BACKFILL";

const BUCKET = { warehouse: "WAREHOUSE", a1: "A1", fire: "SCRAP" } as const;
const D0 = () => new Prisma.Decimal(0);

/** Oran yüzdesi — giren 0 ise tanımsız (null), "%0" uydurulmaz. */
function oran(pay: Prisma.Decimal, payda: Prisma.Decimal): Prisma.Decimal | null {
  return payda.gt(0) ? pay.div(payda).mul(100).toDecimalPlaces(3) : null;
}

/** Künyenin girdileri — kapanış tx'inde okunur. */
async function readCloseInputsTx(tx: Tx, workOrderId: string) {
  const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId }, select: { createdAt: true } });
  const steps = await tx.workOrderStep.findMany({ where: { workOrderId }, select: { id: true } });
  const previous = await tx.workOrderCloseSnapshot.count({ where: { workOrderId } });
  const firstStart = await tx.workOrderEvent.findFirst({
    where: { workOrderId, type: WorkOrderEventType.STATUS_CHANGED, toValue: WorkOrderStatus.IN_PROGRESS },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const stepIds = steps.map((s) => s.id);
  const rolls = stepIds.length === 0 ? [] : await tx.roll.findMany({
    where: producedOutputWhere(stepIds),
    select: {
      id: true, barcode: true, initialQty: true, currentQty: true, weightKg: true, width: true,
      colorId: true, qualityGrade: true, batchId: true, status: true, foldType: true,
      color: { select: { name: true } },
      batch: { select: { batchNumber: true } },
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const buckets = await loadProducedBuckets(tx);
  const input = (await computeWoInput(tx, [workOrderId])).get(workOrderId);
  return { startedAt: firstStart?.createdAt ?? wo.createdAt, version: previous + 1, rolls, buckets, input };
}

type CloseInputs = Awaited<ReturnType<typeof readCloseInputsTx>>;

/** Top başına kalem + kova toplamları (üretim metresi) + tartılmış kg. */
function buildLines(rolls: CloseInputs["rolls"], buckets: CloseInputs["buckets"]) {
  const sum = { warehouse: D0(), a1: D0(), fire: D0() };
  let totalKg: Prisma.Decimal | null = null;
  let weighed = 0;
  const lines = rolls.map((r) => {
    const b = buckets.bucketOf(r.qualityGrade);
    sum[b] = sum[b].plus(r.initialQty);
    if (r.weightKg != null) {
      totalKg = (totalKg ?? D0()).plus(r.weightKg);
      weighed++;
    }
    return {
      rollId: r.id, barcode: r.barcode, producedQtyM: r.initialQty, qtyM: r.currentQty,
      weightKg: r.weightKg, width: r.width, colorId: r.colorId, colorLabel: r.color?.name ?? null,
      qualityGrade: r.qualityGrade, bucket: BUCKET[b], batchId: r.batchId,
      batchLabel: r.batch?.batchNumber ?? null, status: r.status, foldType: r.foldType,
      itemLabel: r.item?.name ?? null,
    };
  });
  return { lines, sum, totalKg: totalKg as Prisma.Decimal | null, weighed };
}

/**
 * Kapanış anındaki üretim çıktısını dondurur. Çağıran COMPLETED claim'ini AYNI
 * tx'te kazanmış olmalı; elle kapanışta dispozisyonlardan SONRA çağrılır (kapanış
 * dispozisyonuyla depoya inen top da çıktıdır).
 */
export async function freezeCloseSnapshotTx(
  tx: Tx,
  workOrderId: string,
  opts: {
    closeKind: CloseKind;
    ctx: WorkOrderEventCtx;
    /** Yalnız geçmiş doldurma (BACKFILL): kapanış ve başlangıç anı geçmişten verilir. */
    closedAt?: Date;
    startedAt?: Date;
  },
): Promise<{ id: string; version: number }> {
  const read = await readCloseInputsTx(tx, workOrderId);
  const { version, rolls, buckets, input } = read;
  const startedAt = opts.startedAt ?? read.startedAt;
  const { lines, sum, totalKg, weighed } = buildLines(rolls, buckets);
  const outputM = sum.warehouse.plus(sum.a1).plus(sum.fire);
  const inputM = input?.meters ?? D0();
  const closedAt = opts.closedAt ?? new Date();
  return tx.workOrderCloseSnapshot.create({
    data: {
      workOrderId,
      version,
      closeKind: opts.closeKind,
      trigger: opts.ctx.trigger,
      closedById: opts.ctx.userId ?? currentOrigin().userId ?? null,
      rollCount: rolls.length,
      warehouseM: sum.warehouse,
      a1M: sum.a1,
      scrapM: sum.fire,
      outputM,
      totalKg,
      weighedRollCount: weighed,
      inputRollCount: input?.count ?? 0,
      inputM,
      yieldPct: oran(outputM, inputM),
      shrinkagePct: oran(inputM.minus(outputM), inputM),
      scrapPct: oran(sum.fire, inputM),
      startedAt,
      durationSec: Math.max(0, Math.round((closedAt.getTime() - startedAt.getTime()) / 1000)),
      createdAt: closedAt,
      lines: { createMany: { data: lines } },
    },
    select: { id: true, version: true },
  });
}

export interface CloseSnapshotView {
  version: number;
  versionCount: number;
  closedAt: string;
  closeKind: string;
  trigger: string;
  closedBy: { id: string; fullName: string | null; username: string } | null;
  rollCount: number;
  warehouseM: number;
  a1M: number;
  scrapM: number;
  outputM: number;
  totalKg: number | null;
  weighedRollCount: number;
  inputRollCount: number;
  inputM: number;
  yieldPct: number | null;
  shrinkagePct: number | null;
  scrapPct: number | null;
  durationSec: number | null;
  lines: Array<{
    rollId: string;
    barcode: string | null;
    producedQtyM: number;
    qtyM: number;
    weightKg: number | null;
    width: number | null;
    colorLabel: string | null;
    qualityGrade: string | null;
    bucket: string;
    batchLabel: string | null;
    status: string;
  }>;
}

const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

/** Detay ekranının "kapanıştaki" görünümü — en yüksek sürüm; künye yoksa null. */
export async function loadCloseSnapshotView(db: ReadDb, workOrderId: string): Promise<CloseSnapshotView | null> {
  const [snap, versionCount] = [
    await db.workOrderCloseSnapshot.findFirst({
      where: { workOrderId },
      orderBy: { version: "desc" },
      include: { lines: { orderBy: { createdAt: "asc" } } },
    }),
    await db.workOrderCloseSnapshot.count({ where: { workOrderId } }),
  ];
  if (!snap) return null;
  const closedBy = snap.closedById
    ? await db.user.findUnique({ where: { id: snap.closedById }, select: { id: true, fullName: true, username: true } })
    : null;
  return {
    version: snap.version,
    versionCount,
    closedAt: snap.createdAt.toISOString(),
    closeKind: snap.closeKind,
    trigger: snap.trigger,
    closedBy,
    rollCount: snap.rollCount,
    warehouseM: Number(snap.warehouseM),
    a1M: Number(snap.a1M),
    scrapM: Number(snap.scrapM),
    outputM: Number(snap.outputM),
    totalKg: num(snap.totalKg),
    weighedRollCount: snap.weighedRollCount,
    inputRollCount: snap.inputRollCount,
    inputM: Number(snap.inputM),
    yieldPct: num(snap.yieldPct),
    shrinkagePct: num(snap.shrinkagePct),
    scrapPct: num(snap.scrapPct),
    durationSec: snap.durationSec,
    lines: snap.lines.map((l) => ({
      rollId: l.rollId,
      barcode: l.barcode,
      producedQtyM: Number(l.producedQtyM),
      qtyM: Number(l.qtyM),
      weightKg: num(l.weightKg),
      width: num(l.width),
      colorLabel: l.colorLabel,
      qualityGrade: l.qualityGrade,
      bucket: l.bucket,
      batchLabel: l.batchLabel,
      status: l.status,
    })),
  };
}
