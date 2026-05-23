// =============================================================================
// TeksERP - Subcontract Reports
// =============================================================================
// 2 alt-rapor: fasoncu performansı (date-range), açık fason sevkleri (snapshot).
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";

// ---------- 1) Subcontractor Performance -------------------------------------

export interface SubcontractPerformanceRow {
  subcontractorId: string;
  subcontractorName: string;
  dispatchCount: number;
  rollsDispatched: number;
  rollsReturned: number;
  rollsOpen: number;
  qtyDispatched: number;
  avgTurnaroundDays: number | null;
}

export async function getSubcontractorPerformance(range: DateRange): Promise<SubcontractPerformanceRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      subcontractorId: string;
      subcontractorName: string;
      dispatchCount: bigint;
      rollsDispatched: bigint;
      rollsReturned: bigint;
      qtyDispatched: number | null;
      avgTurnaroundDays: number | null;
    }>
  >(Prisma.sql`
    WITH dispatched AS (
      SELECT
        sd."subcontractorId",
        sd.id        AS dispatch_id,
        sd."dispatchedAt",
        sdi.id       AS dispatch_item_id,
        sdi."dispatchedQty"
      FROM subcontractor_dispatches sd
      JOIN subcontractor_dispatch_items sdi ON sdi."dispatchId" = sd.id
      WHERE sd."dispatchedAt" >= ${range.from} AND sd."dispatchedAt" <= ${range.to}
        AND sd."cancelledAt" IS NULL
    ),
    returned AS (
      SELECT sri."sourceDispatchItemId", sr."receivedAt"
      FROM subcontractor_receipt_items sri
      JOIN subcontractor_receipts sr ON sri."receiptId" = sr.id
      WHERE sr."cancelledAt" IS NULL
        AND sri."sourceDispatchItemId" IS NOT NULL
    )
    SELECT
      sub.id                                  AS "subcontractorId",
      sub.name                                AS "subcontractorName",
      COUNT(DISTINCT d.dispatch_id)           AS "dispatchCount",
      COUNT(d.dispatch_item_id)               AS "rollsDispatched",
      COUNT(r."sourceDispatchItemId")         AS "rollsReturned",
      SUM(d."dispatchedQty")::float           AS "qtyDispatched",
      AVG(EXTRACT(EPOCH FROM (r."receivedAt" - d."dispatchedAt")) / 86400.0)
        FILTER (WHERE r."sourceDispatchItemId" IS NOT NULL) AS "avgTurnaroundDays"
    FROM dispatched d
    JOIN subcontractors sub          ON d."subcontractorId" = sub.id
    LEFT JOIN returned r             ON r."sourceDispatchItemId" = d.dispatch_item_id
    GROUP BY sub.id, sub.name
    ORDER BY "dispatchCount" DESC, sub.name
  `);

  return rows.map((r) => {
    const dispatched = Number(r.rollsDispatched);
    const returned = Number(r.rollsReturned);
    return {
      subcontractorId: r.subcontractorId,
      subcontractorName: r.subcontractorName,
      dispatchCount: Number(r.dispatchCount),
      rollsDispatched: dispatched,
      rollsReturned: returned,
      rollsOpen: Math.max(0, dispatched - returned),
      qtyDispatched: Math.round(Number(r.qtyDispatched ?? 0) * 10) / 10,
      avgTurnaroundDays:
        r.avgTurnaroundDays !== null
          ? Math.round(Number(r.avgTurnaroundDays) * 10) / 10
          : null,
    };
  });
}

// ---------- 2) Open Dispatches (snapshot) ------------------------------------

export interface OpenDispatchRow {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: Date;
  subcontractorName: string;
  workOrderNumber: string | null;
  openItems: number;
  totalItems: number;
  daysOpen: number;
}

export async function getOpenDispatches(): Promise<OpenDispatchRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      dispatchId: string;
      dispatchNo: string;
      dispatchedAt: Date;
      subcontractorName: string;
      workOrderNumber: string | null;
      openItems: bigint;
      totalItems: bigint;
    }>
  >(Prisma.sql`
    SELECT
      sd.id                                                     AS "dispatchId",
      sd."dispatchNo"                                           AS "dispatchNo",
      sd."dispatchedAt"                                         AS "dispatchedAt",
      sub.name                                                  AS "subcontractorName",
      wo."workOrderNumber"                                      AS "workOrderNumber",
      COUNT(*) FILTER (WHERE r."sourceDispatchItemId" IS NULL)  AS "openItems",
      COUNT(*)                                                  AS "totalItems"
    FROM subcontractor_dispatches sd
    JOIN subcontractors sub                       ON sd."subcontractorId" = sub.id
    LEFT JOIN work_orders wo                      ON sd."workOrderId" = wo.id
    JOIN subcontractor_dispatch_items sdi         ON sdi."dispatchId" = sd.id
    LEFT JOIN subcontractor_receipt_items r       ON r."sourceDispatchItemId" = sdi.id
    WHERE sd."cancelledAt" IS NULL
    GROUP BY sd.id, sd."dispatchNo", sd."dispatchedAt", sub.name, wo."workOrderNumber"
    HAVING COUNT(*) FILTER (WHERE r."sourceDispatchItemId" IS NULL) > 0
    ORDER BY sd."dispatchedAt" ASC
    LIMIT 200
  `);

  const now = Date.now();
  return rows.map((r) => ({
    dispatchId: r.dispatchId,
    dispatchNo: r.dispatchNo,
    dispatchedAt: r.dispatchedAt,
    subcontractorName: r.subcontractorName,
    workOrderNumber: r.workOrderNumber,
    openItems: Number(r.openItems),
    totalItems: Number(r.totalItems),
    daysOpen: Math.max(0, Math.floor((now - new Date(r.dispatchedAt).getTime()) / 86_400_000)),
  }));
}
