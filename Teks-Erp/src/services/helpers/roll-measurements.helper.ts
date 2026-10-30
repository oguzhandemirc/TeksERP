// =============================================================================
// TOP ÖLÇÜM GEÇMİŞİ — top izine (GET /api/rolls/:id/history) EKLEMELİ `measurements` alanı (D4-B4, DALGA4 §3.8)
// =============================================================================
// Panel top kartında metre okumalarını (kurşun IN/OUT · Tambur CUT) ölçüm kaynağıyla ve sapma defterini
// (`RollVariance.measureSource`) gösterir; düzeltilmiş okuma silinmez, damgalı satır olarak listelenir.
// Salt-okuma; eski istemci alanı yok sayar.
// =============================================================================
import prisma from "../../lib/prisma";

export interface RollMeterReadingView {
  id: string;
  phase: string;
  meters: number;
  /** MachineDataSource — MACHINE · OPERATOR · SUPERVISOR · SIMULATED · INFERRED. */
  source: string;
  stepId: string;
  stationName: string | null;
  machineName: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface RollVarianceView {
  id: string;
  kind: string;
  qty: number;
  /** Sapmayı doğuran YOL (`VarianceSource`) — ölçüm kaynağı DEĞİL. */
  source: string;
  /** Sapmanın zayıf halka ölçüm kaynağı; NULL = bilinmiyor (eski kayıt / kaynaksız tablet). */
  measureSource: string | null;
  reasonCode: string | null;
  createdAt: string;
  reversedAt: string | null;
}

export interface RollMeasurements {
  readings: RollMeterReadingView[];
  variances: RollVarianceView[];
}

const userName = (u: { fullName: string | null; username: string } | null) => (u ? u.fullName || u.username : null);

/** Topun bütün metre okumaları (damgalılar dahil) ve sapma satırları — kronolojik (`createdAt`, eşitlikte `id`). */
export async function readRollMeasurements(rollId: string): Promise<RollMeasurements> {
  const [readings, variances] = await Promise.all([
    prisma.rollMeterReading.findMany({
      where: { rollId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, phase: true, meters: true, source: true, workOrderStepId: true, createdAt: true, revokedAt: true, revokeReason: true,
        step: { select: { station: { select: { name: true } } } },
        machine: { select: { name: true } },
        createdBy: { select: { fullName: true, username: true } },
      },
    }),
    prisma.rollVariance.findMany({
      where: { rollId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, qty: true, source: true, measureSource: true, reasonCode: true, createdAt: true, reversedAt: true },
    }),
  ]);
  return {
    readings: readings.map((r) => ({
      id: r.id,
      phase: r.phase,
      meters: Number(r.meters),
      source: r.source,
      stepId: r.workOrderStepId,
      stationName: r.step.station.name,
      machineName: r.machine?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      createdByName: userName(r.createdBy),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokeReason: r.revokeReason,
    })),
    variances: variances.map((v) => ({
      id: v.id,
      kind: v.kind,
      qty: Number(v.qty),
      source: v.source,
      measureSource: v.measureSource,
      reasonCode: v.reasonCode,
      createdAt: v.createdAt.toISOString(),
      reversedAt: v.reversedAt?.toISOString() ?? null,
    })),
  };
}
