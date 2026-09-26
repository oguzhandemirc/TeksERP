// =============================================================================
// DOKUMA İŞİ FORMU — oluştur / düzenle (yalnız AÇIK durumda)
// =============================================================================
// ⚠️ TEK MANTIKSAL DENEME = TEK `clientToken` (`useAttemptToken`, kk1.md): ağ
// hatasında aynı token yeniden gider (replay özgün kaydı döner), kesin 4xx'te ve
// başarıda yenilenir. Backend aynı yükü replay, farklı yükü CLIENT_TOKEN_COLLISION
// sayar — o yüzden sayfa diyaloğu KOŞULLU mount eder (her açılış yeni deneme).
// Alan grupları `WeavingOrderFormFields.tsx`te.
// =============================================================================
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { useOperationsVisibilityContext } from "../useOperationsVisibility";
import { useDokumaOrderLineLinkRequired } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { weavingOrderFormDefaults, weavingOrderFormSchema, type WeavingOrderFormValues } from "./schema";
import { FabricFields, PartyFields, PlanFields } from "./WeavingOrderFormFields";
import { WeavingOrderLinesSection } from "./WeavingOrderLinesSection";
import { isoToDay, type WeavingOrder } from "./types";

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
  return (
    <EntityFormDialog<WeavingOrderFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${initial.weavingOrderNumber} — Düzenle` : "Yeni Dokuma İşi"}
      description="Ne dokunacak, ne kadar, kim dokuyacak. Numara sunucuda üretilir (DK+GGAAYY+NNNN)."
      schema={weavingOrderFormSchema}
      defaultValues={buildDefaults(initial)}
      onSubmit={(v) => onSubmit(v, attempt.token()).then(() => attempt.onSuccess(), (e: unknown) => attempt.onFailure(e))}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FabricFields form={form} devereEnabled={devereEnabled} />
          <WeavingOrderLinesSection form={form} initialLines={initial?.orderLines ?? []} required={orderLineRequired} />
          <PartyFields form={form} />
          <PlanFields form={form} />
        </>
      )}
    </EntityFormDialog>
  );
}
