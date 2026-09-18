import { ItemType, unitForItemType } from "@/types/enums";
import type { ItemCreatePayload } from "./types";
import type { ItemFormValues } from "./schema";

/**
 * Form değerlerinden API payload'u.
 * - Edit: code/itemType payload'a GİRMEZ (backend FORBIDDEN listesi reddeder).
 *   Ayrıca pendingReview:false gönderilir — admin bir deseni açıp kaydettiğinde
 *   saha "onay bekliyor" işareti temizlenir (zaten false ise no-op).
 * - Create: kod boşsa payload'a GİRMEZ — backend STK-NNNNNN otomatik üretir;
 *   doluysa manuel kod olarak gönderilir. Admin create'i asla pendingReview
 *   göndermez → backend default false.
 * - İzinli renk/özellik YALNIZ KUMAŞ taşır (kullanıcı kararı 2026-09-17): iplik/sarf
 *   create'inde anahtar HİÇ gitmez; edit'inde `[]` gider — eski iplik kartında kalmış
 *   liste kaydedince KALDIRILIR (backend `undefined` = dokunma, `[]` = temizle).
 */
export const itemCarriesAllowedLists = (itemType: ItemType): boolean => itemType === ItemType.FABRIC;

export function buildItemPayload(
  v: ItemFormValues,
  isEdit: boolean,
): ItemCreatePayload {
  const base = {
    name: v.name.trim(),
    unit: unitForItemType[v.itemType] ?? v.unit,
    isActive: v.isActive,
    // Boş alan `null` gider: "" Decimal kolonunda geçersizdir ve kolonu
    // temizlemenin tek yolu budur (alan yalnız YARN'da çizilir, diğer
    // tiplerde zaten boş kalır).
    linearDensityDen: v.linearDensityDen.trim() === "" ? null : v.linearDensityDen.trim(),
    // E4: çözgü kartı yalnız KUMAŞ taşır; öteki tiplerde `null` gider (sunucu FABRIC dışını 400'ler, boş = temizle).
    warpSpecId: v.itemType === ItemType.FABRIC && v.warpSpecId ? v.warpSpecId : null,
  };
  const lists = itemCarriesAllowedLists(v.itemType)
    ? { allowedColorIds: v.allowedColorIds, allowedPropertyIds: v.allowedPropertyIds }
    : isEdit
      ? { allowedColorIds: [], allowedPropertyIds: [] }
      : {};
  if (isEdit) return { ...base, ...lists, pendingReview: false } as unknown as ItemCreatePayload;
  const code = v.code.trim();
  return { ...base, ...lists, itemType: v.itemType, ...(code ? { code } : {}) };
}
