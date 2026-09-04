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
import { factoryDaySql } from "../../constants/time";

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
    qualityGrade: string | null;
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
      qualityGrade: roll.qualityGrade ?? "",
      initialQty: Number(roll.initialQty),
      currentQty: Number(roll.currentQty),
      width: roll.width !== null ? Number(roll.width) : null,
    },
    events,
  };
}
