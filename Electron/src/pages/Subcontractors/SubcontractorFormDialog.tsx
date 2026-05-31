import { Controller } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import {
  subcontractorFormDefaults,
  subcontractorFormSchema,
  type SubcontractorFormValues,
} from "./schema";
import type { Subcontractor } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Subcontractor | null;
  onSubmit: (values: SubcontractorFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function SubcontractorFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const defaults: SubcontractorFormValues = initial
    ? {
        name: initial.name,
        taxNumber: initial.taxNumber ?? "",
        phone: initial.phone ?? "",
        address: initial.address ?? "",
        isActive: initial.isActive,
        isFavorite: initial.isFavorite,
        categoryIds: initial.categories.map((c) => c.categoryId),
      }
    : subcontractorFormDefaults;

  const categories = useQuery({
    queryKey: ["subcontractor-categories", "all-active"],
    queryFn: () =>
      subcontractorCategoryService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  return (
    <EntityFormDialog<SubcontractorFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Fason Firmayı Düzenle" : "Yeni Fason Firma"}
      schema={subcontractorFormSchema}
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
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" autoFocus {...form.register("name")} />
            </FormField>
            <FormField
              label="Vergi No"
              htmlFor="taxNumber"
              error={form.formState.errors.taxNumber}
              hint="İsteğe bağlı — 10-15 haneli VKN/TCKN"
            >
              <Input
                id="taxNumber"
                inputMode="numeric"
                maxLength={32}
                placeholder="örn: 1234567890"
                {...form.register("taxNumber")}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Telefon"
              htmlFor="phone"
              error={form.formState.errors.phone}
              hint="İsteğe bağlı"
            >
              <Input
                id="phone"
                inputMode="tel"
                maxLength={32}
                placeholder="0212 555 0000"
                {...form.register("phone")}
              />
            </FormField>
            <FormField
              label="Adres"
              htmlFor="address"
              error={form.formState.errors.address}
              hint="İsteğe bağlı"
            >
              <Input id="address" maxLength={500} {...form.register("address")} />
            </FormField>
          </div>

          <FormField
            label="Hizmet Verilen Kategoriler"
            error={form.formState.errors.categoryIds}
            required
            hint="Firma birden fazla kategoride hizmet verebilir."
          >
            <div className="h-56">
              {categories.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <Controller
                  control={form.control}
                  name="categoryIds"
                  render={({ field }) => (
                    <MultiSelectCheckboxList
                      items={(categories.data?.data ?? []).map((c) => ({
                        id: c.id,
                        label: c.name,
                        hint: c.description ?? c.code,
                      }))}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Kategori ara..."
                      emptyHint="Tanımlı kategori yok."
                    />
                  )}
                />
              )}
            </div>
          </FormField>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register("isActive")} /> Aktif
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register("isFavorite")} /> Favori — iş
              emri fason adımında default firma
            </label>
          </div>
        </>
      )}
    </EntityFormDialog>
  );
}
