// Tanımlar › Hizmetler (K3, 2026-11-06): hizmet kalemleri Ürünler listesinden ayrıldı. Aynı `Item` tablosu,
// `itemType = SERVICE` sunucuda süzülür; form sadedir. Fiyatlar Hizmet Fiyat Tablosu'nda (satırdaki bağlantı).
import { useState } from "react";
import { CrudPage } from "@/components/layout/CrudPage";
import { itemService } from "@/pages/Items/service";
import { ItemLifecycleDialog } from "@/pages/Items/ItemLifecycleDialog";
import type { Item } from "@/pages/Items/types";
import { serviceColumns } from "./columns";
import { ServiceFormDialog } from "./ServiceFormDialog";
import { servicePayload } from "./schema";

export const SERVICE_FILTERS = { itemType: "SERVICE" } as const;

export function ServicesPage() {
  const [lifecycleItem, setLifecycleItem] = useState<Item | null>(null);
  return (
    <>
      <CrudPage<Item>
        title="Hizmetler"
        description="Faturalanan hizmetler (kurşun, tambur, brode...). Kademe fiyatları Hizmet Fiyat Tablosu'ndadır."
        entityName="Hizmet"
        queryKey="items"
        service={itemService}
        columns={serviceColumns}
        writePermission="item:write"
        searchPlaceholder="Kod veya ad ara..."
        extraFilters={SERVICE_FILTERS}
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
            onSubmit={(v) => onSubmit(servicePayload(v, initial !== null) as unknown as Partial<Item>)}
          />
        )}
      />
      {lifecycleItem && <ItemLifecycleDialog item={lifecycleItem} onClose={() => setLifecycleItem(null)} />}
    </>
  );
}
