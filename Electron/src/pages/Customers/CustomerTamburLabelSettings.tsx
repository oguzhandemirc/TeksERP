// Cari kartı → Etiket Şablonları sekmesi: "Tambur / Etiket" ayarları (Gülkesim S5).
// Tek kayıt modeli (B18/7): ayrı "Ayarları kaydet" yok — alanlar cari formunun `tamburLabel` değeridir, alt çubuktaki
// Kaydet Bilgiler'le birlikte yazar; İptal geri alır. Doğrulama şemada (`splitLengthError`).
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { ChoiceChips } from "@/components/ui/toggle-chip";
import type { CustomerFormValues } from "./schema";
import { WIDTH_SOURCE_OPTIONS, type TamburLabelSettingsForm } from "./tamburLabelSettings";

export function CustomerTamburLabelSettings() {
  const form = useFormContext<CustomerFormValues>();
  const widthSource = form.watch("tamburLabel.widthSource") ?? "";
  const splitError = form.formState.errors.tamburLabel?.splitLength?.message;
  const hint = WIDTH_SOURCE_OPTIONS.find((o) => o.value === widthSource)?.hint;
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          Etiketteki en {hint ? <InfoPopover label="Etiketteki en: açıklama" desc={hint} /> : null}
        </span>
        <Controller
          control={form.control}
          name="tamburLabel.widthSource"
          render={({ field }) => (
            <ChoiceChips
              name="labelWidthSource"
              ariaLabel="Etiketteki en"
              value={field.value || "TODAY"}
              options={WIDTH_SOURCE_OPTIONS.map((o) => ({ value: o.value || "TODAY", label: o.label }))}
              onChange={(v) => field.onChange(v === "TODAY" ? "" : (v as TamburLabelSettingsForm["widthSource"]))}
            />
          )}
        />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register("tamburLabel.weighRequired")} />
        Tamburda tartım zorunlu
        <InfoPopover label="Tartım zorunlu: açıklama" desc="kg girilmeden kesim kaydedilmez; kg etikete basılabilir." />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register("tamburLabel.labelBatchEnabled")} />
        Etikete müşterinin parti no'su basılsın
        <InfoPopover label="Müşteri parti no: açıklama" desc="Tablet kesimde sorar; doluyken bizim parti no basılmaz." />
      </label>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Bölme ölçüsü önerisi</span>
          <Input
            className="h-8 w-28"
            inputMode="decimal"
            placeholder="ör. 50"
            aria-label="Bölme ölçüsü (m)"
            aria-invalid={splitError ? true : undefined}
            {...form.register("tamburLabel.splitLength")}
          />
          <span className="text-xs text-muted-foreground">m</span>
          <InfoPopover label="Bölme ölçüsü: açıklama" desc="Tablet kesim metresine öneri." />
        </div>
        {splitError ? <p className="text-xs text-destructive">{splitError}</p> : null}
      </div>
    </div>
  );
}
