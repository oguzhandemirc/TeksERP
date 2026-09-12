import { Controller } from "react-hook-form";
import { Package } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { warpSpecFormDefaults, warpSpecFormSchema, type WarpSpecFormValues } from "./schema";
import type { WarpSpec } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: WarpSpec | null;
  onSubmit: (values: WarpSpecFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

function buildDefaults(initial?: WarpSpec | null): WarpSpecFormValues {
  if (!initial) return warpSpecFormDefaults;
  return {
    code: initial.code,
    name: initial.name,
    yarnItemId: initial.yarnItemId,
    endsCount: String(initial.endsCount ?? ""),
    selvedgeEnds: initial.selvedgeEnds === null ? "" : String(initial.selvedgeEnds),
    reedNo: initial.reedNo ?? "",
    endsPerDent: initial.endsPerDent === null ? "" : String(initial.endsPerDent),
    reedWidthCm: initial.reedWidthCm ?? "",
    notes: initial.notes ?? "",
    isActive: initial.isActive,
  };
}

export function WarpSpecFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  return (
    <EntityFormDialog<WarpSpecFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Çözgü Kartını Düzenle" : "Yeni Çözgü Kartı"}
      schema={warpSpecFormSchema}
      defaultValues={buildDefaults(initial)}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          <FormField label="Kod" htmlFor="code" error={form.formState.errors.code} required>
            <Input id="code" {...form.register("code")} placeholder="UA6007-Ç" />
          </FormField>

          <FormField label="Çözgü kartı adı" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus {...form.register("name")} placeholder="UA6007 çözgüsü" />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir.
                `excludeId` düzenlemede kendi ikizine çarpmayı engeller. */}
            <SimilarNamesWarning entity="warp-specs" name={form.watch("name") ?? ""} excludeId={initial?.id} />
          </FormField>

          {/* ⚠️ Yalnız İPLİK kalemleri: süzgeç sunucuda uygulanır. Backend ayrıca
              kalemin YARN olduğunu ve DENYESİNİN dolu olduğunu doğrular —
              denyesiz iplikle kart açılsaydı levent sarımında hesap sessizce
              0 kg gösterirdi. */}
          <FormField label="Çözgü ipliği" error={form.formState.errors.yarnItemId} required>
            <Controller
              control={form.control}
              name="yarnItemId"
              render={({ field }) => (
                <EntityPickerModal<Item>
                  value={field.value || null}
                  onChange={(id) => field.onChange(id ?? "")}
                  service={itemService}
                  queryKey="items-warp-yarn"
                  filters={{ itemType: "YARN" }}
                  getLabel={(i) => i.name}
                  getSubLabel={(i) => i.code}
                  icon={Package}
                  title="Çözgü ipliği seç"
                  placeholder="İplik seç"
                />
              )}
            />
          </FormField>

          <FormField
            label="Tel adedi (kenar dahil)"
            htmlFor="endsCount"
            error={form.formState.errors.endsCount}
            required
            hint="Devere hesabının ilk çarpanı: tel × denye × metre ÷ 9.000.000 = kg"
          >
            <Input id="endsCount" {...form.register("endsCount")} inputMode="numeric" placeholder="3500" />
          </FormField>

          <FormField label="Kenar teli" htmlFor="selvedgeEnds" error={form.formState.errors.selvedgeEnds}>
            <Input id="selvedgeEnds" {...form.register("selvedgeEnds")} inputMode="numeric" placeholder="24" />
          </FormField>

          <FormField
            label="Tarak no"
            htmlFor="reedNo"
            error={form.formState.errors.reedNo}
            hint="Birimi fabrikanın kendi kullanımıdır (diş/cm ya da diş/10 cm); hesaba girmez."
          >
            <Input id="reedNo" {...form.register("reedNo")} inputMode="decimal" placeholder="14" />
          </FormField>

          <FormField label="Dişe tel" htmlFor="endsPerDent" error={form.formState.errors.endsPerDent}>
            <Input id="endsPerDent" {...form.register("endsPerDent")} inputMode="numeric" placeholder="4" />
          </FormField>

          <FormField label="Tarak eni (cm)" htmlFor="reedWidthCm" error={form.formState.errors.reedWidthCm}>
            <Input id="reedWidthCm" {...form.register("reedWidthCm")} inputMode="decimal" placeholder="280" />
          </FormField>

          <FormField label="Not" htmlFor="notes" error={form.formState.errors.notes}>
            <Textarea id="notes" {...form.register("notes")} rows={2} placeholder="Tahar planı, jakar koşumu…" />
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
