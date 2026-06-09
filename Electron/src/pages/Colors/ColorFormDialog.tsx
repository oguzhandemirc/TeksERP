import { useMemo } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { ColorPickerInput } from "@/components/forms/ColorPickerInput";
import {
  MultiSelectCheckboxList,
  type MultiSelectItem,
} from "@/components/forms/MultiSelectCheckboxList";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { colorService } from "./service";
import { colorFormDefaults, colorFormSchema, type ColorFormValues } from "./schema";
import type { Color } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Color | null;
  onSubmit: (values: ColorFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ColorFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  // Düzenlemede rengin atalı müşterilerini + müşterideki adlarını çek.
  const detailQ = useQuery({
    queryKey: ["color", initial?.id, "detail"],
    queryFn: () => colorService.getById(initial!.id),
    enabled: open && Boolean(initial?.id),
    staleTime: 0,
  });
  const assignedCustomerIds = detailQ.data?.data?.customerIds ?? [];
  const assignedAliases = detailQ.data?.data?.customerAliases ?? {};

  const defaults: ColorFormValues = initial
    ? {
        name: initial.name,
        hex: initial.hex ?? "",
        isActive: initial.isActive,
        customerIds: assignedCustomerIds,
        customerAliases: assignedAliases,
      }
    : colorFormDefaults;

  // Detay (customerIds + alias) yüklenince formu doğru seçimle yeniden başlat.
  const formKey = initial
    ? `${initial.id}:${detailQ.isSuccess ? "ready" : "loading"}`
    : "new";

  return (
    <EntityFormDialog<ColorFormValues>
      key={formKey}
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Rengi Düzenle" : "Yeni Renk"}
      schema={colorFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}
          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus placeholder="Mavi, Kırmızı..." {...form.register("name")} />
          </FormField>
          <FormField
            label="Renk"
            error={form.formState.errors.hex}
            hint="Hex kodu yazabilir veya paletten seçebilirsin."
          >
            <Controller
              control={form.control}
              name="hex"
              render={({ field }) => (
                <ColorPickerInput value={field.value ?? ""} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField
            label="Müşteriler"
            hint="Bu rengi atayacağın müşteriler (firmaya özel renk). Boş bırakılırsa ortak renk olur. Seçilen her müşteri için opsiyonel 'müşterideki ad' girebilirsin."
          >
            <ColorCustomersField form={form} />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}

function ColorCustomersField({ form }: { form: UseFormReturn<ColorFormValues> }) {
  const customersQ = useQuery({
    queryKey: ["customers", "picker", "color-assign"],
    queryFn: () =>
      loadAllForPicker(customerService, {
        filters: { isActive: "true", type: "CUSTOMER" },
      }),
    staleTime: 60_000,
  });

  const items = useMemo<MultiSelectItem[]>(
    () => (customersQ.data?.data ?? []).map((c) => ({ id: c.id, label: c.name, hint: c.code })),
    [customersQ.data],
  );
  const nameById = useMemo(
    () => new Map(items.map((i) => [i.id, i.label])),
    [items],
  );

  const selectedIds = form.watch("customerIds") ?? [];
  const aliases = form.watch("customerAliases") ?? {};

  const onChangeSelection = (ids: string[]) => {
    form.setValue("customerIds", ids, { shouldDirty: true });
    // Seçimden çıkarılan müşterilerin alias girişini de temizle.
    const next: Record<string, string> = {};
    for (const id of ids) if (aliases[id] !== undefined) next[id] = aliases[id];
    form.setValue("customerAliases", next, { shouldDirty: true });
  };

  const onChangeAlias = (id: string, value: string) => {
    form.setValue(
      "customerAliases",
      { ...aliases, [id]: value },
      { shouldDirty: true },
    );
  };

  return (
    <div className="space-y-2">
      <div className="h-52">
        <MultiSelectCheckboxList
          items={items}
          value={selectedIds}
          onChange={onChangeSelection}
          placeholder="Müşteri ara..."
          emptyHint={customersQ.isLoading ? "Yükleniyor..." : "Müşteri bulunamadı."}
        />
      </div>

      {selectedIds.length > 0 && (
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Müşterideki ad (opsiyonel)
          </div>
          {selectedIds.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-xs" title={nameById.get(id)}>
                {nameById.get(id) ?? id}
              </span>
              <Input
                value={aliases[id] ?? ""}
                onChange={(e) => onChangeAlias(id, e.target.value)}
                placeholder="Bizdeki ad kullanılır"
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
