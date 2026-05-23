// =============================================================================
// TeksERP - Inventory Reports
// =============================================================================
// 4 alt-rapor: rulo yaşlandırma (snapshot), stok dağılımı (snapshot),
// müşteri mülkü (snapshot), günlük hareket akışı (date-range).
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";

const STOCK_STATUSES = ["WAREHOUSE", "STOCK", "A1_STOCK", "READY_FOR_SHIP", "PRODUCED"] as const;

// ---------- 1) Roll Aging (snapshot) -----------------------------------------

export interface RollAgingSummary {
  buckets: { bucket: string; count: number; qty: number }[];
  totalRolls: number;
  totalQty: number;
  oldestDays: number;
}

export async function getRollAging(): Promise<RollAgingSummary> {
  const rows = await prisma.$queryRaw<
    Array<{ bucket: string; count: bigint; qty: number | null; bucketOrder: number }>
  >(Prisma.sql`
    WITH aged AS (
      SELECT
        r."currentQty",
        EXTRACT(EPOCH FROM (NOW() - r."updatedAt")) / 86400.0 AS age_days
      FROM rolls r
      WHERE r.status = 'WAREHOUSE'
    )
    SELECT
      CASE
        WHEN age_days <= 3  THEN '0-3 gün'
        WHEN age_days <= 7  THEN '3-7 gün'
        WHEN age_days <= 14 THEN '7-14 gün'
        WHEN age_days <= 30 THEN '14-30 gün'
        ELSE '30+ gün'
      END AS bucket,
      CASE
        WHEN age_days <= 3  THEN 1
        WHEN age_days <= 7  THEN 2
        WHEN age_days <= 14 THEN 3
        WHEN age_days <= 30 THEN 4
        ELSE 5
      END AS "bucketOrder",
      COUNT(*)                 AS count,
      SUM("currentQty")::float AS qty
    FROM aged
    GROUP BY 1, 2
    ORDER BY 2
  `);

  const oldestRow = await prisma.$queryRaw<Array<{ oldestDays: number | null }>>(Prisma.sql`
    SELECT MAX(EXTRACT(EPOCH FROM (NOW() - r."updatedAt")) / 86400.0)::float AS "oldestDays"
    FROM rolls r
    WHERE r.status = 'WAREHOUSE'
  `);

  const buckets = rows.map((r) => ({
    bucket: r.bucket,
    count: Number(r.count),
    qty: Math.round(Number(r.qty ?? 0) * 10) / 10,
  }));

  return {
    buckets,
    totalRolls: buckets.reduce((a, r) => a + r.count, 0),
    totalQty: Math.round(buckets.reduce((a, r) => a + r.qty, 0) * 10) / 10,
    oldestDays: Math.floor(Number(oldestRow[0]?.oldestDays ?? 0)),
  };
}

// ---------- 2) Stock Distribution (snapshot) ---------------------------------

export interface StockByItemColorRow {
  itemName: string;
  colorName: string;
  rollCount: number;
  totalQty: number;
}

export interface StockByWidthRow {
  widthBucket: string;
  rollCount: number;
  totalQty: number;
}

export interface StockDistribution {
  totalRolls: number;
  totalQty: number;
  byItemColor: StockByItemColorRow[];
  byWidth: StockByWidthRow[];
}

export async function getStockDistribution(): Promise<StockDistribution> {
  const itemColorRows = await prisma.$queryRaw<
    Array<{ itemName: string; colorName: string; rollCount: bigint; totalQty: number | null }>
  >(Prisma.sql`
    SELECT
      i.name                    AS "itemName",
      COALESCE(c.name, 'Ham')   AS "colorName",
      COUNT(*)                  AS "rollCount",
      SUM(r."currentQty")::float AS "totalQty"
    FROM rolls r
    JOIN items i        ON r."itemId" = i.id
    LEFT JOIN colors c  ON r."colorId" = c.id
    WHERE r.status IN ('WAREHOUSE','STOCK','A1_STOCK','READY_FOR_SHIP','PRODUCED')
    GROUP BY i.name, COALESCE(c.name, 'Ham')
    ORDER BY "totalQty" DESC NULLS LAST
    LIMIT 100
  `);

  const widthRows = await prisma.$queryRaw<
    Array<{ widthBucket: string; bucketOrder: number; rollCount: bigint; totalQty: number | null }>
  >(Prisma.sql`
    SELECT
      CASE
        WHEN r.width IS NULL    THEN 'Belirsiz'
        WHEN r.width < 100      THEN '<100 cm'
        WHEN r.width < 150      THEN '100-150 cm'
        WHEN r.width < 200      THEN '150-200 cm'
        WHEN r.width < 250      THEN '200-250 cm'
        ELSE '250+ cm'
      END AS "widthBucket",
      CASE
        WHEN r.width IS NULL    THEN 0
        WHEN r.width < 100      THEN 1
        WHEN r.width < 150      THEN 2
        WHEN r.width < 200      THEN 3
        WHEN r.width < 250      THEN 4
        ELSE 5
      END AS "bucketOrder",
      COUNT(*)                  AS "rollCount",
      SUM(r."currentQty")::float AS "totalQty"
    FROM rolls r
    WHERE r.status IN ('WAREHOUSE','STOCK','A1_STOCK','READY_FOR_SHIP','PRODUCED')
    GROUP BY 1, 2
    ORDER BY 2
  `);

  const byItemColor = itemColorRows.map((r) => ({
    itemName: r.itemName,
    colorName: r.colorName,
    rollCount: Number(r.rollCount),
    totalQty: Math.round(Number(r.totalQty ?? 0) * 10) / 10,
  }));

  const byWidth = widthRows.map((r) => ({
    widthBucket: r.widthBucket,
    rollCount: Number(r.rollCount),
    totalQty: Math.round(Number(r.totalQty ?? 0) * 10) / 10,
  }));

  const totalRolls = byItemColor.reduce((a, r) => a + r.rollCount, 0);
  const totalQty = Math.round(byItemColor.reduce((a, r) => a + r.totalQty, 0) * 10) / 10;

  return { totalRolls, totalQty, byItemColor, byWidth };
}

// ---------- 3) Customer Owned (snapshot) -------------------------------------

export interface CustomerOwnedRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  rollCount: number;
  totalQty: number;
}

export async function getCustomerOwnedStock(): Promise<CustomerOwnedRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      customerCode: string;
      customerName: string;
      rollCount: bigint;
      totalQty: number | null;
    }>
  >(Prisma.sql`
    SELECT
      c.id                     AS "customerId",
      c.code                   AS "customerCode",
      c.name                   AS "customerName",
      COUNT(*)                 AS "rollCount",
      SUM(r."currentQty")::float AS "totalQty"
    FROM rolls r
    JOIN customers c ON r."ownerCustomerId" = c.id
    WHERE r."ownerCustomerId" IS NOT NULL
      AND r.status NOT IN ('SHIPPED','CANCELLED','SCRAP','TAMBUR_CONSUMED','SUBCONTRACTOR_CONSUMED')
    GROUP BY c.id, c.code, c.name
    ORDER BY "totalQty" DESC NULLS LAST
  `);

  return rows.map((r) => ({
    customerId: r.customerId,
    customerCode: r.customerCode,
    customerName: r.customerName,
    rollCount: Number(r.rollCount),
    totalQty: Math.round(Number(r.totalQty ?? 0) * 10) / 10,
  }));
}

// ---------- 4) Daily Movements -----------------------------------------------

export interface DailyMovementRow {
  day: string;
  stationName: string;
  movementCount: number;
}

export async function getDailyMovements(range: DateRange): Promise<DailyMovementRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; stationName: string; movementCount: bigint }>
  >(Prisma.sql`
    SELECT
      DATE_TRUNC('day', rm."enteredAt")::date AS day,
      s.name                                  AS "stationName",
      COUNT(*)                                AS "movementCount"
    FROM roll_movements rm
    JOIN work_order_steps wos ON rm."workOrderStepId" = wos.id
    JOIN stations s           ON wos."stationId" = s.id
    WHERE rm."enteredAt" >= ${range.from} AND rm."enteredAt" <= ${range.to}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    stationName: r.stationName,
    movementCount: Number(r.movementCount),
  }));
}

export { STOCK_STATUSES };
