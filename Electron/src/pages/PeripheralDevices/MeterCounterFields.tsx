// Metre sayacı alanları (H4) — yalnız METER cihazında çizilir. Sunucu da doğrular: bilinmeyen kip 400,
// sıfırlama komutu yazdırılabilir ASCII ≤64 (400), METER olmayan cihazda dolu alan 400.
import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import type { PeripheralFormValues } from "./schema";

const SELECT_CLS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export const COUNTER_MODE_LABELS: Record<"RESETTING" | "CUMULATIVE", string> = {
  RESETTING: "Her topta sıfırlanır",
  CUMULATIVE: "Birikimli (fark alınır)",
};

export function MeterCounterFields({ form }: { form: UseFormReturn<PeripheralFormValues> }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3" data-testid="meter-counter-fields">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Sayaç (metre)</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Sayaç kipi" hint="boş → cihaz verisinden" error={form.formState.errors.counterMode}>
          <select className={SELECT_CLS} aria-label="Sayaç kipi" {...form.register("counterMode")}>
            <option value="">— (belirtilmedi)</option>
            {Object.entries(COUNTER_MODE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Sıfırlama komutu" hint="dolu → top başında gönderilir · en çok 64 ASCII" error={form.formState.errors.resetCommand}>
          <Input className="font-mono" aria-label="Sıfırlama komutu" maxLength={64} {...form.register("resetCommand")} placeholder="RST\r\n" />
        </FormField>
      </div>
    </div>
  );
}
