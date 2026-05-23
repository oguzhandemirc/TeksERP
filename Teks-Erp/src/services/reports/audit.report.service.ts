// =============================================================================
// TeksERP - Audit (System Log) Reports
// =============================================================================
// 2 alt-rapor: audit log özeti (tablo × işlem türü), kullanıcı aktivitesi.
// SystemLog yüksek hacimli — sorgular yalnız @@index([createdAt]) üzerinden.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";

// ---------- 1) System Log Summary --------------------------------------------

export interface SystemLogSummary {
  totalLogs: number;
  byAction: { action: string; count: number }[];
  byTable: { tableName: string; count: number }[];
  daily: { day: string; create: number; update: number; delete: number }[];
}

export async function getSystemLogSummary(range: DateRange): Promise<SystemLogSummary> {
  const totalRow = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total
    FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
  `);

  const actionRows = await prisma.$queryRaw<Array<{ action: string; count: bigint }>>(Prisma.sql`
    SELECT action, COUNT(*) AS count
    FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY action
    ORDER BY count DESC
  `);

  const tableRows = await prisma.$queryRaw<Array<{ tableName: string; count: bigint }>>(Prisma.sql`
    SELECT "tableName", COUNT(*) AS count
    FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY "tableName"
    ORDER BY count DESC
    LIMIT 30
  `);

  const dailyRows = await prisma.$queryRaw<
    Array<{ day: Date; createCount: bigint; updateCount: bigint; deleteCount: bigint }>
  >(Prisma.sql`
    SELECT
      DATE_TRUNC('day', "createdAt")::date           AS day,
      COUNT(*) FILTER (WHERE action = 'CREATE')      AS "createCount",
      COUNT(*) FILTER (WHERE action = 'UPDATE')      AS "updateCount",
      COUNT(*) FILTER (WHERE action = 'DELETE')      AS "deleteCount"
    FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY 1
    ORDER BY 1
  `);

  return {
    totalLogs: Number(totalRow[0]?.total ?? 0),
    byAction: actionRows.map((r) => ({ action: r.action, count: Number(r.count) })),
    byTable: tableRows.map((r) => ({ tableName: r.tableName, count: Number(r.count) })),
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      create: Number(r.createCount),
      update: Number(r.updateCount),
      delete: Number(r.deleteCount),
    })),
  };
}

// ---------- 2) User Activity -------------------------------------------------

export interface UserActivityRow {
  userId: string | null;
  username: string | null;
  fullName: string | null;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  totalCount: number;
  lastActionAt: Date | null;
}

export async function getUserActivity(range: DateRange): Promise<UserActivityRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string | null;
      username: string | null;
      fullName: string | null;
      createCount: bigint;
      updateCount: bigint;
      deleteCount: bigint;
      totalCount: bigint;
      lastActionAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      sl."userId"                                     AS "userId",
      u.username                                       AS username,
      u."fullName"                                     AS "fullName",
      COUNT(*) FILTER (WHERE sl.action = 'CREATE')     AS "createCount",
      COUNT(*) FILTER (WHERE sl.action = 'UPDATE')     AS "updateCount",
      COUNT(*) FILTER (WHERE sl.action = 'DELETE')     AS "deleteCount",
      COUNT(*)                                         AS "totalCount",
      MAX(sl."createdAt")                              AS "lastActionAt"
    FROM system_logs sl
    LEFT JOIN users u ON u.id = sl."userId"
    WHERE sl."createdAt" >= ${range.from} AND sl."createdAt" <= ${range.to}
    GROUP BY sl."userId", u.username, u."fullName"
    ORDER BY "totalCount" DESC
    LIMIT 100
  `);

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    fullName: r.fullName,
    createCount: Number(r.createCount),
    updateCount: Number(r.updateCount),
    deleteCount: Number(r.deleteCount),
    totalCount: Number(r.totalCount),
    lastActionAt: r.lastActionAt,
  }));
}
