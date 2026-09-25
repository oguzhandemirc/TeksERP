// =============================================================================
// DOKUMA İŞİ — referans/claim/koşum kapıları (servisten ayrıldı, 2026-09-18 Z1; davranış aynen)
// =============================================================================
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { OPEN_RUN_WHERE, WEAVING_ORDER_STATUS_LABEL } from "./weaving-order-input.helper";import { assertItemUsable, type ItemUsage } from "./item-usage.helper";


/** Referansların varlığı ve türü — FK 500'ü yerine operatör dilinde 400. */
export async function assertRefs(
  f: {
    itemId: string;
    colorId: string | null;
    warpSpecId: string | null;
    subcontractorId: string | null;
  },
  /** Kart kullanımı: yeni dokuma işi A3 (NEW_PLAN); kartı değişmeyen güncellemede `null` (kontrol yok). */
  itemUsage: ItemUsage | null = "NEW_PLAN",
): Promise<void> {
  const item = await prisma.item.findUnique({ where: { id: f.itemId }, select: { itemType: true } });
  if (!item) throw AppError.badRequest("Kumaş kartı bulunamadı");
  if (item.itemType !== ItemType.FABRIC) throw AppError.badRequest("Dokuma işi yalnız KUMAŞ kartına açılır");
  if (itemUsage) await assertItemUsable(prisma, f.itemId, itemUsage);
  if (f.colorId) {
    const n = await prisma.color.count({ where: { id: f.colorId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Renk bulunamadı ya da pasif");
  }
  if (f.warpSpecId) {
    const n = await prisma.warpSpec.count({ where: { id: f.warpSpecId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Çözgü kartı bulunamadı ya da pasif");
  }
  if (f.subcontractorId) {
    const n = await prisma.subcontractor.count({ where: { id: f.subcontractorId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Fasoncu bulunamadı ya da pasif");
  }
}

/** Açık koşumları ADIYLA döner — 409 yükü `{code, machines[], runIds[]}`. */
export async function assertNoOpenRunsTx(tx: Prisma.TransactionClient, weavingOrderId: string, eylem: string): Promise<void> {
  const open = await tx.machineRun.findMany({
    where: { weavingOrderId, ...OPEN_RUN_WHERE },
    select: { id: true, productionLineNo: true, machine: { select: { code: true, name: true } } },
    orderBy: { startedAt: "asc" },
  });
  if (open.length === 0) return;
  const machines = open.map((r) => ({
    runId: r.id,
    machineCode: r.machine.code,
    machineName: r.machine.name,
    productionLineNo: r.productionLineNo,
  }));
  const adlar = [...new Set(machines.map((m) => m.machineName))].join(", ");
  throw AppError.conflict(
    `Açık koşum varken dokuma işi ${eylem} — önce koşumları kapatın: ${adlar}`,
    { code: "WEAVING_ORDER_HAS_OPEN_RUNS", machines, runIds: open.map((r) => r.id) },
  );
}

/** Claim düştü → taze oku: yok → 404, var → 409 (durum adıyla). */
export async function throwClaimFailureTx(tx: Prisma.TransactionClient, id: string, eylem: string, code: string): Promise<never> {
  const fresh = await tx.weavingOrder.findUnique({ where: { id }, select: { status: true, weavingOrderNumber: true } });
  if (!fresh) throw AppError.notFound("Dokuma işi bulunamadı");
  throw AppError.conflict(
    `${fresh.weavingOrderNumber} ${WEAVING_ORDER_STATUS_LABEL[fresh.status]} — ${eylem}`,
    { code, status: fresh.status },
  );
}

// ── Okuma ──────────────────────────────────────────────────────────────────

