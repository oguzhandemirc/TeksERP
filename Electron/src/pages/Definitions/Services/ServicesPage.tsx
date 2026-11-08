// Tanımlar › Hizmet Kartları: hizmetler ürün kartlarından AYRI tabloda (`service_items`, `/api/service-items`).
// Form sadedir; "Kullanımdan kaldır" yaşam döngüsü diyaloğu (canlı referans listesi). Fiyatlar Hizmet Fiyat Tablosu'nda.
import { useState } from "react";
import { CrudPage } from "@/components/layout/CrudPage";
import { ItemLifecycleDialog } from "@/pages/Items/ItemLifecycleDialog";
import { serviceColumns } from "./columns";
import { ServiceFormDialog } from "./ServiceFormDialog";
import { servicePayload } from "./schema";
import { serviceItemLifecycleApi, serviceItemService } from "./service";
import type { ServiceItem } from "./types";

export const SERVICE_ITEMS_QUERY_KEY = "service-items";

export function ServicesPage() {
  const [lifecycleItem, setLifecycleItem] = useState<ServiceItem | null>(null);
  return (
    <>
      <CrudPage<ServiceItem>
        title="Hizmet Kartları"
        description="Faturalanan hizmetler (kurşun, tambur, brode...). Ürün kartlarından ayrıdır; kademe fiyatları Hizmet Fiyat Tablosu'ndadır."
        entityName="Hizmet kartı"
        queryKey={SERVICE_ITEMS_QUERY_KEY}
        service={serviceItemService}
        columns={serviceColumns}
        writePermission="item:write"
        searchPlaceholder="Kod veya ad ara..."
        onRemove={setLifecycleItem}
        removeLabel="Kullanımdan kaldır"
        onRestore={setLifecycleItem}
        restoreLabel="Yeniden kullanıma al"
        renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
          <ServiceFormDialog
            open={open}
            onOpenChange={onOpenChange}
            initial={initial}
            isSubmitting={isSubmitting}
            onSubmit={(v) => onSubmit(servicePayload(v, initial !== null) as unknown as Partial<ServiceItem>)}
          />
        )}
      />
      {lifecycleItem && (
        <ItemLifecycleDialog item={lifecycleItem} api={serviceItemLifecycleApi} onClose={() => setLifecycleItem(null)} />
      )}
    </>
  );
}
