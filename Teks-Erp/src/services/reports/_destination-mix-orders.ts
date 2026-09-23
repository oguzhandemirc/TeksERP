// =============================================================================
// YURTİÇİ/YURTDIŞI SATIŞ — SİPARİŞ TARAFI: açık sipariş (backlog) + termin (R2, 2026-09-23)
// =============================================================================
// Sevk öncesinde sevkiyat yoktur ⇒ yön siparişin DOĞUŞTA DONMUŞ yönünden (`Order.destination`,
// `_destination.ts`) okunur; NULL ise "UNSET" (yön belirsiz) — yurtiçi uydurulmaz. Karşılanma yalnız MT satırlarda ölçülür (`order-status.helper`);
// KG/ADET satırlar açık miktara GİRMEZ, sayıları ayrıca döner.
// =============================================================================
import prisma from "../../lib/prisma";
import { Prisma, type Currency } from "@prisma/client";
import type { DateRange } from "./_shared";
import { orderDestinationValueSql } from "./_destination";

export type OrderBucket = "DOMESTIC" | "EXPORT" | "UNSET";

/** Sipariş kökünün yönü kova olarak — zincir `_destination.ts`ten, boşsa "UNSET". */
const ORDER_BUCKET_SQL = Prisma.sql`COALESCE(${orderDestinationValueSql("o")}::text, 'UNSET')`;

export interface BacklogRow {
  bucket: OrderBucket;
  customerId: string;
  customerName: string;
  currency: Currency;
  openQty: number;
  openLines: number;
  overdueQty: number;
  overdueOrders: number;
  pricedOpenQty: number;
  openAmount: number;
  earliestDeadline: Date | null;
  nonMtLines: number;
}

/** Bugün açık siparişlerin kalan miktarı (MT), müşteri × kova × para birimi. */
export async function collectBacklog(now: Date = new Date()): Promise<BacklogRow[]> {
  const rows = await prisma.$queryRaw<Array<Omit<BacklogRow, "openLines" | "overdueOrders" | "nonMtLines"> & { openLines: bigint; overdueOrders: bigint; nonMtLines: bigint }>>(Prisma.sql`
    SELECT ${ORDER_BUCKET_SQL} AS bucket, o."customerId", cu.name AS "customerName", o.currency,
           COALESCE(SUM(ol.quantity - ol."shippedQty") FILTER (WHERE ol.unit = 'MT'), 0)::float AS "openQty",
           COUNT(*) FILTER (WHERE ol.unit = 'MT') AS "openLines",
           COALESCE(SUM(ol.quantity - ol."shippedQty") FILTER (WHERE ol.unit = 'MT' AND o.deadline < ${now}), 0)::float AS "overdueQty",
           COUNT(DISTINCT o.id) FILTER (WHERE o.deadline < ${now}) AS "overdueOrders",
           COALESCE(SUM(ol.quantity - ol."shippedQty") FILTER (WHERE ol.unit = 'MT' AND ol."unitPrice" IS NOT NULL), 0)::float AS "pricedOpenQty",
           COALESCE(SUM((ol.quantity - ol."shippedQty") * ol."unitPrice") FILTER (WHERE ol.unit = 'MT' AND ol."unitPrice" IS NOT NULL), 0)::float AS "openAmount",
           MIN(o.deadline) AS "earliestDeadline",
           COUNT(*) FILTER (WHERE ol.unit <> 'MT') AS "nonMtLines"
    FROM orders o
    JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL AND (ol.unit <> 'MT' OR ol.quantity > ol."shippedQty")
    JOIN customers cu   ON cu.id = o."customerId"
    WHERE o.status IN ('PENDING', 'APPROVED', 'PARTIAL_SHIPPED')
    GROUP BY 1, o."customerId", cu.name, o.currency
  `);
  return rows.map((r) => ({ ...r, openLines: Number(r.openLines), overdueOrders: Number(r.overdueOrders), nonMtLines: Number(r.nonMtLines) }));
}

export interface FulfillmentBucket {
  bucket: OrderBucket;
  /** Termini dönem içinde olan (iptal edilmemiş) sipariş sayısı. */
  orderCount: number;
  onTime: number;
  lateCompleted: number;
  /** Termini geçmiş ve hâlâ kapanmamış. */
  openLate: number;
  avgLateDays: number | null;
  /** Σ sevk / Σ sipariş (MT satırlar) — yüzde. */
  shippedPct: number | null;
}

/** Termini dönemde olan siparişlerin gerçekleşmesi ve termin sapması, kova başına. */
export async function collectFulfillment(range: DateRange, now: Date = new Date()): Promise<FulfillmentBucket[]> {
  const rows = await prisma.$queryRaw<
    Array<{ bucket: OrderBucket; orderCount: bigint; onTime: bigint; lateCompleted: bigint; openLate: bigint; lateDays: number | null; qty: number | null; shipped: number | null }>
  >(Prisma.sql`
    WITH od AS (
      SELECT o.id, ${ORDER_BUCKET_SQL} AS bucket, o.deadline, o."completedAt", o.status
      FROM orders o
      WHERE o.status <> 'CANCELLED' AND o.deadline >= ${range.from} AND o.deadline <= ${range.to}
    ), q AS (
      SELECT ol."orderId", SUM(ol.quantity)::float AS qty, SUM(ol."shippedQty")::float AS shipped
      FROM order_lines ol WHERE ol."cancelledAt" IS NULL AND ol.unit = 'MT' GROUP BY ol."orderId"
    )
    SELECT od.bucket,
           COUNT(*) AS "orderCount",
           COUNT(*) FILTER (WHERE od."completedAt" IS NOT NULL AND od."completedAt" <= od.deadline) AS "onTime",
           COUNT(*) FILTER (WHERE od."completedAt" IS NOT NULL AND od."completedAt" > od.deadline) AS "lateCompleted",
           COUNT(*) FILTER (WHERE od."completedAt" IS NULL AND od.deadline < ${now}) AS "openLate",
           AVG(EXTRACT(EPOCH FROM (od."completedAt" - od.deadline)) / 86400) FILTER (WHERE od."completedAt" > od.deadline)::float AS "lateDays",
           SUM(q.qty)::float AS qty, SUM(q.shipped)::float AS shipped
    FROM od LEFT JOIN q ON q."orderId" = od.id
    GROUP BY od.bucket
  `);
  return rows.map((r) => ({
    bucket: r.bucket,
    orderCount: Number(r.orderCount),
    onTime: Number(r.onTime),
    lateCompleted: Number(r.lateCompleted),
    openLate: Number(r.openLate),
    avgLateDays: r.lateDays == null ? null : Math.round(Number(r.lateDays) * 10) / 10,
    shippedPct: r.qty ? Math.round((Number(r.shipped ?? 0) / Number(r.qty)) * 1000) / 10 : null,
  }));
}
