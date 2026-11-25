// Depo seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → Depolar ekranı): liste ekranıyla aynı form + aynı gövde.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { buildWarehousePayload } from "./schema";
import { warehouseService } from "./service";
import type { Warehouse } from "./types";
import { WarehouseFormDialog } from "./WarehouseFormDialog";

export function useWarehouseRecordForm(): RecordFormSpec<Warehouse> {
  return useMemo<RecordFormSpec<Warehouse>>(() => ({
    entityName: "Depo",
    service: warehouseService,
    writePermission: "warehouse:write", // Depolar ekranı ile aynı
    invalidateKeys: ["warehouses"],
    // Kod sunucuda üretilir; "varsayılan depo" damgası ve hareketler kopyalanmaz (gövde allowlist'i zaten almaz).
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (w) => `/definitions/warehouses?search=${encodeURIComponent(w.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <WarehouseFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<Warehouse> | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildWarehousePayload(v, initial))}
      />
    ),
  }), []);
}
