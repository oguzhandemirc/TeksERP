// K7 kumaş kompozisyonu: hesaplanan (iplik lif paylarından, sunucu) gösterilir; kutu ELLE düzeltmedir (boş = hesaplanan).
// "Hesaplanana dön" kutuyu boşaltır; kaydedince düzeltme silinir. Bilinmiyorsa sebep ve lif bileşimi eksik iplikler yazılır.
import { useQuery } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ItemFormValues } from "./schema";
import type { ItemComputedComposition } from "./types";
import { itemService } from "./service";

export function compositionStatusText(data: ItemComputedComposition | null | undefined): string | null {
  if (!data) return null;
  if (data.status === "OK") return data.text;
  if (data.status === "MISSING_FIBER") {
    const names = data.missingYarns.map((y) => y.name).join(", ");
    return `hesaplanamadı — lif bileşimi girilmemiş iplik: ${names}`;
  }
  if (data.status === "MISSING_STRUCTURE") return "hesaplanamadı — çözgü/atkı ipliği ya da sıklık eksik";
  return null;
}

export function ItemCompositionField({ form, itemId }: { form: UseFormReturn<ItemFormValues>; itemId: string | null }) {
  const q = useQuery({
    queryKey: ["item-computed-composition", itemId],
    queryFn: () => itemService.computedComposition(itemId as string),
    enabled: Boolean(itemId),
    retry: false,
    staleTime: 0,
  });
  const manual = useWatch({ control: form.control, name: "composition" }) ?? "";
  const data = q.isSuccess ? q.data : null;
  const computed = compositionStatusText(data);
  const computedOk = data?.status === "OK" ? data.text : null;

  return (
    <FormField
      label="Kompozisyon"
      htmlFor="composition"
      error={form.formState.errors.composition}
      info="Boş bırakılırsa çözgü ve atkı ipliklerinin lif bileşiminden hesaplanır. Yazarsan elle düzeltme olarak saklanır."
    >
      <Input id="composition" placeholder={computedOk ?? "ör. %83 PES %17 VIS"} {...form.register("composition")} />
      {computed && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="item-computed-composition">
          <span>{manual.trim() ? "hesaplanan" : "Hesaplanan"}: {computed}</span>
          {manual.trim() !== "" && computedOk && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => form.setValue("composition", "", { shouldDirty: true, shouldValidate: true })}
            >
              hesaplanana dön
            </Button>
          )}
        </p>
      )}
    </FormField>
  );
}
