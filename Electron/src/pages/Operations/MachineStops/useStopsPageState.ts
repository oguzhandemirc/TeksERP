// =============================================================================
// SAYFA DURUMU — URL süzgeçleri (FilterBar `filter[*]`) · vardiya seçenekleri · satır eylemleri
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { machineService } from "@/pages/Machines/service";
import type { StopListParams } from "./service";
import type { StopActions } from "./StopRowMenu";
import type { MachineStop } from "./types";

const SCOPE_OPTIONS = [
  { value: "queue", label: "Sınıflandırma kuyruğu (sebep bekleyen)" },
  { value: "open", label: "Yalnız açık duruşlar" },
  { value: "pendingEnd", label: "Geçici kapanışlar (gerçek bitiş bekleyen)" },
];

/** Gün süzgecinden muaf kapsamlar: borç/bekleyen bitiş hangi günden olursa olsun görünmeli. */
const DAY_FREE_SCOPES = new Set(["queue", "pendingEnd"]);

/** URL süzgeçleri → liste parametreleri (saf; süzme sunucuda). */
export function stopListParamsOf(f: { machineId: string; scope: string; shiftInstanceId: string; day: string }): StopListParams {
  return {
    machineId: f.machineId || undefined,
    factoryDay: DAY_FREE_SCOPES.has(f.scope) ? undefined : f.day,
    shiftInstanceId: f.shiftInstanceId || undefined,
    queue: f.scope === "queue",
    open: f.scope === "open",
    pendingEnd: f.scope === "pendingEnd",
  };
}

export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Kuyruk ve geçici kapanışlar GÜN süzgecinin dışındadır (`DAY_FREE_SCOPES`). */
export function useStopListParams(day: string): { params: StopListParams; dayFree: boolean } {
  const [sp] = useSearchParams();
  const machineId = sp.get("filter[machineId]") ?? "";
  const scope = sp.get("filter[scope]") ?? "";
  const shiftInstanceId = sp.get("filter[shiftInstanceId]") ?? "";
  const params = useMemo(() => stopListParamsOf({ machineId, scope, shiftInstanceId, day }), [machineId, scope, shiftInstanceId, day]);
  return { params, dayFree: DAY_FREE_SCOPES.has(scope) };
}

/** Vardiya seçenekleri o günün satırlarından türer (vardiya listesi ucu yok; süzme yine sunucuda). */
export function useStopFilters(rows: MachineStop[]): FilterDef[] {
  return useMemo(() => {
    const shifts = new Map<string, string>();
    for (const r of rows) if (r.shiftInstance) shifts.set(r.shiftInstance.id, r.shiftInstance.shiftDefinition.name);
    return [
      { kind: "lookup", key: "machineId", label: "Tezgah", service: machineService, queryKey: "machines-stops-filter" },
      { kind: "select", key: "scope", label: "Kapsam", options: SCOPE_OPTIONS },
      { kind: "select", key: "shiftInstanceId", label: "Vardiya", options: [...shifts].map(([value, label]) => ({ value, label })) },
    ];
  }, [rows]);
}

export type DialogState =
  | { kind: "entry" }
  | { kind: "classify" | "reclassify" | "close" | "revoke" | "ledger"; target: MachineStop }
  | null;

export function useStopActions(setDialog: (d: DialogState) => void): StopActions {
  return useMemo(
    () => ({
      onClassify: (t: MachineStop) => setDialog({ kind: "classify", target: t }),
      onReclassify: (t: MachineStop) => setDialog({ kind: "reclassify", target: t }),
      onLedger: (t: MachineStop) => setDialog({ kind: "ledger", target: t }),
      onClose: (t: MachineStop) => setDialog({ kind: "close", target: t }),
      onRevoke: (t: MachineStop) => setDialog({ kind: "revoke", target: t }),
    }),
    [setDialog],
  );
}
