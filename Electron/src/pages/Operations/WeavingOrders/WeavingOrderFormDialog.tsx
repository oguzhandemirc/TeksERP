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
import { weavingOrderFormSchema, type WeavingOrderFormValues } from "./schema";
import { applyPreset } from "./templates/preset";
import type { WeavingFormPreset } from "@/pages/Operations/WorkOrders/oie/nav";
import { FabricFields, PartyFields, PlanFields } from "./WeavingOrderFormFields";
import { ConstructionFields } from "./ConstructionFields";
import { WeavingOrderLinesSection } from "./WeavingOrderLinesSection";
import { BeamPrefillField, type PlannedMSuggestion } from "./BeamPrefillField";
import { isoToDay, type WeavingOrder } from "./types";
import { TERIM } from "@/lib/terim";
import type { UseFormReturn } from "react-hook-form";
import { useProposalGates } from "../Orders/production-proposal/gates";
import { LoomSuggestionSection, draftOf } from "./loom-suggestion/LoomSuggestionSection";
import { FieldGrid, FormCard } from "@/components/forms/WideFormDialog";

/** SY-M3: formun canlı değerlerinden tezgâh önerisi (ürün/varyant/çözgü/plan m değiştikçe yeniden sorar). */
function FormLoomSuggestion({ form }: { form: UseFormReturn<WeavingOrderFormValues> }) {
  const [itemId, recipeId, warpSpecId, plannedM] = form.watch(["itemId", "recipeId", "warpSpecId", "plannedM"]);
  return <LoomSuggestionSection draft={draftOf({ itemId, recipeId, warpSpecId, plannedM })} />;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WeavingOrder | null;
  /** Yeni kayıtta özel dokuma şablonunun ön-dolgusu (İE ayrımı); düzenlemede yok sayılır. */
  preset?: WeavingFormPreset | null;
  /** Sonuç (reddedilen söz dahil) diyaloğa döner: token belirsiz hatada yapışır, kesin 4xx'te yenilenir. */
  onSubmit: (values: WeavingOrderFormValues, clientToken: string) => Promise<unknown>;
  isSubmitting?: boolean;
}

function buildDefaults(initial?: WeavingOrder | null, preset?: WeavingFormPreset | null): WeavingOrderFormValues {
  if (!initial) return applyPreset(preset);
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

export function WeavingOrderFormDialog({ open, onOpenChange, initial, preset, onSubmit, isSubmitting }: Props) {
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
      defaultValues={buildDefaults(initial, preset)}
      onSubmit={(v) => onSubmit(v, attempt.token()).then(() => attempt.onSuccess(), (e: unknown) => attempt.onFailure(e))}
      isSubmitting={isSubmitting}
      size="wide"
      sectionsKey="weaving-order.form"
    >
      {(form) => (
        // Geniş form (2026-11-19): kısa alanlar ızgarada; kartlar bölüm menüsünden gizlenebilir (zorunlu alanlı olanlar kilitli).
        <div className="space-y-5">
          <FormCard title="Ne dokunacak" sectionId="fabric" sectionRequired>
            <div className="space-y-4">
              <FieldGrid cols={4}>
                {devereEnabled && <BeamPrefillField form={form} onSuggestion={setSuggestion} />}
                <FabricFields form={form} />
              </FieldGrid>
              <ConstructionFields form={form} initialItemId={initial?.itemId ?? null} />
            </div>
          </FormCard>
          <FormCard title="Kim, ne kadar, ne zaman" sectionId="plan" sectionRequired>
            <FieldGrid cols={4}>
              <PartyFields form={form} />
              <PlanFields form={form} suggestion={suggestion} />
            </FieldGrid>
          </FormCard>
          <FormCard title="Sipariş bağı" sectionId="order-lines" sectionRequired={orderLineRequired}>
            <WeavingOrderLinesSection form={form} initialLines={initial?.orderLines ?? []} required={orderLineRequired} />
          </FormCard>
          {loomSuggestionVisible && <FormLoomSuggestion form={form} />}
        </div>
      )}
    </EntityFormDialog>
  );
}
