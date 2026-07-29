// =============================================================================
// Etiket Stüdyosu — bakım sembolü kataloğu (backend GET /api/label-templates/icons)
// =============================================================================
// Katalog statiktir (kod-tanımlı registry) → staleTime Infinity, tek fetch.
// Palet (grid) + kanvas görseli (byKey) + özellik paneli buradan beslenir.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  labelTemplateService,
  type LabelIconCategory,
  type LabelIconInfo,
} from "@/services/labelTemplateService";

export interface IconCatalog {
  categories: LabelIconCategory[];
  icons: LabelIconInfo[];
  /** key → ikon (kanvasta O(1) svg erişimi). */
  byKey: Map<string, LabelIconInfo>;
  isLoading: boolean;
  isError: boolean;
}

export function useIconCatalog(): IconCatalog {
  const q = useQuery({
    queryKey: ["label-icons"],
    queryFn: () => labelTemplateService.iconCatalog(),
    staleTime: Infinity,
  });
  const byKey = useMemo(
    () => new Map((q.data?.icons ?? []).map((i) => [i.key, i] as const)),
    [q.data],
  );
  return {
    categories: q.data?.categories ?? [],
    icons: q.data?.icons ?? [],
    byKey,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}
