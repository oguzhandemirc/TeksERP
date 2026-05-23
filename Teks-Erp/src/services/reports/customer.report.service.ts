// =============================================================================
// TeksERP - Customer / Sales Profile Reports
// =============================================================================
// 2 alt-rapor: müşteri sipariş profili (favori ürün/renk/en), alias istatistiği.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";

// ---------- 1) Order Profile Summary -----------------------------------------

export interface CustomerOrderProfileRow {
  customerId: string;
  customerName: string;
  customerCode: string;
  orderCount: number;
  lineCount: number;
  topItemName: string | null;
  topColorName: string | null;
  topWidth: number | null;
  lastOrderDate: Date | null;
}

export async function getCustomerOrderProfiles(): Promise<CustomerOrderProfileRow[]> {
  // Müşteri başına agg + her birinin "en sık" ürün/renk/eni
  // Subquery + DISTINCT ON kombinasyonu Postgres'e özel — tek round-trip.
  const rows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      customerCode: string;
      orderCount: bigint;
      lineCount: bigint;
      topItemName: string | null;
      topColorName: string | null;
      topWidth: number | null;
      lastOrderDate: Date | null;
    }>
  >(Prisma.sql`
    WITH cust_agg AS (
      SELECT
        c.id        AS customer_id,
        c.name      AS customer_name,
        c.code      AS customer_code,
        COUNT(DISTINCT o.id) AS order_count,
        COUNT(ol.id)         AS line_count,
        MAX(o."orderDate")   AS last_order_date
      FROM customers c
      LEFT JOIN orders o      ON o."customerId" = c.id
      LEFT JOIN order_lines ol ON ol."orderId"  = o.id
      WHERE c."isActive" = true
      GROUP BY c.id, c.name, c.code
    ),
    item_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        i.name         AS item_name
      FROM orders o
      JOIN order_lines ol ON ol."orderId" = o.id
      JOIN items i        ON ol."itemId"  = i.id
      GROUP BY o."customerId", i.name
      ORDER BY o."customerId", COUNT(*) DESC
    ),
    color_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        col.name       AS color_name
      FROM orders o
      JOIN order_lines ol ON ol."orderId" = o.id
      JOIN colors col     ON ol."colorId" = col.id
      GROUP BY o."customerId", col.name
      ORDER BY o."customerId", COUNT(*) DESC
    ),
    width_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        ol.width       AS width
      FROM orders o
      JOIN order_lines ol ON ol."orderId" = o.id
      WHERE ol.width IS NOT NULL
      GROUP BY o."customerId", ol.width
      ORDER BY o."customerId", COUNT(*) DESC
    )
    SELECT
      ca.customer_id     AS "customerId",
      ca.customer_name   AS "customerName",
      ca.customer_code   AS "customerCode",
      ca.order_count     AS "orderCount",
      ca.line_count      AS "lineCount",
      ir.item_name       AS "topItemName",
      cr.color_name      AS "topColorName",
      wr.width           AS "topWidth",
      ca.last_order_date AS "lastOrderDate"
    FROM cust_agg ca
    LEFT JOIN item_rank  ir ON ir.customer_id  = ca.customer_id
    LEFT JOIN color_rank cr ON cr.customer_id  = ca.customer_id
    LEFT JOIN width_rank wr ON wr.customer_id  = ca.customer_id
    WHERE ca.order_count > 0
    ORDER BY ca.order_count DESC
    LIMIT 200
  `);

  return rows.map((r) => ({
    customerId: r.customerId,
    customerName: r.customerName,
    customerCode: r.customerCode,
    orderCount: Number(r.orderCount),
    lineCount: Number(r.lineCount),
    topItemName: r.topItemName,
    topColorName: r.topColorName,
    topWidth: r.topWidth !== null ? Number(r.topWidth) : null,
    lastOrderDate: r.lastOrderDate,
  }));
}

// ---------- 2) Alias Stats ---------------------------------------------------

export interface AliasStats {
  totalItemAliases: number;
  totalColorAliases: number;
  customersWithItemAlias: number;
  customersWithColorAlias: number;
  topCustomers: { customerId: string; customerName: string; itemAliases: number; colorAliases: number }[];
}

export async function getAliasStats(): Promise<AliasStats> {
  const totalsRow = await prisma.$queryRaw<
    Array<{
      totalItemAliases: bigint;
      totalColorAliases: bigint;
      customersWithItemAlias: bigint;
      customersWithColorAlias: bigint;
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM customer_item_aliases)                                AS "totalItemAliases",
      (SELECT COUNT(*) FROM customer_color_aliases)                               AS "totalColorAliases",
      (SELECT COUNT(DISTINCT "customerId") FROM customer_item_aliases)            AS "customersWithItemAlias",
      (SELECT COUNT(DISTINCT "customerId") FROM customer_color_aliases)           AS "customersWithColorAlias"
  `);

  const topRows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      itemAliases: bigint;
      colorAliases: bigint;
    }>
  >(Prisma.sql`
    SELECT
      c.id     AS "customerId",
      c.name   AS "customerName",
      COALESCE(ia.cnt, 0) AS "itemAliases",
      COALESCE(ca.cnt, 0) AS "colorAliases"
    FROM customers c
    LEFT JOIN (
      SELECT "customerId", COUNT(*) AS cnt
      FROM customer_item_aliases
      GROUP BY "customerId"
    ) ia ON ia."customerId" = c.id
    LEFT JOIN (
      SELECT "customerId", COUNT(*) AS cnt
      FROM customer_color_aliases
      GROUP BY "customerId"
    ) ca ON ca."customerId" = c.id
    WHERE c."isActive" = true
      AND (COALESCE(ia.cnt, 0) > 0 OR COALESCE(ca.cnt, 0) > 0)
    ORDER BY (COALESCE(ia.cnt, 0) + COALESCE(ca.cnt, 0)) DESC
    LIMIT 50
  `);

  const t = totalsRow[0];
  return {
    totalItemAliases: Number(t?.totalItemAliases ?? 0),
    totalColorAliases: Number(t?.totalColorAliases ?? 0),
    customersWithItemAlias: Number(t?.customersWithItemAlias ?? 0),
    customersWithColorAlias: Number(t?.customersWithColorAlias ?? 0),
    topCustomers: topRows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      itemAliases: Number(r.itemAliases),
      colorAliases: Number(r.colorAliases),
    })),
  };
}
