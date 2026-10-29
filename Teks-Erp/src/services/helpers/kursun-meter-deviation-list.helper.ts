// =============================================================================
// KURŞUN METRE SAPMALARI — ofis listesi + özet şeridi (H4)
// =============================================================================
// Liste, cursor ve özet AYNI where'den (`deviationWhereSql`) doğar; süzme sunucuda (filtre-liste.md).
// Durum tek CASE'ten (`deviationStatusSql`): ACKED (aktif imza) · PENDING (`readingPendingAckSql` —
// `finishStep` kapısıyla aynı yüklem) · UNSIGNED (imzasız sapma: NONE ya da OPERATOR_REASON'da sonradan
// kayan fark; kapı değil işaret). Gün aralığı fabrika gününden (`constants/time.ts`).
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { factoryDayEndOfKey, factoryDayStartOfKey } from "../../constants/time";
import { AppError } from "../../utils/app-error";
import { readingBaseSql, readingDeviatedSql, readingPendingAckSql, measuredInSql, declaredInSql } from "./kursun-meter-variance-sql.helper";

export const METER_DEVIATION_STATUSES = ["PENDING", "ACKED", "UNSIGNED"] as const;
export type MeterDeviationStatus = (typeof METER_DEVIATION_STATUSES)[number];

/** Elle okunan süzgeç adları — çıplak gelirse 400 (`assertNoBareFilterParams`). */
export const METER_DEVIATION_FILTER_NAMES = ["fromDay", "toDay", "machineId", "customerId", "status"];
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Gün YYYY-AA-GG olmalı").optional();
const optUuid = (msg: string) => z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid(msg).optional());
const meterDeviationQuerySchema = z.object({
  fromDay: dayKey,
  toDay: dayKey,
  machineId: optUuid("Geçersiz makine ID"),
  customerId: optUuid("Geçersiz müşteri ID"),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(METER_DEVIATION_STATUSES, { message: "Durum PENDING, ACKED ya da UNSIGNED olmalı" }).optional()),
  stepId: optUuid("Geçersiz adım ID"),
  cursor: optUuid("Geçersiz sayfa imleci"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** `filter[...]` sorgusu → süzgeç + sayfa (Türkçe 400). */
export function parseMeterDeviationQuery(q: Record<string, unknown>): z.infer<typeof meterDeviationQuerySchema> {
  return meterDeviationQuerySchema.parse({
    fromDay: q["filter[fromDay]"],
    toDay: q["filter[toDay]"],
    machineId: q["filter[machineId]"],
    customerId: q["filter[customerId]"],
    status: q["filter[status]"],
    stepId: q.stepId,
    cursor: q.cursor,
    limit: q.limit,
  });
}

export interface MeterDeviationFilter {
  fromDay?: string;
  toDay?: string;
  machineId?: string;
  customerId?: string;
  stepId?: string;
  status?: MeterDeviationStatus;
}

export interface MeterDeviationRow {
  readingId: string;
  rollId: string;
  barcode: string | null;
  stepId: string;
  workOrderNumber: string | null;
  machineId: string | null;
  machineName: string | null;
  customerId: string | null;
  customerName: string | null;
  declaredIn: number | null;
  measuredIn: number | null;
  baseMeters: number | null;
  outMeters: number;
  diffMeters: number | null;
  thresholdM: number | null;
  thresholdPct: number | null;
  basis: string;
  approvalMode: string;
  source: string;
  status: MeterDeviationStatus;
  ack: { mode: string; reasonCode: string | null; reasonText: string | null; approvedByName: string | null; createdAt: Date } | null;
  createdAt: Date;
}

export interface MeterDeviationSummary {
  total: number;
  unsigned: number;
  pending: number;
  avgDiffMeters: number | null;
  avgAbsDiffMeters: number | null;
}

/** Satır durumu — tek CASE; özet sayımı ve durum süzgeci bunu okur. */
function deviationStatusSql(): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN EXISTS (SELECT 1 FROM roll_meter_acks ak WHERE ak."readingId" = r.id AND ak."revokedAt" IS NULL) THEN 'ACKED'
    WHEN ${readingPendingAckSql("r")} THEN 'PENDING'
    ELSE 'UNSIGNED' END)`;
}

function assertDay(key: string | undefined, label: string): Date | null {
  if (!key) return null;
  const d = label === "başlangıç" ? factoryDayStartOfKey(key) : factoryDayEndOfKey(key);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest(`Geçersiz ${label} günü (YYYY-AA-GG)`, { code: "INVALID_DAY" });
  return d;
}

/** Liste + özet ortak where'i (`r` = roll_meter_readings, `ro` = rolls). */
export function deviationWhereSql(f: MeterDeviationFilter): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`r.phase = 'OUT'::"MeterPhase"`, Prisma.sql`r."revokedAt" IS NULL`, readingDeviatedSql("r")];
  const from = assertDay(f.fromDay, "başlangıç");
  const to = assertDay(f.toDay, "bitiş");
  if (from) conds.push(Prisma.sql`r."createdAt" >= ${from}`);
  if (to) conds.push(Prisma.sql`r."createdAt" <= ${to}`);
  if (f.machineId) conds.push(Prisma.sql`r."machineId" = ${f.machineId}::uuid`);
  if (f.customerId) conds.push(Prisma.sql`ro."ownerCustomerId" = ${f.customerId}::uuid`);
  if (f.stepId) conds.push(Prisma.sql`r."workOrderStepId" = ${f.stepId}::uuid`);
  if (f.status) conds.push(Prisma.sql`${deviationStatusSql()} = ${f.status}`);
  return Prisma.join(conds, " AND ");
}

type RawRow = Omit<MeterDeviationRow, "ack" | "declaredIn" | "measuredIn" | "baseMeters" | "outMeters" | "diffMeters" | "thresholdM" | "thresholdPct"> & {
  declaredIn: Prisma.Decimal | null;
  measuredIn: Prisma.Decimal | null;
  baseMeters: Prisma.Decimal | null;
  outMeters: Prisma.Decimal;
  thresholdM: Prisma.Decimal | null;
  thresholdPct: Prisma.Decimal | null;
  ackMode: string | null;
  ackReasonCode: string | null;
  ackReasonText: string | null;
  ackApprovedByName: string | null;
  ackCreatedAt: Date | null;
};

const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

/** Sayfa (createdAt DESC, id DESC; cursor = son satırın okuma id'si) + aynı where'den özet. */
export async function listMeterDeviations(
  f: MeterDeviationFilter,
  page: { cursor?: string; limit: number },
): Promise<{ rows: MeterDeviationRow[]; nextCursor: string | null; summary: MeterDeviationSummary }> {
  const where = deviationWhereSql(f);
  const after = page.cursor
    ? Prisma.sql`AND (r."createdAt", r.id) < (SELECT c."createdAt", c.id FROM roll_meter_readings c WHERE c.id = ${page.cursor}::uuid)`
    : Prisma.empty;
  const raw = await prisma.$queryRaw<RawRow[]>`
    SELECT r.id AS "readingId", r."rollId", ro.barcode, r."workOrderStepId" AS "stepId", wo."workOrderNumber",
      r."machineId", m.name AS "machineName", ro."ownerCustomerId" AS "customerId", cu.name AS "customerName",
      ${declaredInSql("r")} AS "declaredIn", ${measuredInSql("r")} AS "measuredIn", ${readingBaseSql("r")} AS "baseMeters",
      r.meters AS "outMeters", r."thresholdM", r."thresholdPct", r.basis::text AS basis, r."approvalMode"::text AS "approvalMode",
      r.source::text AS source, ${deviationStatusSql()} AS status,
      ak.mode::text AS "ackMode", ak."reasonCode" AS "ackReasonCode", ak."reasonText" AS "ackReasonText",
      au."fullName" AS "ackApprovedByName", ak."createdAt" AS "ackCreatedAt", r."createdAt"
    FROM roll_meter_readings r
    JOIN rolls ro ON ro.id = r."rollId"
    JOIN work_order_steps st ON st.id = r."workOrderStepId"
    JOIN work_orders wo ON wo.id = st."workOrderId"
    LEFT JOIN machines m ON m.id = r."machineId"
    LEFT JOIN customers cu ON cu.id = ro."ownerCustomerId"
    LEFT JOIN roll_meter_acks ak ON ak."readingId" = r.id AND ak."revokedAt" IS NULL
    LEFT JOIN users au ON au.id = ak."approvedById"
    WHERE ${where} ${after}
    ORDER BY r."createdAt" DESC, r.id DESC
    LIMIT ${page.limit + 1}`;
  const sum = await prisma.$queryRaw<{ total: bigint; unsigned: bigint; pending: bigint; avgDiff: Prisma.Decimal | null; avgAbs: Prisma.Decimal | null }[]>`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE x.status <> 'ACKED') AS unsigned,
      count(*) FILTER (WHERE x.status = 'PENDING') AS pending,
      round(avg(x.diff), 3) AS "avgDiff", round(avg(abs(x.diff)), 3) AS "avgAbs"
    FROM (SELECT ${deviationStatusSql()} AS status, round(r.meters::numeric, 3) - ${readingBaseSql("r")} AS diff
          FROM roll_meter_readings r JOIN rolls ro ON ro.id = r."rollId" WHERE ${where}) x`;
  const hasMore = raw.length > page.limit;
  const slice = hasMore ? raw.slice(0, page.limit) : raw;
  const rows: MeterDeviationRow[] = slice.map((x) => {
    const base = num(x.baseMeters);
    const out = Number(x.outMeters);
    return {
      readingId: x.readingId, rollId: x.rollId, barcode: x.barcode, stepId: x.stepId, workOrderNumber: x.workOrderNumber,
      machineId: x.machineId, machineName: x.machineName, customerId: x.customerId, customerName: x.customerName,
      declaredIn: num(x.declaredIn), measuredIn: num(x.measuredIn), baseMeters: base, outMeters: out,
      diffMeters: base == null ? null : Math.round((out - base) * 1000) / 1000,
      thresholdM: num(x.thresholdM), thresholdPct: num(x.thresholdPct), basis: x.basis, approvalMode: x.approvalMode,
      source: x.source, status: x.status,
      ack: x.ackMode
        ? { mode: x.ackMode, reasonCode: x.ackReasonCode, reasonText: x.ackReasonText, approvedByName: x.ackApprovedByName, createdAt: x.ackCreatedAt as Date }
        : null,
      createdAt: x.createdAt,
    };
  });
  const s = sum[0];
  return {
    rows,
    nextCursor: hasMore ? slice[slice.length - 1].readingId : null,
    summary: {
      total: Number(s?.total ?? 0),
      unsigned: Number(s?.unsigned ?? 0),
      pending: Number(s?.pending ?? 0),
      avgDiffMeters: num(s?.avgDiff ?? null),
      avgAbsDiffMeters: num(s?.avgAbs ?? null),
    },
  };
}
