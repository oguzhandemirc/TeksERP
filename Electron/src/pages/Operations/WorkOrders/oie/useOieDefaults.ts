// Belgeden İE ön seçimi (K22): rotanın istasyonları için sunucu çözücüsü (`/api/station-capabilities/default-targets`),
// müşteri başına bir sorgu. Panel kural YAZMAZ: gramajı forma, formda alanı olmayan seçimleri gövdeye aynen taşır.
import { useCallback, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchStationDefaultTargets, type DefaultTarget, type DefaultTargetsByStation } from "@/lib/station-default-targets";
import { routeService } from "@/pages/Routes/service";

/** Rota sırasında ilk adımın hedefi kazanır (sunucu `mergeRouteDefaults` ile aynı sıra). */
export function flattenRouteTargets(byStation: DefaultTargetsByStation, stationIds: readonly string[]): DefaultTarget[] {
  const seen = new Set<string>();
  const out: DefaultTarget[] = [];
  for (const id of stationIds) {
    for (const t of byStation[id] ?? []) {
      if (seen.has(t.propertyId)) continue;
      seen.add(t.propertyId);
      out.push(t);
    }
  }
  return out;
}

/** `undefined` = cevap henüz yok (çağıran bekler); `null` = ön seçim yok (uç/rota okunamadı). */
export type TargetsFor = (customerId: string | null) => readonly DefaultTarget[] | null | undefined;

export function useOieDefaultTargets(routeId: string, customerIds: readonly (string | null)[]): TargetsFor {
  const route = useQuery({
    queryKey: ["route", routeId, "oie-default-targets"],
    queryFn: () => routeService.getById(routeId),
    staleTime: 60_000,
    retry: false,
  });
  const stationIds = useMemo(() => {
    const steps = [...(route.data?.data?.steps ?? [])].sort((a, b) => a.sequence - b.sequence);
    return [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
  }, [route.data]);
  // Değerle kararlı anahtar: çağıran her render'da yeni dizi verse de sorgular yeniden doğmaz.
  const customerKey = [...new Set(customerIds.map((c) => c ?? ""))].sort().join("\u0000");
  const customers = useMemo(() => customerKey.split("\u0000"), [customerKey]);
  const results = useQueries({
    queries: customers.map((c) => ({
      queryKey: ["station-capabilities", "default-targets", [...stationIds].sort().join(","), c],
      queryFn: () => fetchStationDefaultTargets(stationIds, c || null),
      enabled: stationIds.length > 0,
      staleTime: 60_000,
      retry: false,
    })),
  });
  const routeDead = route.isError || (route.isSuccess && stationIds.length === 0);
  const dataKey = results.map((r) => r.dataUpdatedAt + ":" + r.errorUpdatedAt).join("|");
  return useCallback<TargetsFor>(
    (customerId) => {
      if (routeDead) return null;
      const i = customers.indexOf(customerId ?? "");
      const r = i >= 0 ? results[i] : undefined;
      if (r?.isError) return null;
      return r?.data ? flattenRouteTargets(r.data, stationIds) : undefined;
    },
    // `dataKey` sorgu sonuçlarının değişimini taşır (dizi kimliği her render'da yenilenir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeDead, customers, stationIds, dataKey],
  );
}
