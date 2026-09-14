// =============================================================================
// KOŞUM AÇILIŞI — tx ÖNCESİ doğrulamalar (saf yardımcılar, [BE-12])
// =============================================================================
// Makine · hat · dokuma işi · desen/renk · zaman damgası · hat doluluğu.
// Burada DB'ye YAZILMAZ; yarışın arkası sedde ve `machine-run.service.ts`teki
// claim'lerde kapalıdır. Precheck'ler operatöre OKUNABİLİR 409 üretir, sed
// ise `MACHINE_RUN_RACE` — iki kod ayrı sorudur ve ayrımı bekçi ölçer.
// =============================================================================
import { WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertProductionLineValid } from "./production-line.helper";
import { resolveEntryStamp } from "./duplicate-guard.helper";

/** Koşumun açılabildiği dokuma işi durumları — kapanmış/iptal işe koşum açılmaz. */
export const RUN_OPENABLE_ORDER_STATUSES: readonly WeavingOrderStatus[] = [
  WeavingOrderStatus.PLANNED,
  WeavingOrderStatus.IN_PROGRESS,
];

export interface StampResolution {
  value: Date;
  warning: string | null;
}

/**
 * Beyan edilen anı makul aralıkta kabul eder, dışındaysa sunucu saatine düşer.
 * 400 DEĞİL: bozuk RTC'li tablet üretimi durdurmamalı; düşüş `warnings` ile söylenir.
 */
export function resolveRunStamp(declared: Date | null | undefined, label: string): StampResolution {
  const now = new Date();
  if (!declared) return { value: now, warning: null };
  const { storedEnteredAt } = resolveEntryStamp(declared, now);
  if (storedEnteredAt) return { value: storedEnteredAt, warning: null };
  return {
    value: now,
    warning: `Beyan edilen ${label} makul aralık dışında (${declared.toISOString()}); sunucu saati kullanıldı.`,
  };
}

export interface OpenContext {
  machine: { id: string; code: string };
  itemId: string | null;
  colorId: string | null;
}

/**
 * Makineyi ve hattı doğrular; dokuma işi verildiyse durum/icra kapısından
 * geçirir ve desen/rengi işten ön-doldurur (kilitli değil).
 */
export async function resolveOpenContext(input: {
  machineId: string;
  productionLineNo: number;
  weavingOrderId?: string | null;
  itemId?: string | null;
  colorId?: string | null;
}): Promise<OpenContext> {
  const machine = await prisma.machine.findFirst({
    where: { id: input.machineId, isActive: true },
    select: { id: true, code: true, productionLineCount: true },
  });
  if (!machine) throw AppError.badRequest("Makine bulunamadı veya pasif", { machineId: input.machineId });
  // Hat numarası makinenin hat sayısını aşamaz — satırlar arası CHECK PG'de yok,
  // üst sınır bu yüklemin işi (`production-line.helper` başlığı).
  assertProductionLineValid(input.productionLineNo, machine.productionLineCount);

  let itemId = input.itemId ?? null;
  let colorId = input.colorId ?? null;
  if (input.weavingOrderId) {
    const order = await prisma.weavingOrder.findUnique({
      where: { id: input.weavingOrderId },
      select: { id: true, weavingOrderNumber: true, status: true, executionKind: true, itemId: true, colorId: true },
    });
    if (!order) throw AppError.notFound("Dokuma işi bulunamadı", { weavingOrderId: input.weavingOrderId });
    if (order.executionKind === WeavingExecutionKind.SUBCONTRACTED) {
      throw AppError.badRequest(
        `Dokuma işi ${order.weavingOrderNumber} fasona verilmiş — fason dokumanın koşumu bizde tutulmaz.`,
        { code: "WEAVING_ORDER_SUBCONTRACTED", weavingOrderId: order.id },
      );
    }
    if (!RUN_OPENABLE_ORDER_STATUSES.includes(order.status)) {
      throw AppError.conflict(
        `Dokuma işi ${order.weavingOrderNumber} ${order.status === "CANCELLED" ? "iptal edilmiş" : "kapatılmış"} — koşum açılamaz.`,
        { code: "WEAVING_ORDER_NOT_OPEN", weavingOrderId: order.id, status: order.status },
      );
    }
    itemId = itemId ?? order.itemId;
    colorId = colorId ?? order.colorId;
  }
  if (itemId) {
    const item = await prisma.item.findFirst({ where: { id: itemId, isActive: true }, select: { id: true } });
    if (!item) throw AppError.badRequest("Ürün bulunamadı veya pasif", { itemId });
  }
  if (colorId) {
    const color = await prisma.color.findFirst({ where: { id: colorId, isActive: true }, select: { id: true } });
    if (!color) throw AppError.badRequest("Renk bulunamadı veya pasif", { colorId });
  }
  return { machine: { id: machine.id, code: machine.code }, itemId, colorId };
}

/**
 * Hat boş mu — açık koşum 409 `PRODUCTION_LINE_OCCUPIED` (kim koşuyor), beyan
 * edilen başlangıçtan SONRA bitmiş koşum 409 `PRODUCTION_LINE_OVERLAP`
 * (randımanın paydası çift sayılmasın; exclusion seddi yok, uygulama kontrolü).
 */
/** AÇIK koşum yüklemi — TEK KAYNAK (partial unique `machine_runs_one_open_per_prod_line_uq` ile aynı); levent söküm kapısı da bunu okur. */
export const OPEN_MACHINE_RUN_WHERE = { endedAt: null, revokedAt: null } as const;

export async function assertProductionLineFree(
  machine: { id: string; code: string },
  productionLineNo: number,
  startedAt: Date,
): Promise<void> {
  const occupant = await prisma.machineRun.findFirst({
    where: { machineId: machine.id, productionLineNo, ...OPEN_MACHINE_RUN_WHERE },
    select: { id: true, startedAt: true },
  });
  if (occupant) {
    throw AppError.conflict(
      `${machine.code} makinesinin ${productionLineNo}. hattında açık bir koşum var — önce onu kapatın.`,
      { code: "PRODUCTION_LINE_OCCUPIED", openRunId: occupant.id, startedAt: occupant.startedAt },
    );
  }
  const overlap = await prisma.machineRun.findFirst({
    where: { machineId: machine.id, productionLineNo, revokedAt: null, endedAt: { gt: startedAt } },
    select: { id: true, endedAt: true },
  });
  if (overlap) {
    throw AppError.conflict(
      `Beyan edilen başlangıç, aynı hattaki önceki koşumun bitişinden (${overlap.endedAt?.toISOString()}) önce — koşumlar örtüşemez.`,
      { code: "PRODUCTION_LINE_OVERLAP", overlapRunId: overlap.id, endedAt: overlap.endedAt },
    );
  }
}
