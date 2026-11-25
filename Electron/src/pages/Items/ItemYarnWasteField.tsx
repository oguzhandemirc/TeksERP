// SY-3 I2: iplik kartının fire yüzdesi — yalnız İPLİK + maliyet modülü açıkken çizilir (kapalıyken bugünkü form).
// Boş = çözgü/atkı kartındaki fire kullanılır; dolu = bu iplik her kumaşta bu fireyle hesaplanır.
import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { WASTE_PRECEDENCE_TEXT } from "@/lib/waste-precedence";
import type { ItemFormValues } from "./schema";

export function ItemYarnWasteField({ form }: { form: UseFormReturn<ItemFormValues> }) {
  return (
    <FormField
      label="İplik firesi %"
      htmlFor="yarnWastePct"
      error={form.formState.errors.yarnWastePct}
      info={`Doluysa bu iplik maliyet ve iplik ihtiyacında her kumaşta bu fireyle hesaplanır (0–50). ${WASTE_PRECEDENCE_TEXT}`}
    >
      <Input id="yarnWastePct" inputMode="decimal" placeholder="Boş = sıradaki fire" {...form.register("yarnWastePct")} />
    </FormField>
  );
}
