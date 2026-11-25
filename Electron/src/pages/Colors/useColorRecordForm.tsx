// Renk seçicisinin kayıt formu (Örnek al; Düzenle → Renkler ekranı; Yeni = seçicideki hızlı ekle şeridi).
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { ColorFormDialog } from "./ColorFormDialog";
import { colorService } from "./service";
import type { Color } from "./types";

export function useColorRecordForm(): RecordFormSpec<Color> {
  return useMemo<RecordFormSpec<Color>>(() => ({
    entityName: "Renk",
    service: colorService,
    writePermission: "property:write", // Renkler ekranı ve backend color.routes ile aynı
    invalidateKeys: ["colors", "color", "color-picker"],
    // Kod sunucuda üretilir (RNK+…) — taslakta boş.
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    cardPath: (c) => `/definitions/colors?search=${encodeURIComponent(c.code ?? c.name)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <ColorFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft}
        isSubmitting={isSubmitting}
        onSubmit={(v) =>
          onSubmit({
            ...(initial?.code ? { code: initial.code } : {}),
            name: v.name,
            hex: v.hex || null,
            isActive: v.isActive,
            customerIds: v.customerIds,
          } as Partial<Color>)
        }
      />
    ),
  }), []);
}
