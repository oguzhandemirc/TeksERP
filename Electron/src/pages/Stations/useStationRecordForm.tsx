// İstasyon seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → İstasyonlar ekranı): ekranla aynı form + aynı gövde.
// Kurşun bölümü yalnız kayıtlı istasyonda çizilir; seçiciden yalnız oluşturulduğu için burada hiç görünmez.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { stationService } from "./service";
import { StationFormDialog } from "./StationFormDialog";
import { buildStationPayload } from "./stationPayload";
import type { Station } from "./types";

export function useStationRecordForm(): RecordFormSpec<Station> {
  return useMemo<RecordFormSpec<Station>>(() => ({
    entityName: "İstasyon",
    service: stationService,
    writePermission: "station:write", // İstasyonlar ekranı ile aynı
    invalidateKeys: ["stations"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (s) => `/definitions/stations?search=${encodeURIComponent(s.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <StationFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Partial<Station> | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildStationPayload(v, initial))}
      />
    ),
  }), []);
}
