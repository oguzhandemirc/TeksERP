// =============================================================================
// LEVENT FORMU — işin çözgü katmanları (Seyitoğlu SY-B2): her çözgü için levent önerisi
// =============================================================================
// Yalnız YENİ levent ve seçili işin ürününde ek katman varken görünür; "Bu çözgü" tek sefer çözgü
// kartını yazar (alan düzenlenebilir kalır). Yapı sunucunun TEK cevabından (`item-construction`);
// `warpspec:read` + `weavingorder:read` yoksa sorgu atılmaz.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { fetchEffectiveConstruction } from "@/pages/Items/construction-service";
import { weavingOrderService } from "@/pages/Operations/WeavingOrders/service";
import { beamCountSuggested, beamSuggestionsForConstruction } from "./beamLayers";
import type { WarpBeamPlanValues } from "./schema";

export function BeamLayerSuggestions({ form }: { form: UseFormReturn<WarpBeamPlanValues> }) {
  const { hasPermission } = useRoleAccess();
  const canRead = hasPermission("warpspec:read") && hasPermission("weavingorder:read");
  const orderId = form.watch("weavingOrderId");
  const current = form.watch("warpSpecId");
  const wo = useQuery({
    queryKey: ["weaving-orders", "prefill", orderId],
    queryFn: () => weavingOrderService.getById(orderId!),
    enabled: canRead && Boolean(orderId),
  });
  const itemId = wo.data?.data?.itemId;
  const recipeId = wo.data?.data?.recipeId ?? null;
  const c = useQuery({
    queryKey: ["item-construction", itemId, recipeId],
    queryFn: () => fetchEffectiveConstruction(itemId!, recipeId),
    enabled: canRead && Boolean(itemId),
    staleTime: 30_000,
  });
  const list = beamSuggestionsForConstruction(c.data, wo.data?.data?.warpSpec);
  if (!canRead || !orderId || list.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs" data-testid="beam-layer-suggestions">
      <p className="text-sm font-medium">Bu işin çözgüleri — {beamCountSuggested(list)} levent önerilir</p>
      {list.map((s) => (
        <div key={s.warpSpecId} className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-muted-foreground">{s.role}</span>
          <span className="min-w-0 break-words">{s.code} · {s.name}</span>
          {s.kind === "BEAM" ? (
            <Button type="button" size="sm" variant={current === s.warpSpecId ? "secondary" : "outline"} disabled={current === s.warpSpecId}
              onClick={() => form.setValue("warpSpecId", s.warpSpecId, { shouldDirty: true, shouldValidate: true })}>
              {current === s.warpSpecId ? "Seçili" : "Bu çözgü için levent"}
            </Button>
          ) : (
            <span className="text-amber-700 dark:text-amber-400">{s.note}</span>
          )}
        </div>
      ))}
    </div>
  );
}
