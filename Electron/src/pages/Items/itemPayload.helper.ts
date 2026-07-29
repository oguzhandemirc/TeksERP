import { unitForItemType } from "@/types/enums";
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
 */
export function buildItemPayload(
  v: ItemFormValues,
  isEdit: boolean,
): ItemCreatePayload {
  const base = {
    name: v.name.trim(),
    unit: unitForItemType[v.itemType] ?? v.unit,
    isActive: v.isActive,
    allowedColorIds: v.allowedColorIds,
    allowedPropertyIds: v.allowedPropertyIds,
  };
  if (isEdit) return { ...base, pendingReview: false } as unknown as ItemCreatePayload;
  const code = v.code.trim();
  return { ...base, itemType: v.itemType, ...(code ? { code } : {}) };
}
