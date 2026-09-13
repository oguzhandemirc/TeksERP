// =============================================================================
// DOKUMA İŞİ FORMU — oluştur / düzenle (yalnız AÇIK durumda)
// =============================================================================
// ⚠️ TEK MOUNT = TEK MANTIKSAL DENEME: `clientToken` diyalog açılırken BİR KEZ
// üretilir (`useRef`); ağ hatasında aynı token yeniden gider (replay özgün
// kaydı döner). Backend aynı yükü replay, farklı yükü CLIENT_TOKEN_COLLISION
// sayar — o yüzden sayfa diyaloğu KOŞULLU mount eder (her açılış taze token).
// Alan grupları `WeavingOrderFormFields.tsx`te.
// =============================================================================
import { useRef } from "react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { useOperationsVisibilityContext } from "../useOperationsVisibility";
import { weavingOrderFormDefaults, weavingOrderFormSchema, type WeavingOrderFormValues } from "./schema";
import { FabricFields, PartyFields, PlanFields } from "./WeavingOrderFormFields";
import { isoToDay, type WeavingOrder } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WeavingOrder | null;
  onSubmit: (values: WeavingOrderFormValues, clientToken: string) => void | Promise<void>;
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
  };
}

export function WeavingOrderFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const tokenRef = useRef(crypto.randomUUID());
  const { devereEnabled } = useOperationsVisibilityContext();
  return (
    <EntityFormDialog<WeavingOrderFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? `${initial.weavingOrderNumber} — Düzenle` : "Yeni Dokuma İşi"}
      description="Ne dokunacak, ne kadar, kim dokuyacak. Numara sunucuda üretilir (DK+GGAAYY+NNNN)."
      schema={weavingOrderFormSchema}
      defaultValues={buildDefaults(initial)}
      onSubmit={(v) => onSubmit(v, tokenRef.current)}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FabricFields form={form} devereEnabled={devereEnabled} />
          <PartyFields form={form} />
          <PlanFields form={form} />
        </>
      )}
    </EntityFormDialog>
  );
}
