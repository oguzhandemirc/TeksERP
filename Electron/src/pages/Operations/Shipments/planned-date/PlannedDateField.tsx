import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { Label } from "@/components/ui/label";
import { useShipmentConfirmationEnabled } from "@/hooks/usePricingEnabled";

/** Kurulum gövdesine eklenir; boşken anahtar gitmez (sunucu NULL = bugünkü davranış). */
export function plannedDateBody(v: string): { plannedDate?: string } {
  return v ? { plannedDate: v } : {};
}

/**
 * "Planlanan sevk tarihi" — opsiyonel takvim günü. Pano ajandası sevkiyatı bu güne koyar;
 * gecikme üretilmez. Yalnız sevkiyat PLANNED doğuyorsa (sevk onayı açık) anlamlıdır.
 */
export function PlannedDateField({ value, onChange, disabled, id = "planned-ship-date" }: { value: string; onChange: (v: string) => void; disabled?: boolean; id?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        Planlanan sevk tarihi <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
      </Label>
      <DatePickerInput id={id} value={value} onChange={onChange} disabled={disabled} placeholder="Tarih seçin" className="max-w-[12rem]" />
    </div>
  );
}

export interface PlannedDateDraft { show: boolean; value: string; setValue: (v: string) => void; body: { plannedDate?: string } }

/**
 * Kurulum diyaloğunun taslağı: alan yalnız sevk onayı açıkken (sevkiyat PLANNED doğar) görünür ve
 * gövdeye girer; diyalog her açılışta boşalır (render sırasında ayarlama, effect yok).
 */
export function usePlannedDateDraft(open: boolean): PlannedDateDraft {
  const show = useShipmentConfirmationEnabled();
  const [value, setValue] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue("");
  }
  return { show, value, setValue, body: show ? plannedDateBody(value) : {} };
}

export function PlannedDateDraftField({ draft, disabled, id }: { draft: PlannedDateDraft; disabled?: boolean; id?: string }) {
  if (!draft.show) return null;
  return <PlannedDateField value={draft.value} onChange={draft.setValue} disabled={disabled} id={id} />;
}
