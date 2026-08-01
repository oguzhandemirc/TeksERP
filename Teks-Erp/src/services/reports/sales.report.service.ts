// =============================================================================
// TeksERP - Sales Reports
// =============================================================================
// 2 alt-rapor: sipariş gerçekleşme, geç teslimat.
// Sevkiyat raporu yeniden yazılana kadar kaldırıldı.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";

// ---------- 1) Order Fulfillment ---------------------------------------------

export interface OrderFulfillmentSummary {
  totalOrders: number;
  totalPlannedQty: number;
  totalShippedQty: number;
  byStatus: { status: string; count: number; plannedQty: number; shippedQty: number }[];
  worstFulfillment: {
    orderId: string;
    orderNumber: string;
    customerName: string;
    status: string;
    plannedQty: number;
    shippedQty: number;
    fulfillmentPct: number;
    deadline: Date | null;
  }[];
}

export async function getOrderFulfillment(range: DateRange): Promise<OrderFulfillmentSummary> {
  // Status kırılımı + toplam — sipariş seviyesinde aggregate
  const statusRows = await prisma.$queryRaw<
    Array<{ status: string; count: bigint; plannedQty: number | null; shippedQty: number | null }>
  >(Prisma.sql`
    SELECT
      o.status::text                                 AS status,
      COUNT(*)                                       AS count,
      SUM(lines.total_qty)::float                    AS "plannedQty",
      SUM(o."shippedQty")::float                     AS "shippedQty"
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ol.quantity), 0) AS total_qty
      FROM order_lines ol
      WHERE ol."orderId" = o.id
    ) lines ON true
    WHERE o."createdAt" >= ${range.from} AND o."createdAt" <= ${range.to}
    GROUP BY o.status
    ORDER BY o.status
  `);

  // Hedefe en uzak siparişler — gerçekleşme yüzdesi tabanında
  const worstRows = await prisma.$queryRaw<
    Array<{
      orderId: string;
      orderNumber: string;
      customerName: string;
      status: string;
      plannedQty: number;
      shippedQty: number;
      deadline: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      o.id            AS "orderId",
      o."orderNumber" AS "orderNumber",
      c.name          AS "customerName",
      o.status::text  AS status,
      COALESCE(SUM(ol.quantity), 0)::float AS "plannedQty",
      o."shippedQty"::float                AS "shippedQty",
      o.deadline      AS deadline
    FROM orders o
    JOIN customers c ON o."customerId" = c.id
    LEFT JOIN order_lines ol ON ol."orderId" = o.id
    WHERE o."createdAt" >= ${range.from} AND o."createdAt" <= ${range.to}
      AND o.status IN ('PENDING','APPROVED','PARTIAL_SHIPPED')
    GROUP BY o.id, o."orderNumber", c.name, o.status, o."shippedQty", o.deadline
    HAVING COALESCE(SUM(ol.quantity), 0) > 0
    ORDER BY (o."shippedQty"::float / NULLIF(SUM(ol.quantity), 0)) ASC NULLS FIRST,
             o."orderNumber" ASC
    LIMIT 25
  `);

  const byStatus = statusRows.map((r) => ({
    status: r.status,
    count: Number(r.count),
    plannedQty: Math.round(Number(r.plannedQty ?? 0) * 10) / 10,
    shippedQty: Math.round(Number(r.shippedQty ?? 0) * 10) / 10,
  }));

  const totalOrders = byStatus.reduce((a, r) => a + r.count, 0);
  const totalPlannedQty = byStatus.reduce((a, r) => a + r.plannedQty, 0);
  const totalShippedQty = byStatus.reduce((a, r) => a + r.shippedQty, 0);

  return {
    totalOrders,
    totalPlannedQty: Math.round(totalPlannedQty * 10) / 10,
    totalShippedQty: Math.round(totalShippedQty * 10) / 10,
    byStatus,
    worstFulfillment: worstRows.map((r) => {
      const planned = Number(r.plannedQty);
      const shipped = Number(r.shippedQty);
      const pct = planned > 0 ? Math.round((shipped / planned) * 1000) / 10 : 0;
      return {
        orderId: r.orderId,
        orderNumber: r.orderNumber,
        customerName: r.customerName,
        status: r.status,
        plannedQty: Math.round(planned * 10) / 10,
        shippedQty: Math.round(shipped * 10) / 10,
        fulfillmentPct: pct,
        deadline: r.deadline,
      };
    }),
  };
}

// ---------- 2) Late Delivery -------------------------------------------------

export interface LateDeliveryRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  deadline: Date;
  plannedQty: number;
  shippedQty: number;
  remainingQty: number;
  daysLate: number;
}

/**
 * Snapshot: bugün itibariyle deadline geçmiş + henüz COMPLETED/CANCELLED olmayan
 * siparişler. Tarih aralığı uygulanmaz (anlık operasyonel görüş).
 */
export async function getLateDeliveries(): Promise<LateDeliveryRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      orderId: string;
      orderNumber: string;
      customerName: string;
      status: string;
      deadline: Date;
      plannedQty: number;
      shippedQty: number;
    }>
  >(Prisma.sql`
    SELECT
      o.id                                  AS "orderId",
      o."orderNumber"                       AS "orderNumber",
      c.name                                AS "customerName",
      o.status::text                        AS status,
      o.deadline                            AS deadline,
      COALESCE(SUM(ol.quantity), 0)::float  AS "plannedQty",
      o."shippedQty"::float                 AS "shippedQty"
    FROM orders o
    JOIN customers c ON o."customerId" = c.id
    LEFT JOIN order_lines ol ON ol."orderId" = o.id
    WHERE o.deadline IS NOT NULL
      -- O-11: "deadline" tz'siz timestamp kolonu ve içinde UTC duruyor. Çıplak NOW()
      -- timestamptz olduğu için kolon YEREL saat sanılır → Europe/Istanbul'da
      -- siparişler termininden 3 saat ÖNCE "geciken" listesine düşerdi (ve
      -- daysLate JS tarafında UTC'ye göre hesaplandığı için iki uç çelişirdi).
      -- now() AT TIME ZONE 'UTC' STABLE'dır → deadline index'i kullanılabilir.
      -- Bekçi: scripts/test_raw_sql_hygiene.ts
      AND o.deadline < (now() AT TIME ZONE 'UTC')
      AND o.status IN ('PENDING','APPROVED','PARTIAL_SHIPPED')
    GROUP BY o.id, o."orderNumber", c.name, o.status, o.deadline, o."shippedQty"
    ORDER BY o.deadline ASC
    LIMIT 200
  `);

  const now = Date.now();
  return rows.map((r) => {
    const planned = Number(r.plannedQty);
    const shipped = Number(r.shippedQty);
    const remaining = Math.max(0, planned - shipped);
    const daysLate = Math.max(0, Math.floor((now - new Date(r.deadline).getTime()) / 86_400_000));
    return {
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      status: r.status,
      deadline: r.deadline,
      plannedQty: Math.round(planned * 10) / 10,
      shippedQty: Math.round(shipped * 10) / 10,
      remainingQty: Math.round(remaining * 10) / 10,
      daysLate,
    };
  });
}

