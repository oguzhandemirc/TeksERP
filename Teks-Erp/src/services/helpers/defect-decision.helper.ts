// Tambursuz rota uyarısı (KQ-D8, K7): adım listesindeki istasyonları okuyup karar
// boşluğunu `quality-station.helper` ikizlerine sorar. Yazma ENGELLENMEZ, yalnız uyarı.
import { StepStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { ApiResponse } from "../../types/api.types";
import { defectDecisionWarning, findDefectDecisionGap } from "./quality-station.helper";

export async function collectDefectDecisionWarnings(
  steps: readonly { stationId: string; skipped?: boolean }[],
): Promise<string[]> {
  const ids = [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
  if (ids.length === 0) return [];
  const stations = await prisma.station.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, kind: true, inspectionEnabled: true },
  });
  const byId = new Map(stations.map((s) => [s.id, s]));
  const gap = findDefectDecisionGap(
    steps.flatMap((s) => {
      const st = byId.get(s.stationId);
      return st ? [{ name: st.name, kind: st.kind, inspectionEnabled: st.inspectionEnabled, skipped: s.skipped }] : [];
    }),
  );
  const w = defectDecisionWarning(gap);
  return w ? [w] : [];
}

/** İş emrinin YAZILMIŞ rotasından (SKIPPED adım karar saymaz) — create ve replace aynı yol. */
export async function collectWorkOrderDecisionWarnings(workOrderId: string): Promise<string[]> {
  const steps = await prisma.workOrderStep.findMany({
    where: { workOrderId },
    orderBy: { stepSequence: "asc" },
    select: { stationId: true, status: true },
  });
  return collectDefectDecisionWarnings(
    steps.map((s) => ({ stationId: s.stationId, skipped: s.status === StepStatus.SKIPPED })),
  );
}

/** Rota şablonu gövdesindeki adımlar (`sequence` sırasıyla); adımsız güncelleme uyarmaz. */
export async function routeDecisionWarnings(
  steps: readonly { stationId?: string; sequence?: number }[] | null,
): Promise<string[]> {
  if (!steps || steps.length === 0) return [];
  const ordered = steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(a.s.sequence ?? a.i) - Number(b.s.sequence ?? b.i) || a.i - b.i)
    .flatMap(({ s }) => (typeof s.stationId === "string" ? [{ stationId: s.stationId }] : []));
  return collectDefectDecisionWarnings(ordered);
}

/** Yanıta engel olmayan notları ekler (mevcut `warnings` korunur). */
export function withWarnings<T>(res: ApiResponse<T>, warnings: readonly string[]): ApiResponse<T> {
  return warnings.length === 0 ? res : { ...res, warnings: [...(res.warnings ?? []), ...warnings] };
}
