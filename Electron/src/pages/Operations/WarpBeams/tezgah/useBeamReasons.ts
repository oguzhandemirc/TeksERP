import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { reasonPresetService, type ReasonPresetKind } from "@/pages/ReasonPresets/service";

/** Sebep kataloğu (aktif satırlar, tür süzülmüş) — WARP_BEAM_ADJUST / WARP_BEAM_SCRAP. */
export function useBeamReasons(kind: Extract<ReasonPresetKind, "WARP_BEAM_ADJUST" | "WARP_BEAM_SCRAP">) {
  const q = useQuery({ queryKey: ["reason-presets", kind, "beam"], queryFn: () => reasonPresetService.list(false) });
  return useMemo(() => (q.data ?? []).filter((p) => p.kind === kind && p.isActive).map((p) => ({ code: p.code, label: p.label })), [q.data, kind]);
}
