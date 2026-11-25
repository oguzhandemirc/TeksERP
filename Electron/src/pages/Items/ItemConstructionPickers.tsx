// =============================================================================
// ÜRÜN FORMU — atkı kartı + desen kartı bağının görünürlük/gövde kararı (Seyitoğlu SY-A4, tasarım §2.8)
// =============================================================================
// Yalnız KUMAŞ + dokuma modülü açık + `warpspec:read` varken (uçlar o kapının arkasında; izinsiz
// kullanıcıda seçici 403 atardı). Görünmüyorsa ya da alan hiç dolmadıysa payload'a anahtar
// GİRMEZ → yapısız üründe istek gövdesi bugünküyle bayt-aynı (`constructionPayload`).
// Seçiciler ürün penceresinin Atkı / Desen sekmelerinde (`construction/`).
// =============================================================================
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ItemType } from "@/types/enums";
import type { ItemFormValues } from "./schema";
import type { Item } from "./types";

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
