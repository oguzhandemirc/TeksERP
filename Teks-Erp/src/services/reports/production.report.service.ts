// =============================================================================
// TeksERP - Production Reports
// =============================================================================
// 5 alt-rapor: istasyon verimliliği, operatör performansı, makine kullanımı,
// refakat kartı izleme (rulo bazlı), fire & hurda.
//
// Performans yaklaşımı:
//   - Tüm aggregate sorgular tek `$queryRaw` çağrısı — N+1 yok.
//   - WHERE filtreleri indeksli kolonlardan (enteredAt / createdAt / processedAt
//     / status,createdAt). Tarih aralığı zorunlu — full-table scan'i kapatır.
//   - `inheritedFromParentRollId IS NULL` filtresi RollOperation aggregate'lerde
//     Tambur kalıtım kopyalarını dışlar (çift sayım önlenir).
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";

// ---------- 1) Station Efficiency --------------------------------------------

export interface StationEfficiencyRow {
  stationId: string;
  stationName: string;
  stationKind: string;
  rollCount: number; // distinct rolls that touched
  qtyIn: number;
  qtyOut: number;
  avgDurationMin: number | null; // dakikalar
  stillIn: number; // henüz çıkmamış (in-progress)
}

export async function getStationEfficiency(range: DateRange): Promise<StationEfficiencyRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      stationId: string;
      stationName: string;
      stationKind: string;
      rollCount: bigint;
      qtyIn: number | null;
      qtyOut: number | null;
      avgDurationSec: number | null;
      stillIn: bigint;
    }>
  >(Prisma.sql`
    SELECT
      s.id                AS "stationId",
      s.name              AS "stationName",
      s.kind::text        AS "stationKind",
      COUNT(DISTINCT rm."rollId")                                                    AS "rollCount",
      SUM(rm."qtyIn")::float                                                         AS "qtyIn",
      SUM(rm."qtyOut")::float                                                        AS "qtyOut",
      AVG(EXTRACT(EPOCH FROM (rm."exitedAt" - rm."enteredAt")))
        FILTER (WHERE rm."exitedAt" IS NOT NULL)                                     AS "avgDurationSec",
      COUNT(*) FILTER (WHERE rm."exitedAt" IS NULL)                                  AS "stillIn"
    FROM roll_movements rm
    JOIN work_order_steps wos ON rm."workOrderStepId" = wos.id
    JOIN stations s           ON wos."stationId" = s.id
    WHERE rm."enteredAt" >= ${range.from} AND rm."enteredAt" <= ${range.to}
    GROUP BY s.id, s.name, s.kind
    ORDER BY "rollCount" DESC, s.name ASC
  `);

  return rows.map((r) => ({
    stationId: r.stationId,
    stationName: r.stationName,
    stationKind: r.stationKind,
    rollCount: Number(r.rollCount),
    qtyIn: Number(r.qtyIn ?? 0),
    qtyOut: Number(r.qtyOut ?? 0),
    avgDurationMin: r.avgDurationSec === null ? null : Math.round((r.avgDurationSec / 60) * 10) / 10,
    stillIn: Number(r.stillIn),
  }));
}

// ---------- 2) Operator Performance ------------------------------------------

export interface OperatorPerformanceRow {
  userId: string;
  username: string;
  fullName: string;
  totalOps: number;
  kursunCount: number;
  qc2Count: number;
  tamburCount: number;
  subcontractorOps: number;
}

export async function getOperatorPerformance(range: DateRange, limit = 50): Promise<OperatorPerformanceRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId: string;
      username: string;
      fullName: string;
      totalOps: bigint;
      kursunCount: bigint;
      qc2Count: bigint;
      tamburCount: bigint;
      subcontractorOps: bigint;
    }>
  >(Prisma.sql`
    SELECT
      u.id                                                                            AS "userId",
      u.username                                                                      AS "username",
      u."fullName"                                                                    AS "fullName",
      COUNT(*)                                                                        AS "totalOps",
      COUNT(*) FILTER (WHERE ro."operationType" = 'KURSUN_APPLIED')                   AS "kursunCount",
      COUNT(*) FILTER (WHERE ro."operationType" = 'QC2_COMPLETED')                    AS "qc2Count",
      COUNT(*) FILTER (WHERE ro."operationType" = 'TAMBUR_PROCESSED')                 AS "tamburCount",
      COUNT(*) FILTER (WHERE ro."operationType" IN ('SUBCONTRACTOR_SENT','SUBCONTRACTOR_RETURNED')) AS "subcontractorOps"
    FROM roll_operations ro
    JOIN users u ON ro."operatorId" = u.id
    WHERE ro."createdAt" >= ${range.from} AND ro."createdAt" <= ${range.to}
      AND ro."inheritedFromParentRollId" IS NULL
    GROUP BY u.id, u.username, u."fullName"
    ORDER BY "totalOps" DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    fullName: r.fullName,
    totalOps: Number(r.totalOps),
    kursunCount: Number(r.kursunCount),
    qc2Count: Number(r.qc2Count),
    tamburCount: Number(r.tamburCount),
    subcontractorOps: Number(r.subcontractorOps),
  }));
}

// ---------- 3) Machine Usage -------------------------------------------------

export interface MachineUsageRow {
  machineId: string;
  machineName: string;
  stationId: string;
  stationName: string;
  stationKind: string;
  opCount: number;
  rollCount: number;
}

export async function getMachineUsage(range: DateRange): Promise<MachineUsageRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      machineId: string;
      machineName: string;
      stationId: string;
      stationName: string;
      stationKind: string;
      opCount: bigint;
      rollCount: bigint;
    }>
  >(Prisma.sql`
    SELECT
      m.id            AS "machineId",
      m.name          AS "machineName",
      s.id            AS "stationId",
      s.name          AS "stationName",
      s.kind::text    AS "stationKind",
      COUNT(*)                       AS "opCount",
      COUNT(DISTINCT ro."rollId")    AS "rollCount"
    FROM roll_operations ro
    JOIN machines m  ON ro."machineId" = m.id
    JOIN stations s  ON m."stationId" = s.id
    WHERE ro."createdAt" >= ${range.from} AND ro."createdAt" <= ${range.to}
      AND ro."inheritedFromParentRollId" IS NULL
    GROUP BY m.id, m.name, s.id, s.name, s.kind
    ORDER BY "opCount" DESC, s.name ASC, m.name ASC
  `);

  return rows.map((r) => ({
    machineId: r.machineId,
    machineName: r.machineName,
    stationId: r.stationId,
    stationName: r.stationName,
    stationKind: r.stationKind,
    opCount: Number(r.opCount),
    rollCount: Number(r.rollCount),
  }));
}

// ---------- 4) Traveler Trace (single roll) ----------------------------------

export interface TravelerTraceEvent {
  type: "MOVEMENT_IN" | "MOVEMENT_OUT" | "OPERATION";
  at: Date;
  stationId: string | null;
  stationName: string | null;
  stationKind: string | null;
  operatorId: string | null;
  operatorName: string | null;
  machineName: string | null;
  /** Hareketler için qty bilgisi (giriş/çıkış). */
  qty: number | null;
  /** Operasyonlar için tip (KURSUN_APPLIED vb.). */
  operationType: string | null;
  notes: string | null;
}

export interface TravelerTraceResult {
  roll: {
    id: string;
    barcode: string | null;
    status: string;
    qualityGrade: string;
    initialQty: number;
    currentQty: number;
    width: number | null;
    createdAt: Date;
  };
  events: TravelerTraceEvent[];
}

export async function getTravelerTrace(rollId: string): Promise<TravelerTraceResult | null> {
  const roll = await prisma.roll.findUnique({
    where: { id: rollId },
    select: {
      id: true,
      barcode: true,
      status: true,
      qualityGrade: true,
      initialQty: true,
      currentQty: true,
      width: true,
      createdAt: true,
    },
  });
  if (!roll) return null;

  const [movements, operations] = await Promise.all([
    prisma.rollMovement.findMany({
      where: { rollId },
      orderBy: { enteredAt: "asc" },
      select: {
        enteredAt: true,
        exitedAt: true,
        qtyIn: true,
        qtyOut: true,
        notes: true,
        step: { select: { station: { select: { id: true, name: true, kind: true } } } },
        operator: { select: { id: true, username: true, fullName: true } },
        machine: { select: { name: true } },
      },
    }),
    prisma.rollOperation.findMany({
      where: { rollId, inheritedFromParentRollId: null },
      orderBy: { createdAt: "asc" },
      select: {
        operationType: true,
        createdAt: true,
        step: { select: { station: { select: { id: true, name: true, kind: true } } } },
        operator: { select: { id: true, username: true, fullName: true } },
        machine: { select: { name: true } },
      },
    }),
  ]);

  const events: TravelerTraceEvent[] = [];
  for (const m of movements) {
    events.push({
      type: "MOVEMENT_IN",
      at: m.enteredAt,
      stationId: m.step.station.id,
      stationName: m.step.station.name,
      stationKind: m.step.station.kind,
      operatorId: m.operator?.id ?? null,
      operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
      machineName: m.machine?.name ?? null,
      qty: Number(m.qtyIn),
      operationType: null,
      notes: m.notes,
    });
    if (m.exitedAt) {
      events.push({
        type: "MOVEMENT_OUT",
        at: m.exitedAt,
        stationId: m.step.station.id,
        stationName: m.step.station.name,
        stationKind: m.step.station.kind,
        operatorId: m.operator?.id ?? null,
        operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
        machineName: m.machine?.name ?? null,
        qty: m.qtyOut !== null ? Number(m.qtyOut) : null,
        operationType: null,
        notes: null,
      });
    }
  }
  for (const o of operations) {
    events.push({
      type: "OPERATION",
      at: o.createdAt,
      stationId: o.step.station.id,
      stationName: o.step.station.name,
      stationKind: o.step.station.kind,
      operatorId: o.operator?.id ?? null,
      operatorName: o.operator?.fullName ?? o.operator?.username ?? null,
      machineName: o.machine?.name ?? null,
      qty: null,
      operationType: o.operationType,
      notes: null,
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    roll: {
      ...roll,
      initialQty: Number(roll.initialQty),
      currentQty: Number(roll.currentQty),
      width: roll.width !== null ? Number(roll.width) : null,
    },
    events,
  };
}

// ---------- 5) Scrap / Fire --------------------------------------------------

export interface ScrapSummary {
  totalScrapRolls: number;
  totalScrapQty: number;
  daily: { day: string; count: number; qty: number }[];
  byDefect: { defectName: string; count: number }[];
}

export async function getScrapSummary(range: DateRange): Promise<ScrapSummary> {
  // SCRAP statüsündeki rulolar — updatedAt range içinde (status değişimi proxy'si)
  const dailyRows = await prisma.$queryRaw<
    Array<{ day: Date; count: bigint; qty: number | null }>
  >(Prisma.sql`
    SELECT
      DATE_TRUNC('day', r."updatedAt")::date AS day,
      COUNT(*)                               AS count,
      SUM(r."currentQty")::float             AS qty
    FROM rolls r
    WHERE r.status = 'SCRAP'
      AND r."updatedAt" >= ${range.from} AND r."updatedAt" <= ${range.to}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  // Tambur tarafından "CUT" (hata parçası kesildi/scrap) kararı verilen hatalar → defect kırılımı
  const defectRows = await prisma.$queryRaw<
    Array<{ defectName: string; count: bigint }>
  >(Prisma.sql`
    SELECT
      COALESCE(dt.name, re."errorType", 'Bilinmiyor') AS "defectName",
      COUNT(*)                                         AS count
    FROM roll_errors re
    LEFT JOIN defect_types dt ON re."defectTypeId" = dt.id
    WHERE re."actionTaken" = 'CUT'
      AND re."processedAt" >= ${range.from} AND re."processedAt" <= ${range.to}
    GROUP BY COALESCE(dt.name, re."errorType", 'Bilinmiyor')
    ORDER BY count DESC
    LIMIT 20
  `);

  const totalScrapRolls = dailyRows.reduce((acc, r) => acc + Number(r.count), 0);
  const totalScrapQty = dailyRows.reduce((acc, r) => acc + Number(r.qty ?? 0), 0);

  return {
    totalScrapRolls,
    totalScrapQty: Math.round(totalScrapQty * 10) / 10,
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
      qty: Math.round(Number(r.qty ?? 0) * 10) / 10,
    })),
    byDefect: defectRows.map((r) => ({
      defectName: r.defectName,
      count: Number(r.count),
    })),
  };
}
