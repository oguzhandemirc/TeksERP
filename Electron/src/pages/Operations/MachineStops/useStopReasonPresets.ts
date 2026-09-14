// =============================================================================
// DURUŞ SEBEBİ KATALOĞU — `MACHINE_STOP` aktif satırlar (kod → etiket)
// =============================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { reasonPresetService, type ReasonPreset } from "@/pages/ReasonPresets/service";

export function useStopReasonPresets() {
  const q = useQuery({ queryKey: ["reason-presets", "MACHINE_STOP", "stops-page"], queryFn: () => reasonPresetService.list(true), staleTime: 5 * 60_000 });
  const presets = useMemo<ReasonPreset[]>(() => (q.data ?? []).filter((p) => p.kind === "MACHINE_STOP"), [q.data]);
  const active = useMemo(() => presets.filter((p) => p.isActive), [presets]);
  const labelOf = useMemo(() => {
    const m = new Map(presets.map((p) => [p.code, p.label] as const));
    return (code: string | null): string => (code ? (m.get(code) ?? code) : "—");
  }, [presets]);
  return { active, labelOf, isLoading: q.isLoading };
}
