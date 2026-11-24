// Tanımlar › Hizmet Kartları: hizmetler ürün kartlarından AYRI tabloda (`service_items`, `/api/service-items`).
// "Kullanımdan kaldır" yaşam döngüsü diyaloğu (canlı referans listesi). Fiyatlar Hizmet Fiyat Tablosu'nda.
// Formdaki "Süreçler" kart kaydının ardından yazılır (`withProcessWrite`, B16).
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CrudPage } from "@/components/layout/CrudPage";
import { ItemLifecycleDialog } from "@/pages/Items/ItemLifecycleDialog";
import { serviceColumns } from "./columns";
import { ServiceFormDialog } from "./ServiceFormDialog";
import { servicePayload } from "./schema";
import { serviceItemLifecycleApi, serviceItemService } from "./service";
import { SERVICE_PROCESS_MAP_QUERY_KEY } from "./serviceProcesses";
import { withProcessWrite } from "./serviceProcessWrite";
import type { ServiceItem } from "./types";

export const SERVICE_ITEMS_QUERY_KEY = "service-items";

export function ServicesPage() {
  const qc = useQueryClient();
  const [lifecycleItem, setLifecycleItem] = useState<ServiceItem | null>(null);
  const pendingProcesses = useRef<string[] | null>(null);
  const service = useMemo(
    () =>
      withProcessWrite(
        serviceItemService,
        () => pendingProcesses.current,
        () => void qc.invalidateQueries({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY }),
      ),
    [qc],
  );
  return (
    <>
      <CrudPage<ServiceItem>
        title="Hizmet Kartları"
        description="Faturalanan hizmetler (kurşun, tambur, brode...). Ürün kartlarından ayrıdır; kademe fiyatları Hizmet Fiyat Tablosu'ndadır."
        entityName="Hizmet kartı"
        queryKey={SERVICE_ITEMS_QUERY_KEY}
        service={service}
        columns={serviceColumns}
        writePermission="item:write"
        searchHint="Kod veya ad"
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
            onSubmit={async (v, processIds) => {
              pendingProcesses.current = processIds;
              try {
                await onSubmit(servicePayload(v, initial !== null) as unknown as Partial<ServiceItem>);
              } finally {
                pendingProcesses.current = null;
              }
            }}
          />
        )}
      />
      {lifecycleItem && (
        <ItemLifecycleDialog item={lifecycleItem} api={serviceItemLifecycleApi} onClose={() => setLifecycleItem(null)} />
      )}
    </>
  );
}
