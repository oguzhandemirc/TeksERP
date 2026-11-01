// SY-M3: Salon "İş ver" diyaloğunda seçili tezgâhların seçilen işe uygunluğu (rozet + öneri sırası). Salt okuma,
// sıralamadır — önizleme/başlatma akışını değiştirmez. Kapı çağıranda (`gates.loomSuggestionVisible`).
import { useQuery } from "@tanstack/react-query";
import { LoomTierBadge, WidthWarningBadge } from "@/pages/Operations/WeavingOrders/loom-suggestion/LoomSuggestionParts";
import { LOOM_SUGGESTION_QUERY_KEY, loomSuggestionService } from "@/pages/Operations/WeavingOrders/loom-suggestion/service";
import { candidateDetail, candidatesByMachine, orderByFit } from "@/pages/Operations/WeavingOrders/loom-suggestion/types";
import type { LiveLoom } from "../types";

export function LoomFitList({ looms, weavingOrderId }: { looms: readonly LiveLoom[]; weavingOrderId: string }) {
  const q = useQuery({
    queryKey: [...LOOM_SUGGESTION_QUERY_KEY, "weaving-order", weavingOrderId],
    queryFn: () => loomSuggestionService.forWeavingOrder(weavingOrderId),
    staleTime: 30_000,
  });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Tezgâh uygunluğu hesaplanıyor…</p>;
  if (!q.data) return null;
  const byId = candidatesByMachine(q.data);
  return (
    <div className="space-y-1 rounded-md border p-2" aria-label="Tezgâh uygunluğu">
      <p className="text-xs font-medium">Tezgâh uygunluğu (öneri sırası)</p>
      <ul className="space-y-1">
        {orderByFit(looms, q.data).map((l) => {
          const c = byId.get(l.id);
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
              {c ? <LoomTierBadge tier={c.tier} /> : <span className="text-muted-foreground">—</span>}
              <span className="font-mono font-medium">{l.code}</span>
              {c && <span className="text-muted-foreground">{candidateDetail(c)}</span>}
              {c?.widthWarning && <WidthWarningBadge />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
