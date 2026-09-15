// =============================================================================
// TeksERP - Customer / Sales Profile Reports
// =============================================================================
// 2 alt-rapor: müşteri sipariş profili (favori ürün/renk/en), alias istatistiği.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { customerRowSql, type ReportFilterInput } from "./_filters";
import { droppedRows, optionList, hasFilters, type WithSecenekler } from "./_secenekler";

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

/** Profil satırları + R5b-c3 seçici kaynağı (müşteri listesi = süzgeçsiz koşunun kendi satırları, ≤200). */
export interface CustomerOrderProfileReport extends WithSecenekler { rows: CustomerOrderProfileRow[] }

export async function getCustomerOrderProfiles(filters: ReportFilterInput = {}): Promise<CustomerOrderProfileReport> {
  const rows = await profileRows(filters);
  // Süzgeçli istek seçenek listesi için bir kez daha süzgeçsiz toplar (beyanlı ×2).
  const unfiltered = hasFilters(filters) ? await profileRows({}) : null;
  const source = unfiltered ?? rows;
  return { rows, secenekler: { customerId: optionList(source.map((r) => ({ id: r.customerId, ad: r.customerName, kod: r.customerCode }))) }, dusenSatir: droppedRows(unfiltered?.length ?? null, rows.length) };
}

async function profileRows(filters: ReportFilterInput): Promise<CustomerOrderProfileRow[]> {
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
      -- aktif-kalem: iptal edilmiş kalem müşteri profiline girmez.
      LEFT JOIN order_lines ol ON ol."orderId"  = o.id AND ol."cancelledAt" IS NULL
      WHERE c."isActive" = true ${customerRowSql(filters)}
      GROUP BY c.id, c.name, c.code
    ),
    item_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        i.name         AS item_name
      FROM orders o
      -- aktif-kalem
      JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL
      JOIN items i        ON ol."itemId"  = i.id
      GROUP BY o."customerId", i.name
      ORDER BY o."customerId", COUNT(*) DESC
    ),
    color_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        col.name       AS color_name
      FROM orders o
      -- aktif-kalem
      JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL
      JOIN colors col     ON ol."colorId" = col.id
      GROUP BY o."customerId", col.name
      ORDER BY o."customerId", COUNT(*) DESC
    ),
    width_rank AS (
      SELECT DISTINCT ON (o."customerId")
        o."customerId" AS customer_id,
        ol.width       AS width
      FROM orders o
      -- aktif-kalem
      JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL
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
