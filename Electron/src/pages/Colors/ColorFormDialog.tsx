import { useMemo } from "react";
import { Controller } from "react-hook-form";
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
  // Düzenlemede rengin atalı müşterilerini çek (liste satırında yok).
  const detailQ = useQuery({
    queryKey: ["color", initial?.id, "detail"],
    queryFn: () => colorService.getById(initial!.id),
    enabled: open && Boolean(initial?.id),
    staleTime: 0,
  });
  const assignedCustomerIds = detailQ.data?.data?.customerIds ?? [];

  const defaults: ColorFormValues = initial
    ? {
        name: initial.name,
        hex: initial.hex ?? "",
        isActive: initial.isActive,
        customerIds: assignedCustomerIds,
      }
    : colorFormDefaults;

  // Detay (customerIds) yüklenince formu doğru seçimle yeniden başlat.
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
            hint="Bu rengi atayacağın müşteriler (firmaya özel renk). Boş bırakılırsa ortak renk olur."
          >
            <Controller
              control={form.control}
              name="customerIds"
              render={({ field }) => (
                <ColorCustomersField value={field.value ?? []} onChange={field.onChange} />
              )}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}

function ColorCustomersField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
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

  return (
    <div className="h-52">
      <MultiSelectCheckboxList
        items={items}
        value={value}
        onChange={onChange}
        placeholder="Müşteri ara..."
        emptyHint={customersQ.isLoading ? "Yükleniyor..." : "Müşteri bulunamadı."}
      />
    </div>
  );
}
