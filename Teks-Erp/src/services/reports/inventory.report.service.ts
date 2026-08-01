// =============================================================================
// TeksERP - Inventory Reports
// =============================================================================
// 4 alt-rapor: rulo yaşlandırma (snapshot), stok dağılımı (snapshot),
// müşteri mülkü (snapshot), günlük hareket akışı (date-range).
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { factoryDaySql } from "../../constants/time";


// ---------- 1) Roll Aging (snapshot) -----------------------------------------

export interface RollAgingSummary {
  buckets: { bucket: string; count: number; qty: number }[];
  totalRolls: number;
  totalQty: number;
  oldestDays: number;
}

export async function getRollAging(): Promise<RollAgingSummary> {
  // F244: iki bağımsız salt-okunur raw sorgu — pooled base client'ta paralel çalışır.
  const [rows, oldestRow] = await Promise.all([
    prisma.$queryRaw<
      Array<{ bucket: string; count: bigint; qty: number | null; bucketOrder: number }>
    >(Prisma.sql`
    WITH aged AS (
      SELECT
        r."currentQty",
        -- tz-ok: MUTLAK PENCERE — takvim günü DEĞİL. "3/7/14/30 gün" kovaları
        -- geçen SÜREYİ ölçer (3 gün = 72 saat), takvim sınırını değil; saat
        -- diliminden bağımsızdır. "updatedAt" 2026-08-01'den beri timestamptz →
        -- çıplak now() ile farkı almak oturum saat dilimine BAKMAKSIZIN doğrudur.
        -- (Eskiden kolon tz'siz olduğu için now() AT TIME ZONE 'UTC' gerekiyordu;
        --  o sarmalayıcı bugün sonucu oturum tz'sine geri bağlardı — kaldırıldı.)
        EXTRACT(EPOCH FROM (now() - r."updatedAt")) / 86400.0 AS age_days
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
  `),
    prisma.$queryRaw<Array<{ oldestDays: number | null }>>(Prisma.sql`
    -- tz-ok: yukarıdaki kova sorgusuyla aynı gerekçe — MUTLAK PENCERE (geçen süre),
    -- takvim günü değil. Kolon timestamptz, çıplak now() ile fark saat diliminden
    -- bağımsız doğrudur.
    SELECT MAX(EXTRACT(EPOCH FROM (now() - r."updatedAt")) / 86400.0)::float AS "oldestDays"
    FROM rolls r
    WHERE r.status = 'WAREHOUSE'
  `),
  ]);

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
  // F244: üç bağımsız salt-okunur aggregate — tek Promise.all (seri round-trip yerine).
  // M-33: başlık toplamları LİMİTSİZ ayrı aggregate'ten — eskiden LIMIT 100'lük
  // byItemColor listesinin reduce'üydü; ürün×renk kombinasyonu 100'ü aşınca
  // toplamlar sessizce eksik kalıyor ve aynı rapordaki (LIMIT'siz) byWidth ile
  // çelişiyordu. Tek satırlık aggregate, [status] index'iyle ucuz.
  const [itemColorRows, widthRows, totalsRow] = await Promise.all([
    prisma.$queryRaw<
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
    WHERE r.status IN ('WAREHOUSE','STOCK')
    GROUP BY i.name, COALESCE(c.name, 'Ham')
    ORDER BY "totalQty" DESC NULLS LAST
    LIMIT 100
  `),
    prisma.$queryRaw<
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
    WHERE r.status IN ('WAREHOUSE','STOCK')
    GROUP BY 1, 2
    ORDER BY 2
  `),
    prisma.$queryRaw<
      Array<{ rollCount: bigint; totalQty: number | null }>
    >(Prisma.sql`
    SELECT COUNT(*) AS "rollCount", SUM(r."currentQty")::float AS "totalQty"
    FROM rolls r
    WHERE r.status IN ('WAREHOUSE','STOCK')
  `),
  ]);

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

  const totalRolls = Number(totalsRow[0]?.rollCount ?? 0);
  const totalQty = Math.round(Number(totalsRow[0]?.totalQty ?? 0) * 10) / 10;

  return { totalRolls, totalQty, byItemColor, byWidth };
}

// ---------- 3) Daily Movements -----------------------------------------------

export interface DailyMovementRow {
  day: string;
  stationName: string;
  movementCount: number;
}

export async function getDailyMovements(range: DateRange): Promise<DailyMovementRow[]> {
  // GÜN SORUSU = TAKVİM GÜNÜ (fabrika saati). "Hangi gün hangi istasyondan kaç
  // hareket geçti" vardiya raporudur; gece 00:00–03:00 arasındaki hareketler
  // UTC'de kesilseydi bir önceki güne yazılır ve operatörün kendi vardiya
  // sayımıyla tutmazdı.
  const rows = await prisma.$queryRaw<
    Array<{ day: Date; stationName: string; movementCount: bigint }>
  >(Prisma.sql`
    SELECT
      ${factoryDaySql('rm."enteredAt"')}      AS day,
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
