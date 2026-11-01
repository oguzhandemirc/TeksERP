// Dokuma iş emri listesinde "Uygun tezgâh" hücresi (SY-M3). Yalnız açık (PLANNED/IN_PROGRESS) işte, satır başı
// önbellekli salt okuma; kapalı işte sorgu atılmaz.
import { useQuery } from "@tanstack/react-query";
import { LoomTierBadge } from "./LoomSuggestionParts";
import { LOOM_SUGGESTION_QUERY_KEY, loomSuggestionService } from "./service";
import { suggestionSummary } from "./types";

export function LoomSuggestionCell({ weavingOrderId, open }: { weavingOrderId: string; open: boolean }) {
  const q = useQuery({
    queryKey: [...LOOM_SUGGESTION_QUERY_KEY, "weaving-order", weavingOrderId],
    queryFn: () => loomSuggestionService.forWeavingOrder(weavingOrderId),
    enabled: open,
    staleTime: 60_000,
  });
  if (!open) return <span className="text-muted-foreground">—</span>;
  if (q.isLoading) return <span className="text-xs text-muted-foreground">…</span>;
  if (!q.data) return <span className="text-muted-foreground">—</span>;
  const s = suggestionSummary(q.data);
  if (!s.tier) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <LoomTierBadge tier={s.tier} />
      <span className="font-mono">{s.text}</span>
    </span>
  );
}
