// =============================================================================
// ATANAN KURŞUN MAKİNESİ — tek kaynak (K16, fabrika cevabı 21-ek, 2026-11-03)
// =============================================================================
// Soru: "bu tabletin (oturum makinesinin) kurşun listesinde bu iş görünür mü / okutunca uyarı çıkar mı?"
// Ayar `kursun.machineAssignMode`:
//   · SUGGEST (varsayılan, bugünkü): planlı makine yalnız öneri — süzgeç yok, uyarı yok (K5).
//   · ASSIGNED_ONLY_WARN: iş yalnız planlı makinesinde ya da makinesi atanmamışsa listede; başka makine
//     okutursa uyarı + "yine de al" (engel YOK; fiilî makine oturumdan yazılır, bugünkü gibi).
// Oturum makinesi bilinmiyorsa (web, makinesiz oturum, eski cihaz) süzgeç ve uyarı yok — bugünkü davranış.
// Bellek-içi yüklem (`foreignMachineOf`) ile Prisma parçası (`assignedMachineListWhere`) boğaz-ikizidir.
// =============================================================================
import type { Prisma } from "@prisma/client";
import type { KursunMachineAssignMode } from "../system-setting.service";

/** Listede süzgeç uygulanır mı: yalnız ASSIGNED_ONLY_WARN + bilinen oturum makinesi. */
function filters(mode: KursunMachineAssignMode, sessionMachineId: string | null | undefined): sessionMachineId is string {
  return mode === "ASSIGNED_ONLY_WARN" && typeof sessionMachineId === "string" && sessionMachineId.length > 0;
}

/** Tablet açık iş listesi parçası: planlı makine NULL ya da oturum makinesi; süzgeç yoksa boş parça. */
export function assignedMachineListWhere(
  mode: KursunMachineAssignMode,
  sessionMachineId: string | null | undefined,
): Prisma.WorkOrderStepWhereInput {
  if (!filters(mode, sessionMachineId)) return {};
  return { OR: [{ plannedMachineId: null }, { plannedMachineId: sessionMachineId }] };
}

export interface ForeignMachine {
  plannedMachineId: string;
  plannedMachineName: string;
}

/** Okutulan adım başka makineye mi atanmış (listede görünmeyecek iş) — öyleyse uyarı yükü, değilse null. */
export function foreignMachineOf(
  mode: KursunMachineAssignMode,
  sessionMachineId: string | null | undefined,
  step: { plannedMachineId: string | null; plannedMachine: { name: string } | null; status: string },
): ForeignMachine | null {
  if (!filters(mode, sessionMachineId)) return null;
  if (step.status === "COMPLETED" || !step.plannedMachineId || step.plannedMachineId === sessionMachineId) return null;
  return { plannedMachineId: step.plannedMachineId, plannedMachineName: step.plannedMachine?.name ?? "başka bir" };
}
