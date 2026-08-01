// =============================================================================
// TeksERP - Quality Reports
// =============================================================================
// 4 alt-rapor: hata türü dağılımı, istasyon hata oranı, QC2 (Tambur) kararları,
// Kurşun uygulama oranı.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { factoryDaySql } from "../../constants/time";

// ---------- 1) Defect Distribution -------------------------------------------

export interface DefectDistributionRow {
  defectName: string;
  count: number;
  processedCount: number;
  scrapCount: number;
  keptAsA1Count: number;
  noActionCount: number;
}

export async function getDefectDistribution(range: DateRange): Promise<DefectDistributionRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      defectName: string;
      count: bigint;
      processedCount: bigint;
      scrapCount: bigint;
      keptAsA1Count: bigint;
      noActionCount: bigint;
    }>
  >(Prisma.sql`
    SELECT
      COALESCE(dt.name, re."errorType", 'Bilinmiyor')      AS "defectName",
      COUNT(*)                                              AS count,
      COUNT(*) FILTER (WHERE re."isProcessed")              AS "processedCount",
      COUNT(*) FILTER (WHERE re."actionTaken" = 'CUT')    AS "scrapCount",
      COUNT(*) FILTER (WHERE re."actionTaken" = 'NO_CUT') AS "keptAsA1Count",
      COUNT(*) FILTER (WHERE re."actionTaken" IS NULL)    AS "noActionCount"
    FROM roll_errors re
    LEFT JOIN defect_types dt ON re."defectTypeId" = dt.id
    WHERE re."detectedAt" >= ${range.from} AND re."detectedAt" <= ${range.to}
    GROUP BY COALESCE(dt.name, re."errorType", 'Bilinmiyor')
    ORDER BY count DESC
    LIMIT 50
  `);

  return rows.map((r) => ({
    defectName: r.defectName,
    count: Number(r.count),
    processedCount: Number(r.processedCount),
    scrapCount: Number(r.scrapCount),
    keptAsA1Count: Number(r.keptAsA1Count),
    noActionCount: Number(r.noActionCount),
  }));
}

// ---------- 2) Station Defect Rate -------------------------------------------

export interface StationDefectRateRow {
  stationId: string;
  stationName: string;
  stationKind: string;
  throughputRolls: number;
  defectCount: number;
  defectsPerRoll: number;
}

export async function getStationDefectRate(range: DateRange): Promise<StationDefectRateRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      stationId: string;
      stationName: string;
      stationKind: string;
      throughput: bigint;
      defects: bigint;
    }>
  >(Prisma.sql`
    WITH station_throughput AS (
      SELECT s.id AS station_id, COUNT(DISTINCT rm."rollId") AS rolls
      FROM roll_movements rm
      JOIN work_order_steps wos ON rm."workOrderStepId" = wos.id
      JOIN stations s           ON wos."stationId" = s.id
      WHERE rm."enteredAt" >= ${range.from} AND rm."enteredAt" <= ${range.to}
      GROUP BY s.id
    ),
    station_defects AS (
      SELECT s.id AS station_id, COUNT(*) AS defects
      FROM roll_errors re
      JOIN work_order_steps wos ON re."detectedAtStepId" = wos.id
      JOIN stations s           ON wos."stationId" = s.id
      WHERE re."detectedAt" >= ${range.from} AND re."detectedAt" <= ${range.to}
      GROUP BY s.id
    )
    SELECT
      s.id           AS "stationId",
      s.name         AS "stationName",
      s.kind::text   AS "stationKind",
      COALESCE(st.rolls, 0)   AS throughput,
      COALESCE(sd.defects, 0) AS defects
    FROM stations s
    LEFT JOIN station_throughput st ON st.station_id = s.id
    LEFT JOIN station_defects   sd ON sd.station_id = s.id
    WHERE COALESCE(st.rolls, 0) > 0 OR COALESCE(sd.defects, 0) > 0
    ORDER BY defects DESC, s.name
  `);

  return rows.map((r) => {
    const throughput = Number(r.throughput);
    const defects = Number(r.defects);
    return {
      stationId: r.stationId,
      stationName: r.stationName,
      stationKind: r.stationKind,
      throughputRolls: throughput,
      defectCount: defects,
      defectsPerRoll: throughput > 0 ? Math.round((defects / throughput) * 1000) / 1000 : 0,
    };
  });
}

// ---------- 3) QC2 / Tambur Decisions ----------------------------------------

export interface Qc2DecisionsSummary {
  totalProcessed: number; // RollOperation TAMBUR_PROCESSED
  decisions: { action: string; count: number }[];
  totalErrorsClosed: number;
  scrapClosed: number;
  keptAsA1: number;
  noAction: number;
}

export async function getQc2Decisions(range: DateRange): Promise<Qc2DecisionsSummary> {
  const decisionsRows = await prisma.$queryRaw<
    Array<{ action: string; count: bigint }>
  >(Prisma.sql`
    SELECT
      COALESCE(re."actionTaken"::text, 'NO_ACTION') AS action,
      COUNT(*)                                      AS count
    FROM roll_errors re
    WHERE re."isProcessed" = true
      AND re."processedAt" >= ${range.from} AND re."processedAt" <= ${range.to}
    GROUP BY COALESCE(re."actionTaken"::text, 'NO_ACTION')
    ORDER BY count DESC
  `);

  const tamburProcessedRow = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total
    FROM roll_operations ro
    WHERE ro."operationType" = 'TAMBUR_PROCESSED'
      AND ro."createdAt" >= ${range.from} AND ro."createdAt" <= ${range.to}
      AND ro."inheritedFromParentRollId" IS NULL
  `);

  const decisions = decisionsRows.map((r) => ({ action: r.action, count: Number(r.count) }));
  const totalErrorsClosed = decisions.reduce((a, r) => a + r.count, 0);

  return {
    totalProcessed: Number(tamburProcessedRow[0]?.total ?? 0),
    decisions,
    totalErrorsClosed,
    // RollErrorAction enum CUT|NO_CUT (eski CUT_FOR_SCRAP/KEPT_AS_A1/NO_ACTION kaldırıldı):
    // CUT=hata parçası kesildi (scrap), NO_CUT=hataya rağmen tutuldu, NULL=işlenmemiş.
    scrapClosed: decisions.find((d) => d.action === "CUT")?.count ?? 0,
    keptAsA1: decisions.find((d) => d.action === "NO_CUT")?.count ?? 0,
    noAction: decisions.find((d) => d.action === "NO_ACTION")?.count ?? 0,
  };
}

// ---------- 4) Kursun Application Rate ---------------------------------------

export interface KursunApplicationSummary {
  qc2Completed: number;
  kursunApplied: number;
  applicationPct: number;
  daily: { day: string; kursun: number; qc2: number; pct: number }[];
}

export async function getKursunApplication(range: DateRange): Promise<KursunApplicationSummary> {
  // F243: totalsRow KALDIRILDI — total = Σ daily (aynı WHERE ile roll_operations'ı
  // ikinci kez taramaya gerek yok; audit raporu deseni). Tek grup-tarama yeter.
  //
  // GÜN SORUSU = TAKVİM GÜNÜ (fabrika saati). Günlük kurşun/QC2 oranı vardiya
  // performansı okumasıdır. Gün UTC'de kesilseydi gece 00:00–03:00 arası yapılan
  // işlemler bir önceki güne yazılır ve o günün oranını (pay/payda ayrı ayrı
  // kayabildiği için) hem dünü hem bugünü YANLIŞ gösterirdi.
  const dailyRows = await prisma.$queryRaw<
    Array<{ day: Date; qc2: bigint; kursun: bigint }>
  >(Prisma.sql`
    SELECT
      ${factoryDaySql('ro."createdAt"')}      AS day,
      COUNT(*) FILTER (WHERE ro."operationType" = 'QC2_COMPLETED')  AS qc2,
      COUNT(*) FILTER (WHERE ro."operationType" = 'KURSUN_APPLIED') AS kursun
    FROM roll_operations ro
    WHERE ro."createdAt" >= ${range.from} AND ro."createdAt" <= ${range.to}
      AND ro."inheritedFromParentRollId" IS NULL
      AND ro."operationType" IN ('QC2_COMPLETED','KURSUN_APPLIED')
    GROUP BY 1
    ORDER BY 1
  `);

  const qc2 = dailyRows.reduce((a, r) => a + Number(r.qc2), 0);
  const kursun = dailyRows.reduce((a, r) => a + Number(r.kursun), 0);
  const pct = qc2 > 0 ? Math.round((kursun / qc2) * 1000) / 10 : 0;

  return {
    qc2Completed: qc2,
    kursunApplied: kursun,
    applicationPct: pct,
    daily: dailyRows.map((r) => {
      const d_qc2 = Number(r.qc2);
      const d_kursun = Number(r.kursun);
      return {
        day: r.day.toISOString().slice(0, 10),
        kursun: d_kursun,
        qc2: d_qc2,
        pct: d_qc2 > 0 ? Math.round((d_kursun / d_qc2) * 1000) / 10 : 0,
      };
    }),
  };
}
