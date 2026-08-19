import { useQuery } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { nextSortOrder } from "@/lib/sort-order";
import { fabricPropertyColumns } from "./columns";
import { fabricPropertyService } from "./service";
import { FabricPropertyFormDialog } from "./FabricPropertyFormDialog";
import type { FabricProperty } from "./types";
import type { FabricPropertyFormValues } from "./schema";
import { loadAllForPicker } from "@/lib/picker-loader";

export function FabricPropertiesPage() {
  const allQ = useQuery({
    queryKey: ["fabric-properties", "all-for-sort"],
    queryFn: () =>
      loadAllForPicker(fabricPropertyService, {
        sortBy: "sortOrder",
        sortOrder: "desc",
        filters: {},
      }),
    staleTime: 60_000,
  });
  const nextOrder = nextSortOrder(allQ.data?.data ?? []);

  const buildPayload = (
    v: FabricPropertyFormValues,
    initial: FabricProperty | null,
  ): Partial<FabricProperty> => ({
    // Kod backend'de üretilir (OZL+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
    ...(initial ? { code: initial.code } : {}),
    name: v.name,
    category: v.category?.trim() || null,
    description: v.description?.trim() || null,
    color: v.color?.trim() || null,
    sortOrder: initial?.sortOrder ?? nextOrder,
    // Backend `stationIds`'i StationProperty bağlarına çevirir (create'te zorunlu,
    // update'te replace). `Partial<FabricProperty>` şeklinde bir alan değil —
    // bilinçli olarak payload'a ek olarak taşınıyor.
    stationIds: v.stationIds,
    valueType: v.valueType,
    // `values` de `stationIds` gibi DÜZ bir liste olarak gider; backend onu
    // FabricPropertyValue satırlarına çevirir (ham nested write YASAK — F209).
    // BAYRAK tipte HİÇ GÖNDERİLMEZ: boş dizi göndermek, tipi Seçim'den Bayrak'a
    // çeviren bir düzenlemede mevcut değerleri sessizce pasifleştirirdi.
    ...(v.valueType === "CHOICE"
      ? {
          values: v.values.map((x, i) => ({
            code: x.code.trim().toUpperCase(),
            name: x.name.trim(),
            sortOrder: (i + 1) * 10,
            isActive: x.isActive,
          })),
        }
      : {}),
    isActive: v.isActive,
  } as Partial<FabricProperty> & { stationIds: string[] });

  return (
    <CrudPage<FabricProperty>
      title="Kumaş Özellikleri"
      description="Yanmazlık, su geçirmezlik gibi kumaş kazanımları."
      entityName="Özellik"
      importEntity="fabricProperty"
      queryKey="fabric-properties"
      service={fabricPropertyService}
      columns={fabricPropertyColumns}
      writePermission="property:write"
      searchPlaceholder="Ad veya kategori ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <FabricPropertyFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPayload(values, initial))}
        />
      )}
    />
  );
}
