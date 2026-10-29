import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { putWorkOrderTargetValues, type DeliveryNoteGramajSuggestion } from "@/lib/kursun-gramaj";

interface Props {
  suggestion: DeliveryNoteGramajSuggestion;
  workOrderId: string;
  /** Hedef yazılabiliyorsa çeşit özelliği; null → "Uygula" çizilmez (öneri yalnız bilgi). */
  propertyId: string | null;
  currentValueId: string | null;
}

/**
 * Gelen belgeden hedef gramaj önerisi (H9b). Öneri DEĞER YAZMAZ: "Uygula" kartın "Hedefi değiştir"
 * diyaloğuyla AYNI uca (PUT target-values) gider. Toplar farklı gramaja işaret ediyorsa öneri yok, liste.
 */
export function DeliveryNoteGramajHint({ suggestion, workOrderId, propertyId, currentValueId }: Props) {
  const qc = useQueryClient();
  const s = suggestion.suggested;
  const apply = useMutation({
    mutationFn: (valueId: string) => putWorkOrderTargetValues(workOrderId, [{ propertyId: propertyId as string, valueId }]),
    onSuccess: (r) => {
      toast.success(r.changed ? "Hedef gramaj gelen belgeye göre güncellendi" : "Hedef zaten aynı");
      void qc.invalidateQueries({ queryKey: ["process-summary"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
  // Sayıya göre değişen ek yerine kesir: "3/3 top gelen belgeli".
  const coverage = `${suggestion.coveredRollCount}/${suggestion.rollCount} top gelen belgeli`;

  return (
    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200" data-testid="delivery-note-gramaj">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        {s ? (
          <span>
            Gelen belge önerisi: <span className="font-semibold">{s.valueName}</span>
            <span className="ml-2 text-xs opacity-80">({coverage})</span>
          </span>
        ) : (
          <span>
            Gelen belgelerde tek gramaj yok — öneri verilmedi
            <span className="ml-2 text-xs opacity-80">({coverage})</span>
          </span>
        )}
        {s && propertyId && s.valueId !== currentValueId && (
          <PermissionGate permission="workorder:write">
            <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={apply.isPending} onClick={() => apply.mutate(s.valueId)}>
              {apply.isPending ? "Uygulanıyor..." : "Uygula"}
            </Button>
          </PermissionGate>
        )}
        {s && s.valueId === currentValueId && <span className="ml-auto text-xs opacity-80">Hedefle aynı</span>}
      </div>
      {(suggestion.variants ?? []).length > 0 && (
        // Kurşun dışı çeşitler (D4-D1) yalnız bilgi: hedefe uygulama gelen belgeden iş emri akışının işi (D4-D2).
        <ul className="mt-2 space-y-1 text-xs" data-testid="delivery-note-variants">
          {suggestion.variants!.map((v) => (
            <li key={v.propertyId} className="flex flex-wrap gap-x-2" data-property={v.propertyId}>
              <span className="opacity-80">{v.propertyName}:</span>
              {v.suggested ? (
                <span className="font-semibold">{v.suggested.valueName}</span>
              ) : (
                <span>
                  öneri yok
                  {v.entries.some((e) => e.valueId) && (
                    <span className="opacity-80"> ({v.entries.filter((e) => e.valueId).map((e) => `${e.valueName} · ${e.rollCount} top`).join(", ")})</span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!s && (
        <ul className="mt-2 space-y-1 text-xs">
          {suggestion.entries.map((e) => (
            <li key={`${e.valueId ?? "-"}:${e.processText ?? ""}`} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{e.valueName ?? "Gramaj okunamadı"}</span>
              {e.processText && <span className="min-w-0 break-words opacity-80">“{e.processText}”</span>}
              <span className="ml-auto tabular-nums">{e.rollCount} top</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
