import { useQueries, useQuery } from "@tanstack/react-query";
import { customReportApi } from "../custom-api";

const keyOf = (kup: string, measure: string, dim: string) => ["semantic-dimension-values", kup, measure, dim] as const;
const STALE_MS = 5 * 60_000;

/** Süzgeç değer seçicisinin seçenekleri: sunucunun kırılım sorgusundan (istemci değer uydurmaz). */
export function useDimensionOptions(kup: string, measure: string | undefined, dim: string, enabled: boolean) {
  return useQuery({
    queryKey: keyOf(kup, measure ?? "", dim),
    queryFn: () => customReportApi.dimensionValues(kup, measure!, dim),
    enabled: enabled && Boolean(measure && dim),
    staleTime: STALE_MS,
    retry: false,
  });
}

/** Cümle/çip etiketleri: alanların değer listeleri tek seferde; bilinmeyen değer olduğu gibi görünür. */
export function useValueLabels(kup: string | undefined, measure: string | undefined, dims: readonly string[]) {
  const unique = [...new Set(dims)];
  const results = useQueries({
    queries: unique.map((d) => ({
      queryKey: keyOf(kup ?? "", measure ?? "", d),
      queryFn: () => customReportApi.dimensionValues(kup!, measure!, d),
      enabled: Boolean(kup && measure),
      staleTime: STALE_MS,
      retry: false,
    })),
  });
  const maps = new Map(unique.map((d, i) => [d, new Map((results[i]?.data ?? []).map((o) => [o.deger, o.etiket]))]));
  return (dim: string, value: string) => maps.get(dim)?.get(value) ?? value;
}
