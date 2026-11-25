// Hizmet kartı seçicisinin kayıt formu (Yeni · Örnek al; Düzenle kart ekranında): liste ekranıyla aynı
// form + aynı gövde (`servicePayload`) + aynı süreç yazımı (`withProcessWrite`).
import { useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { ServiceFormDialog } from "./ServiceFormDialog";
import { servicePayload } from "./schema";
import { serviceItemService } from "./service";
import { SERVICE_PROCESS_MAP_QUERY_KEY } from "./serviceProcesses";
import { withProcessWrite } from "./serviceProcessWrite";
import type { ServiceItem } from "./types";

export function useServiceRecordForm(): RecordFormSpec<ServiceItem> {
  const qc = useQueryClient();
  const pending = useRef<string[] | null>(null);
  return useMemo<RecordFormSpec<ServiceItem>>(() => ({
    entityName: "Hizmet kartı",
    service: withProcessWrite(
      serviceItemService,
      () => pending.current,
      () => void qc.invalidateQueries({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY }),
    ),
    writePermission: "item:write",
    invalidateKeys: ["service-items"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (s) => `/definitions/services?search=${encodeURIComponent(s.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <ServiceFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft}
        isSubmitting={isSubmitting}
        onSubmit={async (v, processIds) => {
          pending.current = processIds;
          try {
            await onSubmit(servicePayload(v, initial !== null) as unknown as Partial<ServiceItem>);
          } finally {
            pending.current = null;
          }
        }}
      />
    ),
  }), [qc]);
}
