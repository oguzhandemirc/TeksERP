// =============================================================================
// İSTASYON TÜRÜ KAPSAMLI DURUŞ SEBEPLERİ — sınıflama listesi (2026-11-09)
// =============================================================================
// Sunucu kapsam dışı sebebi 400 `STOP_REASON_OUT_OF_SCOPE` ile reddeder; liste her tür için SUNUCUDAN
// süzülmüş ister (`?stationKind=`). Birden çok tür seçiliyse yalnız HEPSİNE uyan sebepler (kesişim) kalır —
// sunucu her satırı ayrı denetlediği için listede görünen sebep hiçbir satırda reddedilmez.
// Tür bilinmiyorsa (eski sunucu DTO'su `machine.station` taşımaz) bugünkü tam aktif liste döner.
// =============================================================================
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { reasonPresetService, type ReasonPreset } from "@/pages/ReasonPresets/service";
import type { StationKind } from "@/types/enums";

/** İlk listenin sırasını koruyarak bütün listelerde bulunan sebepler (kod ile). Liste yoksa boş. */
export function intersectScopedPresets(lists: readonly (readonly ReasonPreset[])[]): ReasonPreset[] {
  if (lists.length === 0) return [];
  const rest = lists.slice(1).map((l) => new Set(l.map((p) => p.code)));
  return lists[0]!.filter((p) => p.isActive && rest.every((s) => s.has(p.code)));
}

/** Tekrarsız, boş olmayan türler — sabit sıra (sorgu anahtarı kararlı kalsın). */
export function distinctStationKinds(kinds: readonly (StationKind | null | undefined)[]): StationKind[] {
  return [...new Set(kinds.filter((k): k is StationKind => !!k))].sort();
}

function combineScoped(rs: readonly { isLoading: boolean; data?: ReasonPreset[] }[]) {
  return { isLoading: rs.some((r) => r.isLoading), presets: rs.every((r) => r.data) ? intersectScopedPresets(rs.map((r) => r.data!)) : [] };
}

/**
 * `kinds` duruşların istasyon türleri; herhangi biri bilinmiyorsa (eski sunucu) `fallback` (tam aktif liste) döner —
 * sunucu yine de kapsamı denetler.
 */
export function useScopedStopReasons(kinds: readonly (StationKind | null | undefined)[], fallback: readonly ReasonPreset[]) {
  const known = kinds.length > 0 && kinds.every((k) => !!k);
  const distinct = useMemo(() => (known ? distinctStationKinds(kinds) : []), [known, kinds]);
  // Modül düzeyi `combine`: kararlı referans, sonuç veri değişmedikçe yeniden hesaplanmaz.
  const scoped = useQueries({
    queries: distinct.map((k) => ({
      queryKey: ["reason-presets", "MACHINE_STOP", "station-kind", k],
      queryFn: () => reasonPresetService.listStopReasonsFor(k),
      staleTime: 5 * 60_000,
    })),
    combine: combineScoped,
  });
  const presets = useMemo<ReasonPreset[]>(() => (distinct.length === 0 ? [...fallback] : scoped.presets), [distinct.length, fallback, scoped.presets]);
  const isLoading = distinct.length > 0 && scoped.isLoading;
  return { presets, isLoading };
}
