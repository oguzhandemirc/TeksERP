import { useQuery } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { deviceService } from "./service";
import type { MergeCandidateGroup, MergeConfidence, MergePreviewSource } from "./types";

export const MERGE_CANDIDATES_QUERY_KEY = "admin-device-merge-candidates";

/** Kopya adayları (D4). Eski backend 404 → `null` (şerit gizli). Sezgi yalnız ÖNERİDİR. */
export function useMergeCandidates() {
  const { hasPermission } = useRoleAccess();
  return useQuery({
    queryKey: [MERGE_CANDIDATES_QUERY_KEY],
    queryFn: deviceService.mergeCandidates,
    enabled: hasPermission("admin:settings"),
    retry: false,
    staleTime: 60_000,
  });
}

export const CONFIDENCE_LABEL: Record<MergeConfidence, string> = { HIGH: "yüksek", MEDIUM: "orta", LOW: "düşük" };

/** Varsayılan seçim: düşük güven SEÇİLİ DEĞİL (yanlış pozitif ölçüldü); engelli kaynak hiç seçilmez. */
export function defaultMergeSelection(
  group: MergeCandidateGroup,
  preview?: MergePreviewSource[] | null,
): Set<string> {
  const blocked = new Set((preview ?? []).filter((s) => s.blockers.length > 0).map((s) => s.id));
  return new Set(group.sources.filter((s) => s.confidence !== "LOW" && !blocked.has(s.id)).map((s) => s.id));
}
