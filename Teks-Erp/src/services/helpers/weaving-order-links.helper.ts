// =============================================================================
// Z1 (Y1 = PİVOT) — DOKUMA İŞİ ↔ SİPARİŞ SATIRI bağları: doğrulama · replace · DTO (2026-09-18)
// =============================================================================
// `WeavingOrderToOrderLine` ③b SAF YAPILANDIRMA pivotudur (parasal/ticari/kalite sonucu yok): gövde
// `orderLines` verildiğinde küme REPLACE edilir (`[]` bağları temizler, alan yoksa dokunulmaz) ve değişiklik
// audit oldData/newData'sında bağ listesi olarak yazılır. Her bağ OPSİYONEL; zorunluluk kapısı
// `assertOrderLineLinkGate` (production-chain-gates). Satır seçici ucu AYRI DEĞİL: `GET /api/orders/order-lines/available`.
// =============================================================================
import { Prisma } from "@prisma/client";
import type prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

export const ORDER_LINE_LINK_SELECT = {
  id: true,
  orderLineId: true,
  allocatedM: true,
  orderLine: {
    select: {
      id: true,
      quantity: true,
      shippedQty: true,
      unit: true,
      cancelledAt: true,
      order: { select: { id: true, orderNumber: true, customer: { select: { id: true, name: true } } } },
      item: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.WeavingOrderToOrderLineSelect;

export type OrderLineLinkRow = Prisma.WeavingOrderToOrderLineGetPayload<{ select: typeof ORDER_LINE_LINK_SELECT }>;

export interface WeavingOrderLineLinkDto {
  id: string;
  orderLineId: string;
  allocatedM: number | null;
  orderLine: {
    id: string;
    quantity: number;
    shippedQty: number;
    unit: string;
    cancelledAt: Date | null;
    order: { id: string; orderNumber: string; customer: { id: string; name: string } };
    item: { id: string; code: string; name: string };
  };
}

export interface OrderLineLinkInput {
  orderLineId: string;
  allocatedM?: number | string | null;
}

export interface NormalizedOrderLineLink {
  orderLineId: string;
  allocatedM: Prisma.Decimal | null;
}

export function toOrderLineLinkDto(r: OrderLineLinkRow): WeavingOrderLineLinkDto {
  return {
    id: r.id,
    orderLineId: r.orderLineId,
    allocatedM: r.allocatedM == null ? null : Number(r.allocatedM),
    orderLine: {
      id: r.orderLine.id,
      quantity: Number(r.orderLine.quantity),
      shippedQty: Number(r.orderLine.shippedQty),
      unit: r.orderLine.unit,
      cancelledAt: r.orderLine.cancelledAt,
      order: r.orderLine.order,
      item: r.orderLine.item,
    },
  };
}

/** Gövde → normalize: aynı satır iki kez → 400; `allocatedM` boş/null serbest, verilirse ≥ 0 sayı. */
export function normalizeOrderLineLinks(input: OrderLineLinkInput[]): NormalizedOrderLineLink[] {
  const seen = new Set<string>();
  return input.map((l) => {
    if (seen.has(l.orderLineId)) throw AppError.badRequest("Aynı sipariş satırı iki kez bağlanamaz.");
    seen.add(l.orderLineId);
    let allocatedM: Prisma.Decimal | null = null;
    if (l.allocatedM !== undefined && l.allocatedM !== null && l.allocatedM !== "") {
      const d = new Prisma.Decimal(l.allocatedM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
      if (!d.isFinite() || d.lt(0)) throw AppError.badRequest("Sipariş satırı için planlanan metre sıfırdan küçük olamaz.");
      allocatedM = d;
    }
    return { orderLineId: l.orderLineId, allocatedM };
  });
}

/** Satırlar var ve iptal edilmemiş mi — FK 500'ü yerine operatör dilinde 400 (`details.code`). */
export async function assertOrderLinesLinkableTx(db: Db, links: NormalizedOrderLineLink[]): Promise<void> {
  if (links.length === 0) return;
  const ids = links.map((l) => l.orderLineId);
  const rows = await db.orderLine.findMany({ where: { id: { in: ids } }, select: { id: true, cancelledAt: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) throw AppError.badRequest("Sipariş satırı bulunamadı.", { code: "ORDER_LINE_NOT_FOUND", orderLineId: id });
    if (r.cancelledAt) throw AppError.badRequest("İptal edilmiş sipariş satırına dokuma işi bağlanamaz.", { code: "ORDER_LINE_CANCELLED", orderLineId: id });
  }
}

/** Audit görünümü — bağ listesi (kimlik + planlanan metre); sıralı ki iki görünüm karşılaştırılabilsin. */
export function orderLineLinksAuditView(rows: Array<{ orderLineId: string; allocatedM: Prisma.Decimal | null }>): Array<{ orderLineId: string; allocatedM: number | null }> {
  return [...rows]
    .sort((a, b) => a.orderLineId.localeCompare(b.orderLineId))
    .map((r) => ({ orderLineId: r.orderLineId, allocatedM: r.allocatedM == null ? null : Number(r.allocatedM) }));
}
