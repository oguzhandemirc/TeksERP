// =============================================================================
// İŞ EMRİ METRESİNİN SİPARİŞ BAĞLARINA PAYLAŞTIRILMASI — TEK KAYNAK (2026-11-19)
// =============================================================================
// Paylaştırma yalnız PLANDIR: açık bağ satırının `allocatedQty` kolonunda durur.
// Top↔sipariş bağı YARATMAZ; `SackAllocation`, `OrderLine.shippedQty`, kapsama
// (`coverage.helper`) ve patron bulutu bundan OKUMAZ.
//
//   • Tavan = iş emrine giren ham metre (`computeWoInput`); top yoksa `targetQuantity`;
//     ikisi de yoksa tavan yok. Σ açık bağ `allocatedQty` > tavan → 400 ALLOCATION_OVER_BASIS.
//   • Satırın açığını (miktar − sevk) aşmak ENGEL DEĞİL, uyarıdır.
//   • MT dışı satıra > 0 metre → 400 ALLOCATION_UNIT_NOT_MEASURED.
//   • Yalnız AÇIK bağa yazılır: bağlı olmayan 400 ORDER_LINK_NOT_ACTIVE, yazım anında
//     koparılmışsa 409 ORDER_LINK_CHANGED; CANCELLED/SUPERSEDED 409 WO_PLAN_FROZEN.
// Burada yalnız okuma + doğrulama; `allocatedQty` YAZIMI audit'i basan
// `workorder-allocation.service`te (tx İLK ifadesi `touchWorkOrderTx`, WO satır kilidi).
// =============================================================================

import { TERIM } from "../../constants/terim";
import { Prisma, type ItemUnit } from "@prisma/client";
import type prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ORDER_ALLOCATION_EVENT_FIELD } from "../../constants/workorder-event-labels";
import { computeWoInput } from "./coverage.helper";
import { ACTIVE_ORDER_LINK, ORDER_LINK_FROZEN_STATUSES } from "./order-link.helper";
import { isMeasuredLine } from "./order-line-scope.helper";
import { qtyText } from "./qty-text.helper";
import { WO_PLAN_FROZEN_CODE } from "./workorder-target-color.helper";
import { recordWorkOrderFieldChangesTx, type WorkOrderEventCtx } from "./workorder-event.helper";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const ALLOCATION_OVER_BASIS_CODE = "ALLOCATION_OVER_BASIS";
export const ALLOCATION_UNIT_NOT_MEASURED_CODE = "ALLOCATION_UNIT_NOT_MEASURED";
export const ORDER_LINK_NOT_ACTIVE_CODE = "ORDER_LINK_NOT_ACTIVE";
export const ORDER_LINK_CHANGED_CODE = "ORDER_LINK_CHANGED";
export const ORDER_ALLOCATION_FIELD = ORDER_ALLOCATION_EVENT_FIELD;
export const ORDER_ALLOCATION_TRIGGER = "ORDER_ALLOCATION";

/** INPUT = giren ham metre · TARGET = hedef metre (top yok) · NONE = tavan yok. */
export type AllocationBasisKind = "INPUT" | "TARGET" | "NONE";

export interface AllocationSummary {
  basis: number | null;
  basisKind: AllocationBasisKind;
  /** Σ açık bağ `allocatedQty`. */
  allocated: number;
  /** basis − allocated (tavan yoksa null). Tavan sonradan düştüyse negatif olabilir. */
  remaining: number | null;
}

export interface AllocationEntry {
  orderLineId: string;
  allocatedQty: number;
}

export interface AllocationChange {
  orderLineId: string;
  orderNumber: string;
  from: number;
  to: number;
}

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const m = (d: Prisma.Decimal.Value): string => `${qtyText(d)} m`;

/** Paylaştırma tavanı — tek tanım. */
export async function readAllocationBasis(
  db: Db,
  workOrderId: string,
): Promise<{ basis: Prisma.Decimal | null; basisKind: AllocationBasisKind }> {
  const input = (await computeWoInput(db, [workOrderId])).get(workOrderId);
  if (input && input.count > 0) return { basis: D(input.meters), basisKind: "INPUT" };
  const wo = await db.workOrder.findUnique({ where: { id: workOrderId }, select: { targetQuantity: true } });
  if (wo?.targetQuantity != null && D(wo.targetQuantity).gt(0)) {
    return { basis: D(wo.targetQuantity), basisKind: "TARGET" };
  }
  return { basis: null, basisKind: "NONE" };
}

async function sumAllocated(db: Db, workOrderId: string): Promise<Prisma.Decimal> {
  const agg = await db.workOrderToOrderLine.aggregate({
    where: { workOrderId, ...ACTIVE_ORDER_LINK },
    _sum: { allocatedQty: true },
  });
  return D(agg._sum.allocatedQty ?? 0);
}

function toSummary(
  basis: Prisma.Decimal | null,
  basisKind: AllocationBasisKind,
  allocated: Prisma.Decimal,
): AllocationSummary {
  return {
    basis: basis ? Number(basis) : null,
    basisKind,
    allocated: Number(allocated),
    remaining: basis ? Number(basis.minus(allocated)) : null,
  };
}

/** Okuma yüzü (detay) — sunucu hesaplar, istemci toplamaz. */
export async function summarizeAllocation(db: Db, workOrderId: string): Promise<AllocationSummary> {
  const { basis, basisKind } = await readAllocationBasis(db, workOrderId);
  return toSummary(basis, basisKind, await sumAllocated(db, workOrderId));
}

/** Tavan aşımı → 400; tx içinde çağrılır, fırlatınca yazım geri alınır. */
export async function assertAllocationWithinBasisTx(tx: Tx, workOrderId: string): Promise<AllocationSummary> {
  const { basis, basisKind } = await readAllocationBasis(tx, workOrderId);
  const allocated = await sumAllocated(tx, workOrderId);
  if (basis && allocated.gt(basis)) {
    const label = basisKind === "INPUT" ? `${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} giren metre` : `${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} hedef metresi`;
    throw AppError.badRequest(
      `Paylaştırılan toplam ${m(allocated)}, ${label}: ${m(basis)} — ${m(allocated.minus(basis))} fazla. ` +
        "Siparişlere en fazla bu metre kadar paylaştırabilirsiniz.",
      {
        code: ALLOCATION_OVER_BASIS_CODE,
        basis: Number(basis),
        basisKind,
        allocated: Number(allocated),
        remaining: Number(basis.minus(allocated)),
      },
    );
  }
  return toSummary(basis, basisKind, allocated);
}

export interface AllocatableLink {
  id: string;
  orderLineId: string;
  allocatedQty: Prisma.Decimal;
  orderLine: {
    unit: ItemUnit | null;
    quantity: Prisma.Decimal;
    shippedQty: Prisma.Decimal;
    order: { orderNumber: string };
  };
}

/** Planı donmuş iş emri (CANCELLED/SUPERSEDED) → 409; yoksa 404. */
async function assertWorkOrderAllocatableTx(tx: Tx, workOrderId: string): Promise<void> {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { workOrderNumber: true, status: true },
  });
  if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.tekil} bulunamadı`);
  if (ORDER_LINK_FROZEN_STATUSES.includes(wo.status)) {
    throw AppError.conflict(
      `${wo.workOrderNumber} iptal edilmiş/devredilmiş durumda — sipariş paylaştırması değiştirilemez.`,
      { code: WO_PLAN_FROZEN_CODE, status: wo.status },
    );
  }
}

/**
 * Yazım öncesi kapı: iş emri donmuş değil, satır tekrarı yok, her satır AÇIK bağ.
 * Dönen harita satır → bağ; yazım çağıranın (servis) işidir.
 */
export async function loadAllocatableLinksTx(
  tx: Tx,
  workOrderId: string,
  entries: AllocationEntry[],
): Promise<Map<string, AllocatableLink>> {
  await assertWorkOrderAllocatableTx(tx, workOrderId);
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.orderLineId)) throw AppError.badRequest("Aynı sipariş satırı iki kez gönderildi.");
    seen.add(e.orderLineId);
  }
  const links = await tx.workOrderToOrderLine.findMany({
    where: { workOrderId, orderLineId: { in: [...seen] }, ...ACTIVE_ORDER_LINK },
    select: {
      id: true,
      orderLineId: true,
      allocatedQty: true,
      orderLine: { select: { unit: true, quantity: true, shippedQty: true, order: { select: { orderNumber: true } } } },
    },
  });
  const byLine = new Map(links.map((l) => [l.orderLineId, l]));
  const missing = entries.filter((e) => !byLine.has(e.orderLineId));
  if (missing.length > 0) {
    throw AppError.badRequest(
      `${missing.length} sipariş satırı bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlı değil — ekranı yenileyip tekrar deneyin.`,
      { code: ORDER_LINK_NOT_ACTIVE_CODE, orderLineIds: missing.map((x) => x.orderLineId) },
    );
  }
  return byLine;
}

/**
 * Tek satırın hedef miktarı: MT dışı satıra > 0 → 400; satırın açığını aşmak yalnız uyarı.
 * `changed` false ise yazım gerekmez.
 */
export function planAllocationEntry(
  link: AllocatableLink,
  allocatedQty: number,
): { to: Prisma.Decimal; from: Prisma.Decimal; changed: boolean; warning: string | null } {
  const to = D(allocatedQty).toDecimalPlaces(3);
  const orderNumber = link.orderLine.order.orderNumber;
  const measured = isMeasuredLine(link.orderLine);
  if (to.gt(0) && !measured) {
    throw AppError.badRequest(
      `${orderNumber}: metre dışı birimli sipariş satırına metre paylaştırılamaz (${link.orderLine.unit}).`,
      { code: ALLOCATION_UNIT_NOT_MEASURED_CODE, orderLineId: link.orderLineId },
    );
  }
  let warning: string | null = null;
  if (measured) {
    const open = Prisma.Decimal.max(0, D(link.orderLine.quantity).minus(link.orderLine.shippedQty));
    if (to.gt(open)) warning = `${orderNumber}: paylaştırılan ${m(to)}, siparişin açığı ${m(open)}.`;
  }
  const from = D(link.allocatedQty);
  return { to, from, changed: !from.equals(to), warning };
}

/** Yazım anında koparılmış bağ → 409 (çağıranın `updateMany` count===0 kolu). */
export function orderLinkChangedError(orderNumber: string): AppError {
  return AppError.conflict(`${orderNumber} bağı bu sırada koparıldı — ekranı yenileyin.`, {
    code: ORDER_LINK_CHANGED_CODE,
  });
}

/** Değişen satırları iş emri hareket defterine FIELD_CHANGED `orderAllocation` olarak düşer. */
export async function recordAllocationChangesTx(
  tx: Tx,
  workOrderId: string,
  changes: AllocationChange[],
  ctx: WorkOrderEventCtx,
): Promise<void> {
  if (changes.length === 0) return;
  await recordWorkOrderFieldChangesTx(
    tx,
    workOrderId,
    changes.map((c) => ({
      field: ORDER_ALLOCATION_FIELD,
      from: String(c.from),
      to: String(c.to),
      fromLabel: `${c.orderNumber}: ${m(c.from)}`,
      toLabel: `${c.orderNumber}: ${m(c.to)}`,
    })),
    ctx,
  );
}
