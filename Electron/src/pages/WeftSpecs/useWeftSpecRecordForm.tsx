// Atkı kartı seçicisinin satır eylemleri (Yeni · Örnek al; Düzenle → "Kart ekranında aç"): Atkı Kartları ekranının
// aynı penceresi. Atkı kartı birden çok kumaşı besler → kullanım yerinde (seçici) yerinde düzenleme yok.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import type { WeftSpecRef } from "@/pages/Items/construction-service";
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import type { WeftSpecDetail } from "@/pages/WeaveDesigns/types";
import type { ApiResponse } from "@/types/api";
import { weftSpecsPath } from "./open-weft-specs";
import type { WeftCalcCtx } from "./weft-calc";
import { WEFT_SPECS_QUERY_KEY, WeftSpecFormDialog } from "./WeftSpecFormDialog";

// Seçici satırı hafif özet (`WeftSpecRef`); örnek almadan önce tam kart çekilir — tip özet, nesne tam kart.
const asRef = (d: WeftSpecDetail) => d as unknown as WeftSpecRef;

/** `calcCtx`: ürün penceresinden açılınca kumaş bağlamı — yeni kartın hesap paneli atkı boyunu kumaştan alır. */
export function useWeftSpecRecordForm(calcCtx?: WeftCalcCtx): RecordFormSpec<WeftSpecRef> {
  const itemId = calcCtx?.itemId ?? null;
  const rawWidthCm = calcCtx?.rawWidthCm ?? null;
  return useMemo<RecordFormSpec<WeftSpecRef>>(() => ({
    entityName: "Atkı kartı",
    service: {
      create: async (body) => ({ success: true, data: asRef(await weftSpecApi.create(body as Record<string, unknown>)) }) as ApiResponse<WeftSpecRef>,
      // Ulaşılamaz: `isExclusive` yok → Düzenle hep "Kart ekranında aç / Örnek al" penceresine gider.
      update: () => Promise.reject(new Error("Atkı kartı seçiciden düzenlenmez")),
    },
    writePermission: "warpspec:write", // Atkı Kartları ekranı ile aynı
    invalidateKeys: [WEFT_SPECS_QUERY_KEY, "item-construction"],
    // Kod boş, ad "(kopya)" önerisi pencerede (`draft`); tekil kod gövdeye yeni girilir.
    templateRule: {},
    loadFull: async (row) => asRef(await weftSpecApi.get(row.id)),
    cardPath: (w) => weftSpecsPath(w.code),
    renderForm: ({ open, onOpenChange, draft, onSubmit }) => open && (
      <WeftSpecFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={null}
        canWrite
        draft={draft as unknown as Omit<WeftSpecDetail, "id"> | null}
        onSubmit={(body) => onSubmit(body as Partial<WeftSpecRef>)}
        calcCtx={{ itemId, rawWidthCm }}
      />
    ),
  }), [itemId, rawWidthCm]);
}
