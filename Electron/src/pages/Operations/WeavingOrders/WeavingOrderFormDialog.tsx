// =============================================================================
// DOKUMA İŞİ FORMU — oluştur / düzenle (yalnız AÇIK durumda)
// =============================================================================
// ⚠️ TEK MANTIKSAL DENEME = TEK `clientToken` (`useAttemptToken`, kk1.md): ağ
// hatasında aynı token yeniden gider (replay özgün kaydı döner), kesin 4xx'te ve
// başarıda yenilenir. Backend aynı yükü replay, farklı yükü CLIENT_TOKEN_COLLISION
// sayar — o yüzden sayfa diyaloğu KOŞULLU mount eder (her açılış yeni deneme).
// Alan grupları `WeavingOrderFormFields.tsx`te.
// =============================================================================
import { useState } from "react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { useOperationsVisibilityContext } from "../useOperationsVisibility";
import { useDokumaOrderLineLinkRequired } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { weavingOrderFormDefaults, weavingOrderFormSchema, type WeavingOrderFormValues } from "./schema";
import { FabricFields, PartyFields, PlanFields } from "./WeavingOrderFormFields";
import { ConstructionFields } from "./ConstructionFields";
import { WeavingOrderLinesSection } from "./WeavingOrderLinesSection";
import { BeamPrefillField, type PlannedMSuggestion } from "./BeamPrefillField";
import { isoToDay, type WeavingOrder } from "./types";
import { TERIM } from "@/lib/terim";
import type { UseFormReturn } from "react-hook-form";
import { useProposalGates } from "../Orders/production-proposal/gates";
import { LoomSuggestionSection, draftOf } from "./loom-suggestion/LoomSuggestionSection";

/** SY-M3: formun canlı değerlerinden tezgâh önerisi (ürün/varyant/çözgü/plan m değiştikçe yeniden sorar). */
function FormLoomSuggestion({ form }: { form: UseFormReturn<WeavingOrderFormValues> }) {
  const [itemId, recipeId, warpSpecId, plannedM] = form.watch(["itemId", "recipeId", "warpSpecId", "plannedM"]);
  return <LoomSuggestionSection draft={draftOf({ itemId, recipeId, warpSpecId, plannedM })} />;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WeavingOrder | null;
  /** Sonuç (reddedilen söz dahil) diyaloğa döner: token belirsiz hatada yapışır, kesin 4xx'te yenilenir. */
  onSubmit: (values: WeavingOrderFormValues, clientToken: string) => Promise<unknown>;
  isSubmitting?: boolean;
}

function buildDefaults(initial?: WeavingOrder | null): WeavingOrderFormValues {
  if (!initial) return weavingOrderFormDefaults;
  return {
    itemId: initial.itemId,
    colorId: initial.colorId ?? "",
    warpSpecId: initial.warpSpecId ?? "",
    weftSpecId: initial.weftSpecId ?? "",
    weaveDesignId: initial.weaveDesignId ?? "",
    recipeId: initial.recipeId ?? "",
    plannedM: initial.plannedM === null ? "" : String(initial.plannedM),
    executionKind: initial.executionKind,
    subcontractorId: initial.subcontractorId ?? "",
    plannedStartDate: isoToDay(initial.plannedStartDate),
    plannedEndDate: isoToDay(initial.plannedEndDate),
    notes: initial.notes ?? "",
    orderLines: (initial.orderLines ?? []).map((l) => ({ orderLineId: l.orderLineId, allocatedM: l.allocatedM == null ? "" : String(l.allocatedM) })),
  };
}

export function WeavingOrderFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const attempt = useAttemptToken();
  const { devereEnabled } = useOperationsVisibilityContext();
  const orderLineRequired = useDokumaOrderLineLinkRequired();
  const [suggestion, setSuggestion] = useState<PlannedMSuggestion | null>(null);
  const { loomSuggestionVisible } = useProposalGates();
  return (
    <EntityFormDialog<WeavingOrderFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${initial.weavingOrderNumber} — Düzenle` : `Yeni ${TERIM.dokumaIsEmri.tekil}`}
      description="Ne dokunacak, ne kadar, kim dokuyacak. Numara sunucuda üretilir (DK+GGAAYY+NNNN)."
      schema={weavingOrderFormSchema}
      defaultValues={buildDefaults(initial)}
      onSubmit={(v) => onSubmit(v, attempt.token()).then(() => attempt.onSuccess(), (e: unknown) => attempt.onFailure(e))}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {devereEnabled && <BeamPrefillField form={form} onSuggestion={setSuggestion} />}
          <FabricFields form={form} devereEnabled={devereEnabled} />
          <ConstructionFields form={form} initialItemId={initial?.itemId ?? null} />
          <WeavingOrderLinesSection form={form} initialLines={initial?.orderLines ?? []} required={orderLineRequired} />
          <PartyFields form={form} />
          <PlanFields form={form} suggestion={suggestion} />
          {loomSuggestionVisible && <FormLoomSuggestion form={form} />}
        </>
      )}
    </EntityFormDialog>
  );
}
