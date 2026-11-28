// =============================================================================
// TEZGÂHIN TAKILI TAHARI (T2/T3, Seyitoğlu 2026-11-28) — TEK YAZAR + uyum okumaları
// =============================================================================
// `Machine.mountedDrawingIn*` "şu an ne"dir (defter değil; satırı silinince raporlanan sayı değişmez) — iz audit.
// OTOMATİK: levent takma (DRAWING_IN/HARNESS_CHANGE) ya da koşum açılışı, kumaşın tahar planı varsa; özet aynıysa
// dokunmaz (aynı fiziksel tahar). ELLE: tezgâh tanımındaki düzeltme. Genel CRUD gövdesinde kolonlar kapalı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { LOOM_MACHINE_WHERE } from "../../constants/loom-shift";
import type { MountedDrawingInSource } from "../../constants/drawing-in-plan";

type Db = Prisma.TransactionClient | typeof prisma;

export interface DrawingInMountChange {
  machineId: string;
  fromPlanId: string | null;
  toPlanId: string | null;
  source: MountedDrawingInSource;
  reason: string;
  /** Otomatik yazımda: eski kaynak ve makineye yazılan an — ileri satıra geri yükleme girdisi olarak gider. */
  fromSource?: string | null;
  setAt?: Date;
}

/** İleri satırın (MOUNTED olayı / koşum) geri yükleme kolonları; değişim yoksa hepsi null. */
export function drawingInRestoreColumns(change: DrawingInMountChange | null) {
  return {
    drawingInPrevPlanId: change?.fromPlanId ?? null,
    drawingInPrevSource: change?.fromSource ?? null,
    drawingInSetAt: change?.setAt ?? null,
  };
}

const PLAN_BRIEF = { id: true, code: true, name: true, frameCount: true, notation: true, threadingKey: true, isActive: true } as const;
/** Listelerde kalabalığa karşı tavan (bir taharı paylaşan kumaş/tezgâh sayısı pratikte küçük). */
const FIT_LIST_MAX = 200;

/**
 * Kumaşın tahar planı varsa tezgâhın takılı taharını ona çeker (aynı tx). Plan yok / özet aynı → null (dokunmaz).
 * Çağıran: levent takma (yalnız DRAWING_IN/HARNESS_CHANGE) ve koşum açılışı. Audit `logDrawingInMountAudit` tx DIŞINDA.
 */
export async function autoMountDrawingInTx(
  tx: Prisma.TransactionClient,
  input: { machineId: string; itemId: string | null | undefined; userId?: string | null; reason: string },
): Promise<DrawingInMountChange | null> {
  if (!input.itemId) return null;
  const item = await tx.item.findUnique({ where: { id: input.itemId }, select: { drawingInPlan: { select: { id: true, threadingKey: true } } } });
  const plan = item?.drawingInPlan;
  if (!plan) return null;
  const machine = await tx.machine.findUnique({ where: { id: input.machineId }, select: { mountedDrawingInPlanId: true, mountedDrawingInSource: true, mountedDrawingInPlan: { select: { threadingKey: true } } } });
  if (!machine) return null;
  if (machine.mountedDrawingInPlanId === plan.id || machine.mountedDrawingInPlan?.threadingKey === plan.threadingKey) return null;
  // Yazılan an geri almanın claim anahtarıdır (ms hassasiyetinde JS Date — DB'den okununca birebir eşit).
  const setAt = new Date();
  await tx.machine.update({
    where: { id: input.machineId },
    data: { mountedDrawingInPlanId: plan.id, mountedDrawingInSource: "AUTO", mountedDrawingInAt: setAt, mountedDrawingInById: input.userId ?? null },
    select: { id: true },
  });
  return { machineId: input.machineId, fromPlanId: machine.mountedDrawingInPlanId, toPlanId: plan.id, source: "AUTO", reason: input.reason, fromSource: machine.mountedDrawingInSource, setAt };
}

/**
 * Levent takma / koşum geri alındığında taharı geri yükler (aynı tx). Makine hâlâ O yazımdaysa (AUTO + aynı an)
 * eski plan/kaynak döner; arada elle düzeltme ya da başka otomatik değişim olduysa dokunulmaz (claim 0 → null).
 */
export async function revertDrawingInMountTx(
  tx: Prisma.TransactionClient,
  input: { machineId: string | null; prevPlanId: string | null; prevSource: string | null; setAt: Date | null; userId?: string | null; reason: string },
): Promise<DrawingInMountChange | null> {
  if (!input.machineId || !input.setAt) return null;
  const current = await tx.machine.findUnique({ where: { id: input.machineId }, select: { mountedDrawingInPlanId: true } });
  if (!current) return null;
  const restored = input.prevPlanId !== null;
  const claim = await tx.machine.updateMany({
    where: { id: input.machineId, mountedDrawingInSource: "AUTO", mountedDrawingInAt: input.setAt, mountedDrawingInPlanId: current.mountedDrawingInPlanId },
    data: {
      mountedDrawingInPlanId: input.prevPlanId,
      mountedDrawingInSource: input.prevSource,
      mountedDrawingInAt: restored ? new Date() : null,
      mountedDrawingInById: restored ? (input.userId ?? null) : null,
    },
  });
  if (claim.count === 0) return null;
  return { machineId: input.machineId, fromPlanId: current.mountedDrawingInPlanId, toPlanId: input.prevPlanId, source: (input.prevSource ?? "AUTO") as MountedDrawingInSource, reason: input.reason };
}

/** Değişim izi (best-effort, tx dışında). */
export async function logDrawingInMountAudit(change: DrawingInMountChange | null, userId?: string | null): Promise<void> {
  if (!change) return;
  await AuditService.log({
    userId: userId ?? undefined,
    action: "UPDATE",
    tableName: "MACHINE",
    recordId: change.machineId,
    oldData: { mountedDrawingInPlanId: change.fromPlanId },
    newData: { mountedDrawingInPlanId: change.toPlanId, mountedDrawingInSource: change.source, reason: change.reason },
  });
}

/** Tezgâh tanımında elle düzeltme (null = kaldır). Aynı plan → değişiklik yok (iz yazılmaz). */
export async function setMountedDrawingInManual(machineId: string, planId: string | null, userId?: string): Promise<{ changed: boolean; warnings: string[] }> {
  const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, code: true, frameCount: true, mountedDrawingInPlanId: true } });
  if (!machine) throw AppError.notFound("Makine bulunamadı");
  const warnings: string[] = [];
  if (planId) {
    const plan = await prisma.drawingInPlan.findUnique({ where: { id: planId }, select: PLAN_BRIEF });
    if (!plan || !plan.isActive) throw AppError.badRequest("Tahar planı bulunamadı ya da pasif", { code: "DRAWING_IN_PLAN_NOT_FOUND" });
    if (machine.frameCount != null && plan.frameCount > machine.frameCount) {
      warnings.push(`${plan.code} ${plan.frameCount} çerçeve ister; ${machine.code} tezgâhında ${machine.frameCount} çerçeve var.`);
    }
  }
  if (machine.mountedDrawingInPlanId === planId) return { changed: false, warnings };
  await prisma.machine.update({
    where: { id: machineId },
    data: { mountedDrawingInPlanId: planId, mountedDrawingInSource: "MANUAL", mountedDrawingInAt: new Date(), mountedDrawingInById: userId ?? null },
    select: { id: true },
  });
  await logDrawingInMountAudit({ machineId, fromPlanId: machine.mountedDrawingInPlanId, toPlanId: planId, source: "MANUAL", reason: "tezgâh tanımında düzeltme" }, userId);
  return { changed: true, warnings };
}

/** Tezgâh kartı: takılı tahar + "tahar değiştirmeden girebilen kumaşlar" (aynı özet, arşivlenmemiş). */
export async function readMachineDrawingInFit(machineId: string, db: Db = prisma) {
  const machine = await db.machine.findUnique({
    where: { id: machineId },
    select: {
      id: true, code: true, name: true, frameCount: true, mountedDrawingInSource: true, mountedDrawingInAt: true,
      mountedDrawingInPlan: { select: PLAN_BRIEF }, mountedDrawingInBy: { select: { id: true, fullName: true } },
    },
  });
  if (!machine) throw AppError.notFound("Makine bulunamadı");
  const key = machine.mountedDrawingInPlan?.threadingKey ?? null;
  const items = key
    ? await db.item.findMany({
        where: { lifecycleStatus: { not: "ARCHIVED" }, drawingInPlan: { threadingKey: key } },
        select: { id: true, code: true, name: true, drawingInPlan: { select: { id: true, code: true } } },
        orderBy: { code: "asc" },
        take: FIT_LIST_MAX,
      })
    : [];
  return { machine, items: items.map((i) => ({ id: i.id, code: i.code, name: i.name, planId: i.drawingInPlan?.id ?? null, planCode: i.drawingInPlan?.code ?? null })) };
}

/** Ürün kartı: bu taharın (aynı özet) şu an takılı olduğu aktif dokuma tezgâhları. */
export async function readMachinesForDrawingInPlan(planId: string, db: Db = prisma) {
  const plan = await db.drawingInPlan.findUnique({ where: { id: planId }, select: PLAN_BRIEF });
  if (!plan) throw AppError.notFound("Tahar planı bulunamadı");
  const machines = await db.machine.findMany({
    where: { ...LOOM_MACHINE_WHERE, mountedDrawingInPlan: { threadingKey: plan.threadingKey } },
    select: { id: true, code: true, name: true, frameCount: true, mountedDrawingInSource: true, mountedDrawingInAt: true, mountedDrawingInPlan: { select: { id: true, code: true } } },
    orderBy: { code: "asc" },
    take: FIT_LIST_MAX,
  });
  return {
    plan: { id: plan.id, code: plan.code, name: plan.name, frameCount: plan.frameCount },
    machines: machines.map((m) => ({
      id: m.id, code: m.code, name: m.name, frameCount: m.frameCount, source: m.mountedDrawingInSource, mountedAt: m.mountedDrawingInAt,
      planId: m.mountedDrawingInPlan?.id ?? null, planCode: m.mountedDrawingInPlan?.code ?? null,
    })),
  };
}
