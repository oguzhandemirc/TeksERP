// Metre sayacı kalibrasyon kaydı (D4-B5k, B-3) — İSTEĞE BAĞLI; yalnız METER cihazında çizilir. Sunucu da
// doğrular: METER olmayan cihazda dolu alan 400, geçerlilik sonu < kalibrasyon tarihi 400.
import { Controller, type UseFormReturn } from "react-hook-form";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import type { PeripheralFormValues } from "./schema";

export function MeterCalibrationFields({ form }: { form: UseFormReturn<PeripheralFormValues> }) {
  const errors = form.formState.errors;
  return (
    <div className="rounded-md border bg-muted/20 p-3" data-testid="meter-calibration-fields">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Kalibrasyon (isteğe bağlı)</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Kalibrasyon tarihi" error={errors.calibratedAt}>
          <Controller control={form.control} name="calibratedAt" render={({ field }) => <DatePickerInput aria-label="Kalibrasyon tarihi" value={field.value ?? ""} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Geçerlilik sonu" hint="bu gün dahil geçerli" error={errors.calibrationDueAt}>
          <Controller control={form.control} name="calibrationDueAt" render={({ field }) => <DatePickerInput aria-label="Geçerlilik sonu" value={field.value ?? ""} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Kalibrasyon notu" className="sm:col-span-2" error={errors.calibrationNote}>
          <Input aria-label="Kalibrasyon notu" maxLength={200} {...form.register("calibrationNote")} placeholder="örn. sertifika no / kalibrasyonu yapan firma" />
        </FormField>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Genel Ayarlar → Tambur → “Sayaç kalibrasyon süresi kontrolü” Uyar ise süresi geçmiş sayaçla ölçümde uyarı çıkar; ölçüm engellenmez.
      </p>
    </div>
  );
}
