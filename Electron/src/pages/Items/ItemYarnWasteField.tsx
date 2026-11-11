// SY-3 I2: iplik kartının fire yüzdesi — yalnız İPLİK + maliyet modülü açıkken çizilir (kapalıyken bugünkü form).
// Boş = çözgü/atkı kartındaki fire kullanılır; dolu = bu iplik her kumaşta bu fireyle hesaplanır.
import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import type { ItemFormValues } from "./schema";

export function ItemYarnWasteField({ form }: { form: UseFormReturn<ItemFormValues> }) {
  return (
    <FormField
      label="İplik firesi % (opsiyonel)"
      htmlFor="yarnWastePct"
      error={form.formState.errors.yarnWastePct}
      hint="Doluysa bu iplik maliyet ve iplik ihtiyacında bu fireyle hesaplanır; boşsa çözgü/atkı kartındaki fire kullanılır (0–50)"
    >
      <Input id="yarnWastePct" inputMode="decimal" placeholder="Boş = kart firesi" {...form.register("yarnWastePct")} />
    </FormField>
  );
}
