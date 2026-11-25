// Desen seçicisinin satır eylemleri (Yeni · Örnek al; Düzenle → desen kartı sayfası): Desen Kartları ekranının aynı
// "Yeni desen kartı" ve "Örnek al" pencereleri. Desen editörü tam sayfa olduğundan yerinde düzenleme hiç yok.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import type { WeaveDesignRef } from "@/pages/Items/construction-service";
import type { ApiResponse } from "@/types/api";
import { weaveDesignApi } from "./service";
import type { WeaveDesign, WeaveDesignInput } from "./types";
import { WeaveDesignCopyDialog } from "./WeaveDesignCopyDialog";
import { WeaveDesignCreateDialog } from "./WeaveDesignCreateDialog";

// Seçici satırı hafif özet (`WeaveDesignRef`); örnek almadan önce tam kart çekilir — tip özet, nesne tam kart.
const asRef = (d: WeaveDesign) => d as unknown as WeaveDesignRef;

export function useWeaveDesignRecordForm(): RecordFormSpec<WeaveDesignRef> {
  return useMemo<RecordFormSpec<WeaveDesignRef>>(() => ({
    entityName: "Desen kartı",
    service: {
      create: async (body) => ({ success: true, data: asRef(await weaveDesignApi.create(body as WeaveDesignInput)) }) as ApiResponse<WeaveDesignRef>,
      // Ulaşılamaz: `isExclusive` yok → Düzenle hep kart sayfasına gider.
      update: () => Promise.reject(new Error("Desen kartı seçiciden düzenlenmez")),
    },
    writePermission: "warpspec:write", // Desen Kartları ekranı ile aynı
    invalidateKeys: ["weave-designs"],
    // Kod/ad kopya penceresinde sorulur; kod kaynak başlığında görünür (kimlik alanı değil, gövdeye yeni kod gider).
    templateRule: {},
    loadFull: async (row) => asRef(await weaveDesignApi.get(row.id)),
    cardPath: (d) => `/definitions/weave-designs/${d.id}`,
    renderForm: ({ open, onOpenChange, mode, draft, onSubmit }) => {
      if (!open) return null;
      const close = () => onOpenChange(false);
      const submit = (body: WeaveDesignInput) => onSubmit(body as Partial<WeaveDesignRef>);
      if (mode === "template" && draft) return <WeaveDesignCopyDialog source={draft as unknown as WeaveDesign} onClose={close} onSubmit={submit} />;
      return <WeaveDesignCreateDialog onClose={close} onSubmit={submit} />;
    },
  }), []);
}
