import { useQuery } from "@tanstack/react-query";
import { Controller, type UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemService } from "@/pages/Items/service";
import { ServiceItemPickerField } from "./ServiceItemPickerField";
import { SERVICE_ITEM_PICKER_FILTERS, propertyServiceHint, showServiceMapping, type ServiceItemOption } from "./serviceMapping";
import type { ValueServiceContext } from "./PropertyValuesField";
import type { FabricPropertyFormValues } from "./schema";
import type { FabricProperty } from "./types";

type PropertyForm = UseFormReturn<FabricPropertyFormValues>;

/** Aktif hizmet kalemleri — seçici ve önizleme aynı listeyi okur (süzme sunucuda). */
export function useServiceItemOptions(enabled: boolean): readonly ServiceItemOption[] {
  // Kalem okuma izni yoksa istek atılmaz (403 toast'ı form açılışında çıkmasın).
  const { hasPermission } = useRoleAccess();
  const q = useQuery({
    queryKey: ["items", "picker", "service"],
    queryFn: () =>
      loadAllForPicker(itemService, { filters: { ...SERVICE_ITEM_PICKER_FILTERS }, sortBy: "code" }),
    enabled: enabled && hasPermission("item:read"),
    staleTime: 60_000,
  });
  return (q.data?.data ?? []).map((i) => ({ id: i.id, code: i.code, name: i.name }));
}

/** Form bölümü: hizmet kalemi yoksa ve eşleme de yoksa çizilmez (form bugünkü gibi kalır). */
export function useServiceMapping(open: boolean, initial: FabricProperty | null) {
  const items = useServiceItemOptions(open);
  return { items, show: showServiceMapping(items, initial) };
}

/** Değer satırlarının bağlamı: formdaki (kaydedilmemiş dahil) özellik eşlemesi + ana bayrak. */
export function valueServiceContext(
  form: PropertyForm,
  items: readonly ServiceItemOption[],
  allProperties: readonly FabricProperty[],
): ValueServiceContext {
  const parentId = form.watch("variantOfPropertyId") ?? null;
  return {
    items,
    propertyServiceItemId: form.watch("serviceItemId") ?? null,
    parent: parentId ? (allProperties.find((p) => p.id === parentId) ?? null) : null,
  };
}

/** Özellik düzeyi eşleme (işlem → hizmet kalemi). Seçim tipinde değerlerin varsayılanıdır. */
export function PropertyServiceItemField({
  form,
  items,
}: {
  form: PropertyForm;
  items: readonly ServiceItemOption[];
}) {
  const hint = propertyServiceHint(form.watch("valueType"));
  return (
    <FormField label="Hizmet kalemi (faturalama)" hint={hint}>
      <Controller
        control={form.control}
        name="serviceItemId"
        render={({ field }) => (
          <ServiceItemPickerField
            value={field.value ?? null}
            onChange={field.onChange}
            items={items}
            noneLabel="Eşleme yok"
            ariaLabel="Özelliğin hizmet kalemi"
            className="w-full sm:max-w-sm"
          />
        )}
      />
    </FormField>
  );
}
