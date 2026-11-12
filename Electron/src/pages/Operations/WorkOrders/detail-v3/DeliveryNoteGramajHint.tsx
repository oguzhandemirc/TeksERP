import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { putWorkOrderTargetValues, type DeliveryNoteGramajSuggestion, type VariantTarget } from "@/lib/kursun-gramaj";
import { gramajHintView, variantHintRows, type GramajHintView, type VariantHintRow } from "./deliveryNoteHintModel";

interface Props {
  suggestion: DeliveryNoteGramajSuggestion;
  workOrderId: string;
  /** Hedef yazılabiliyorsa çeşit özelliği; null → "Uygula" çizilmez (öneri yalnız bilgi). */
  propertyId: string | null;
  /** İE'nin aktif kurşun gramajı hedefi (yoksa null). */
  target: { valueId: string; valueName: string } | null;
  /** Kurşun dışı aktif hedefler (desen vb.) — çeşit satırında çelişki ölçümü. */
  variantTargets?: readonly VariantTarget[];
}

/**
 * Gelen belgeden hedef gramaj ipucu (H9b). Ne zaman çizildiği `deliveryNoteHintModel`de: yalnız öneri (hedef yokken),
 * çelişki (belge ≠ hedef) ya da çoklu değer. Öneri DEĞER YAZMAZ: "Uygula" "Hedefi değiştir" ile AYNI uca (PUT target-values).
 */
export function DeliveryNoteGramajHint({ suggestion, workOrderId, propertyId, target, variantTargets = [] }: Props) {
  const qc = useQueryClient();
  const apply = useMutation({
    mutationFn: (valueId: string) => putWorkOrderTargetValues(workOrderId, [{ propertyId: propertyId as string, valueId }]),
    onSuccess: (r) => {
      toast.success(r.changed ? "Hedef gramaj gelen belgeye göre güncellendi" : "Hedef zaten aynı");
      void qc.invalidateQueries({ queryKey: ["process-summary"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
  const view = gramajHintView(suggestion, target);
  const variants = variantHintRows(suggestion, variantTargets);
  if (!view && variants.length === 0) return null;
  // Sayıya göre değişen ek yerine kesir: "1/1 top gelen belgeli" (girdi kökü birimi — başlıktaki "Üretime giren" ile aynı).
  const coverage = `${suggestion.coveredRollCount}/${suggestion.rollCount} top gelen belgeli`;
  const applyValueId = view?.kind === "apply" ? view.value.valueId : view?.kind === "conflict" && view.applicable ? view.doc.valueId : null;
  const tone =
    view?.kind === "conflict"
      ? "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
      : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200";

  return (
    <div className={`mt-3 rounded-md border px-3 py-2 ${tone}`} data-testid="delivery-note-gramaj" data-kind={view?.kind ?? "variants"}>
      {view && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <HeadLine view={view} coverage={coverage} />
          {applyValueId && propertyId && (
            <PermissionGate permission="workorder:write">
              <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={apply.isPending} onClick={() => apply.mutate(applyValueId)}>
                {apply.isPending ? "Uygulanıyor..." : "Uygula"}
              </Button>
            </PermissionGate>
          )}
        </div>
      )}
      {view?.kind === "list" && (
        <ul className="mt-2 space-y-1 text-xs">
          {view.entries.map((e) => (
            <li key={`${e.valueId ?? "-"}:${e.processText ?? ""}`} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{e.valueName ?? "Gramaj okunamadı"}</span>
              {e.processText && <span className="min-w-0 break-words opacity-80">“{e.processText}”</span>}
              <span className="ml-auto tabular-nums">{e.rollCount} top</span>
            </li>
          ))}
        </ul>
      )}
      {variants.length > 0 && (
        // Kurşun dışı çeşitler (D4-D1) yalnız bilgi: hedefe uygulama gelen belgeden iş emri akışının işi (D4-D2).
        <ul className="mt-2 space-y-1 text-xs" data-testid="delivery-note-variants">
          {variants.map((v) => (
            <li key={v.propertyId} className="flex flex-wrap gap-x-2" data-property={v.propertyId}>
              <span className="opacity-80">{v.propertyName}:</span>
              <VariantText row={v} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeadLine({ view, coverage }: { view: GramajHintView; coverage: string }) {
  const cov = <span className="ml-2 text-xs opacity-80">({coverage})</span>;
  if (view.kind === "apply") {
    return <span>Gelen belge önerisi: <span className="font-semibold">{view.value.valueName}</span>{cov}</span>;
  }
  if (view.kind === "conflict") {
    return (
      <span data-testid="delivery-note-conflict">
        Belgede <span className="font-semibold">{view.doc.valueName}</span>, hedef <span className="font-semibold">{view.targetName}</span>{cov}
      </span>
    );
  }
  const distinct = new Set(view.entries.map((e) => e.valueId).filter(Boolean)).size;
  const why = distinct >= 2 ? "Gelen belgeler farklı gramaj söylüyor" : "Gramaj belgelerin bir kısmında okunamadı";
  return <span>{why} — öneri verilmedi{cov}</span>;
}

function VariantText({ row }: { row: VariantHintRow }) {
  if (row.kind === "suggest") return <span className="font-semibold">{row.value.valueName}</span>;
  if (row.kind === "conflict") {
    return <span>Belgede <span className="font-semibold">{row.doc.valueName}</span>, hedef <span className="font-semibold">{row.targetName}</span></span>;
  }
  return (
    <span>
      öneri yok
      <span className="opacity-80"> ({row.entries.filter((e) => e.valueId).map((e) => `${e.valueName} · ${e.rollCount} top`).join(", ")})</span>
    </span>
  );
}
