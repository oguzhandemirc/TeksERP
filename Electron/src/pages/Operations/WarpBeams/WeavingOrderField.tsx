// =============================================================================
// LEVENT ↔ DOKUMA İŞİ seçicisi (Z2) — plan/düzenle formu (Controller) ve sarım diyaloğu (state) aynı bileşen
// =============================================================================
// Opsiyonel: stoğa/serbest levent meşru. Kaynak açık işler (PLANLANDI · DEVAM), etiket
// `weavingOrderNumber · kumaş · çözgü kartı`. Çözgü kartı işinkinden farklıysa sunucu
// `WARP_SPEC_MISMATCH` uyarısı döner — `useWarpBeamMutations.settle` amber toast basar (kod değişmez).
// =============================================================================
import { Controller, type Control, type FieldError } from "react-hook-form";
import { Factory } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { FormField } from "@/components/forms/FormField";
import { weavingOrderPickerService } from "@/pages/Operations/WeavingOrders/service";
import type { WeavingOrder } from "@/pages/Operations/WeavingOrders/types";
import type { WarpBeamPlanValues } from "./schema";
import { TERIM } from "@/lib/terim";

/** Yalnız açık işler; etiket kumaş + çözgü kartı (uyumsuzluk göz önünde). */
export const WEAVING_ORDER_PICKER_FILTERS = { status: "PLANNED,IN_PROGRESS" } as const;
export const weavingOrderPickerLabel = (w: WeavingOrder) => w.weavingOrderNumber;
export const weavingOrderPickerSubLabel = (w: WeavingOrder) => `${w.item.name}${w.warpSpec ? ` · ${w.warpSpec.name}` : " · çözgü kartı yok"}`;

export function WeavingOrderPicker({ value, onChange, required = false, error }: { value: string; onChange: (id: string) => void; required?: boolean; error?: FieldError }) {
  return (
    <FormField label={TERIM.dokumaIsEmri.tekil} required={required} error={error} hint={required ? "Bu kurulumda levent bir dokuma iş emrine bağlanmalı (ayar açık)." : "İsteğe bağlı — serbest levent meşru. Çözgü kartı işinkinden farklıysa uyarı alırsınız, bağ yine kurulur."}>
      <EntityPickerModal<WeavingOrder>
        value={value || null}
        onChange={(id) => onChange(id ?? "")}
        service={weavingOrderPickerService}
        queryKey="weaving-orders-beam"
        filters={{ ...WEAVING_ORDER_PICKER_FILTERS }}
        getLabel={weavingOrderPickerLabel}
        getSubLabel={weavingOrderPickerSubLabel}
        icon={Factory}
        nullable
        noneLabel="Dokuma iş emri yok (serbest levent)"
        title="Dokuma iş emri seç"
        placeholder="Dokuma iş emri seç"
      />
    </FormField>
  );
}

/** `onPicked`: kullanıcı bir iş SEÇİNCE (temizleme hariç) tek sefer — ön doldurma kancası (levent formu). */
export function WeavingOrderField({ control, error, required, onPicked }: { control: Control<WarpBeamPlanValues>; error?: FieldError; required?: boolean; onPicked?: (id: string) => void }) {
  return (
    <Controller
      control={control}
      name="weavingOrderId"
      render={({ field }) => (
        <WeavingOrderPicker
          value={field.value ?? ""}
          onChange={(id) => {
            field.onChange(id);
            if (id && onPicked) onPicked(id);
          }}
          required={required}
          error={error}
        />
      )}
    />
  );
}
