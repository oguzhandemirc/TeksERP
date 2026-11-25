// Çözgü kartı seçicisinin kayıt formu: Çözgü Kartları ekranıyla aynı form + gövde (`buildPayload`).
// Örnek al taslağı `copyDraft` (kod boş, "(kopya)"); kullanım yerinde Düzenle yalnız `isExclusive` kartta.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { WarpSpecFormDialog } from "./WarpSpecFormDialog";
import { buildPayload, copyDraft } from "./payload";
import { warpSpecService } from "./service";
import type { WarpSpec } from "./types";
import { useReedUnit } from "@/hooks/useReedUnit";

export function useWarpSpecRecordForm(isExclusive?: (row: WarpSpec) => boolean): RecordFormSpec<WarpSpec> {
  const reedUnit = useReedUnit();
  return useMemo<RecordFormSpec<WarpSpec>>(() => ({
    entityName: "Çözgü kartı",
    service: warpSpecService,
    writePermission: "warpspec:write",
    invalidateKeys: ["warp-specs"],
    // Tekil alanları `copyDraft` boşaltır/önerir (Çözgü Kartları "Örnek al" ile aynı taslak).
    templateRule: {},
    // Liste satırında iplik satırları eksik olabilir — taslak ve düzenleme tam karttan.
    loadFull: async (row) => (await warpSpecService.getById(row.id)).data,
    isExclusive,
    cardPath: (w) => `/definitions/warp-specs?search=${encodeURIComponent(w.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => open && (
      <WarpSpecFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft ? copyDraft(draft as Omit<WarpSpec, "id">, reedUnit) : null}
        isSubmitting={isSubmitting}
        // `yarns` satır gövdesi WarpSpec tipinde yok (yazım sözleşmesi).
        onSubmit={(values) => onSubmit(buildPayload(values, reedUnit) as unknown as Partial<WarpSpec>)}
      />
    ),
  }), [isExclusive, reedUnit]);
}
