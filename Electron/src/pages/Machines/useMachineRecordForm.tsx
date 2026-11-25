// Makine seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → Makineler ekranı): liste ekranıyla aynı form + aynı gövde.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { buildMachinePayload } from "./machinePayload";
import { MachineFormDialog } from "./MachineFormDialog";
import { machineService } from "./service";
import type { Machine } from "./types";

export function useMachineRecordForm(): RecordFormSpec<Machine> {
  return useMemo<RecordFormSpec<Machine>>(() => ({
    entityName: "Makine",
    service: machineService,
    writePermission: "station:write", // Makineler ekranı ile aynı
    invalidateKeys: ["machines", "stations"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (m) => `/definitions/machines?search=${encodeURIComponent(m.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <MachineFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<Machine> | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildMachinePayload(v, initial))}
      />
    ),
  }), []);
}
