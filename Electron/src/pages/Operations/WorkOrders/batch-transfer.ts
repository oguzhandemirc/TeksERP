import type { StepRollItem, WorkOrderStepLite } from "./types";

/** Parti ⋯ menüsündeki "Sonraki Fasona Aktar" için çözülen bağlam. */
export interface BatchTransferContext {
  /** Kaynak fason adımı (partinin fasonda bekleyen toplarının adımı). */
  stepId: string;
  stationName: string;
  nextStationName: string;
  /** Sonraki fason adımına firma planlanmış mı (yoksa madde disabled). */
  nextPlanned: boolean;
  /** Partinin o adımda AT_SUBCONTRACTOR bekleyen topları (seçim modalına gider). */
  rolls: StepRollItem[];
}

/**
 * Partinin fasonda (AT_SUBCONTRACTOR) bekleyen topları hangi fason adımında ve
 * HEMEN sonraki adım fason mu — parti ⋯ menüsündeki "Sonraki Fasona Aktar" gating'i.
 * getById adım listesi top başına `batchNumber` taşıdığından (StepRollItem) lane
 * payload'ını genişletmeye gerek kalmaz. Kural FasonStepActions ile birebir:
 * yalnız sıradaki adım EXTERNAL ise aktarım sunulur (araya iç adım giriyorsa
 * desteklenen yol Fason Kabul → Konumu Düzelt → Sevk Et'tir).
 */
export function findBatchTransferContext(
  steps: WorkOrderStepLite[] | undefined,
  batchNumber: string,
): BatchTransferContext | null {
  if (!steps || steps.length === 0) return null;
  const sorted = [...steps].sort((a, b) => a.stepSequence - b.stepSequence);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (!s || s.station?.type !== "EXTERNAL") continue;
    const rolls = (s.currentRollList ?? []).filter(
      (r) => r.status === "AT_SUBCONTRACTOR" && r.batchNumber === batchNumber,
    );
    if (rolls.length === 0) continue;
    const next = sorted[i + 1];
    if (!next || next.station?.type !== "EXTERNAL") return null;
    return {
      stepId: s.id,
      stationName: s.station?.name ?? "Fason",
      nextStationName: next.station?.name ?? "sonraki fason",
      nextPlanned: Boolean(next.plannedSubcontractorId),
      rolls,
    };
  }
  return null;
}
