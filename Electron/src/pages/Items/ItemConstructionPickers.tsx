// =============================================================================
// ÜRÜN FORMU — atkı kartı + desen kartı seçicileri (Seyitoğlu SY-A4, tasarım §2.8)
// =============================================================================
// Yalnız KUMAŞ + dokuma modülü açık + `warpspec:read` varken çizilir (uçlar o kapının arkasında;
// izinsiz kullanıcıda seçici 403 atardı). Görünmüyorsa ya da alan hiç dolmadıysa payload'a anahtar
// GİRMEZ → yapısız üründe istek gövdesi bugünküyle bayt-aynı (`constructionPayload`).
// =============================================================================
import { Controller, type UseFormReturn } from "react-hook-form";
import { Grid3x3, Rows3 } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ItemType } from "@/types/enums";
import type { ItemFormValues } from "./schema";
import type { Item } from "./types";
import { weaveDesignPickerService, weftSpecPickerService, type WeaveDesignRef, type WeftSpecRef } from "./construction-service";

/** Seçiciler çizilir mi — payload kararı da AYNI yüklemden (gizli alanın boşu kartı silmesin). */
export function useConstructionPickersVisible(itemType: ItemType): boolean {
  const dokumaEnabled = useDokumaEnabled();
  const { hasPermission } = useRoleAccess();
  return itemType === ItemType.FABRIC && dokumaEnabled && hasPermission("warpspec:read");
}

/**
 * Alan doluysa id; boşsa ve kayıtta bağ VARDIYSA `null` (temizle); ikisi de yoksa anahtar hiç gitmez.
 * Görünmeyen seçicide hiçbir anahtar gitmez (sunucu `undefined` = dokunma).
 */
export function constructionPayload(
  v: Pick<ItemFormValues, "weftSpecId" | "weaveDesignId">,
  initial: Pick<Item, "weftSpecId" | "weaveDesignId"> | null | undefined,
  visible: boolean,
): { weftSpecId?: string | null; weaveDesignId?: string | null } {
  if (!visible) return {};
  const out: { weftSpecId?: string | null; weaveDesignId?: string | null } = {};
  if (v.weftSpecId) out.weftSpecId = v.weftSpecId;
  else if (initial?.weftSpecId) out.weftSpecId = null;
  if (v.weaveDesignId) out.weaveDesignId = v.weaveDesignId;
  else if (initial?.weaveDesignId) out.weaveDesignId = null;
  return out;
}

export function ItemConstructionPickers({ form }: { form: UseFormReturn<ItemFormValues> }) {
  const err = form.formState.errors;
  return (
    <>
      <FormField label="Atkı kartı (opsiyonel)" error={err.weftSpecId} hint="Atkı sırası, iplikler ve sıklık; maliyet ve dokuma iş emri buradan okur">
        <Controller
          control={form.control}
          name="weftSpecId"
          render={({ field }) => (
            <EntityPickerModal<WeftSpecRef>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={weftSpecPickerService}
              queryKey="weft-specs-item"
              getLabel={(w) => w.name}
              getSubLabel={(w) => w.code}
              icon={Rows3}
              nullable
              noneLabel="Atkı kartı yok"
              title="Atkı kartı seç"
              placeholder="Atkı kartı seç"
            />
          )}
        />
      </FormField>
      <FormField label="Desen kartı (opsiyonel)" error={err.weaveDesignId} hint="Örgü türü, armür planı ve tezgâh desen dosyası">
        <Controller
          control={form.control}
          name="weaveDesignId"
          render={({ field }) => (
            <EntityPickerModal<WeaveDesignRef>
              value={field.value || null}
              onChange={(id) => field.onChange(id ?? "")}
              service={weaveDesignPickerService}
              queryKey="weave-designs-item"
              getLabel={(d) => d.name}
              getSubLabel={(d) => d.code}
              icon={Grid3x3}
              nullable
              noneLabel="Desen kartı yok"
              title="Desen kartı seç"
              placeholder="Desen kartı seç"
            />
          )}
        />
      </FormField>
    </>
  );
}
