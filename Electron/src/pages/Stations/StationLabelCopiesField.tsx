import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { cn } from "@/lib/utils";
import type { StationFormValues } from "./schema";

/** Boş → null (genel adet); aksi sayı (NaN'ı şema reddeder). */
const toCopies = (v: unknown): number | null =>
  v === "" || v === null || v === undefined ? null : Number(v);

/**
 * İstasyonun varsayılan etiket adedi. Yalnız Genel Ayarlar → Etiket Baskısı'nda
 * kaynak "İstasyon" iken okunur; "Sistem geneli"nde soluk çizilir ama YAZILABİLİR
 * kalır (yönetici modu açmadan önce istasyonları hazırlayabilsin).
 */
export function StationLabelCopiesField({ form }: { form: UseFormReturn<StationFormValues> }) {
  const flags = useFeatureFlags();
  const source = flags.data?.data?.labelCopiesSource ?? "GLOBAL";
  const globalCount = flags.data?.data?.labelCopies;
  const inactive = source !== "STATION";
  return (
    <FormField
      label="Varsayılan etiket adedi"
      htmlFor="defaultLabelCopies"
      error={form.formState.errors.defaultLabelCopies}
      hint={
        inactive
          ? "Sistem geneli kullanılıyor — bu değer etiket adedi kaynağı “İstasyon” seçilince devreye girer."
          : `Tablette baskı adedi bu değerle başlar (1–5). Boş bırakılırsa genel adet${globalCount ? ` (${globalCount})` : ""} kullanılır.`
      }
      className={cn(inactive && "opacity-60")}
    >
      <Input
        id="defaultLabelCopies"
        type="number"
        inputMode="numeric"
        min={1}
        max={5}
        step={1}
        placeholder={globalCount ? `Genel (${globalCount})` : "Genel adet"}
        className="w-40"
        data-testid="station-default-label-copies"
        {...form.register("defaultLabelCopies", { setValueAs: toCopies })}
      />
    </FormField>
  );
}
