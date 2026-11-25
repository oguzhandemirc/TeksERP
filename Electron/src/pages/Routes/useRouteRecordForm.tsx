// Rota seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → Üretim Rotaları ekranı): ekranla aynı form + aynı gövde.
// Rota şablonu ortak kayıttır (çok iş emri/şablon kullanır) → seçicide yerinde düzenlenmez.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { RouteFormDialog } from "./RouteFormDialog";
import { buildRoutePayload } from "./routePayload";
import { routeService } from "./service";
import type { ProductionRoute } from "./types";

export function useRouteRecordForm(): RecordFormSpec<ProductionRoute> {
  return useMemo<RecordFormSpec<ProductionRoute>>(() => ({
    entityName: "Rota",
    service: routeService,
    writePermission: "station:write", // Üretim Rotaları ekranı ile aynı
    invalidateKeys: ["routes"],
    // "(kopya)" adı ve kısayol/favori sıfırlaması formun "Şuradan kopyala" değer kurucusundan gelir.
    templateRule: { clear: ["code"] },
    // Seçici satırı adımları taşımayabilir — örnek almadan önce tam rota (adımlar + fason planı) çekilir.
    loadFull: async (row) => (await routeService.getById(row.id)).data,
    cardPath: (r) => `/definitions/routes?search=${encodeURIComponent(r.name)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <RouteFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as ProductionRoute | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildRoutePayload(v, initial !== null) as unknown as Partial<ProductionRoute>)}
      />
    ),
  }), []);
}
