import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { ITEM_UNIT_CODES, ITEM_UNIT_LABEL } from "@/lib/item-unit";
import type { ServiceItem } from "./types";
import { serviceFormDefaults, serviceFormSchema, type ServiceFormValues } from "./schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ServiceItem | null;
  onSubmit: (values: ServiceFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ServiceFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const defaults: ServiceFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        unit: (ITEM_UNIT_CODES as readonly string[]).includes(initial.unit) ? initial.unit : "MT",
      }
    : serviceFormDefaults;

  return (
    <EntityFormDialog<ServiceFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Hizmet Kartını Düzenle" : "Yeni Hizmet Kartı"}
      schema={serviceFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial ? (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          ) : (
            <FormField
              label="Kod"
              htmlFor="code"
              error={form.formState.errors.code}
              hint="Boş bırakılırsa sistem verir (HZM-000001…)."
            >
              <Input id="code" placeholder="KURSUN" {...form.register("code")} />
            </FormField>
          )}
          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input
              id="name"
              autoFocus
              placeholder="Kurşun dikimi, tambur, brode..."
              {...form.register("name")}
            />
            <SimilarNamesWarning entity="service-items" name={form.watch("name") ?? ""} excludeId={initial?.id} />
          </FormField>
          <FormField
            label="Birim"
            htmlFor="unit"
            error={form.formState.errors.unit}
            hint="Fatura satırındaki miktar birimi."
          >
            <select
              id="unit"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              {...form.register("unit")}
            >
              {ITEM_UNIT_CODES.map((u) => (
                <option key={u} value={u}>
                  {ITEM_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </FormField>
        </>
      )}
    </EntityFormDialog>
  );
}
