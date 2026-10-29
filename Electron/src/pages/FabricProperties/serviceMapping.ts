// =============================================================================
// HİZMET KALEMİ EŞLEMESİ — panel saf katmanı (Gülkesim dalga 2 · H6b, karar belgesi §5)
// =============================================================================
// Backend sözleşmesi (H6, `service-item-mapping.helper.ts`): gövdede `serviceItemId`
// YOKSA eşlemeye dokunulmaz, null ise kaldırılır. Panel bu yüzden alanı YALNIZ
// DEĞİŞTİYSE gönderir — başka bir alanı düzelten kaydetme eşlemeyi ezmez.
// Önizleme yalnız GÖSTERİR; faturada kalemi `resolveServiceItemsForRolls` çözer
// (sıra: değer → özellik → ana bayrak). Burada hesap/fiyat yok.
// =============================================================================
import type { FabricProperty } from "./types";

export interface ServiceItemOption {
  id: string;
  code: string;
  name: string;
}

/** Hizmet kalemi seçicisinin sunucu süzgeci: yalnız aktif SERVICE kalemleri. */
export const SERVICE_ITEM_PICKER_FILTERS = { isActive: "true", itemType: "SERVICE" } as const;

const norm = (v: string | null | undefined): string | null => (v ? v : null);

/** Özellik düzeyi: yeni kayıtta yalnız seçiliyse; düzenlemede yalnız değiştiyse. */
export function propertyServiceItemPatch(
  initial: FabricProperty | null,
  next: string | null,
): { serviceItemId?: string | null } {
  const before = initial ? norm(initial.serviceItemId) : null;
  return norm(next) === before ? {} : { serviceItemId: norm(next) };
}

/** Değer satırı: kayıtlı koddaki eşlemeyle aynıysa alan GÖNDERİLMEZ (backend korur). */
export function valueServiceItemPatch(
  initial: FabricProperty | null,
  code: string,
  next: string | null,
): { serviceItemId?: string | null } {
  const saved = (initial?.values ?? []).find((v) => v.code.toUpperCase() === code.toUpperCase());
  const before = saved ? norm(saved.serviceItemId) : null;
  return norm(next) === before ? {} : { serviceItemId: norm(next) };
}

export type ServiceHintSource = "VALUE" | "PROPERTY" | "PARENT_FLAG" | "NONE";

export interface ServiceHint {
  source: ServiceHintSource;
  serviceItemId: string | null;
  /** PARENT_FLAG'de ana bayrağın adı. */
  parentName?: string;
}

/** Çözücünün sırası (`service-pricing.helper.ts` loadValueServiceMap): değer → özellik → ana bayrak. */
export function resolveServiceHint(
  valueServiceItemId: string | null | undefined,
  propertyServiceItemId: string | null | undefined,
  parent: Pick<FabricProperty, "name" | "serviceItemId"> | null | undefined,
): ServiceHint {
  if (norm(valueServiceItemId)) return { source: "VALUE", serviceItemId: valueServiceItemId! };
  if (norm(propertyServiceItemId)) return { source: "PROPERTY", serviceItemId: propertyServiceItemId! };
  if (parent && norm(parent.serviceItemId)) {
    return { source: "PARENT_FLAG", serviceItemId: parent.serviceItemId!, parentName: parent.name };
  }
  return { source: "NONE", serviceItemId: null };
}

export const serviceItemLabel = (id: string, items: readonly ServiceItemOption[]): string => {
  const it = items.find((i) => i.id === id);
  return it ? `${it.code} — ${it.name}` : "Pasif ya da silinmiş hizmet kalemi";
};

/** Değer satırının altındaki tek cümle. */
export function serviceHintText(hint: ServiceHint, items: readonly ServiceItemOption[]): string {
  if (hint.source === "NONE" || !hint.serviceItemId)
    return "Hizmet kalemi eşlenmemiş — bu gramaj faturaya kalem olarak düşmez.";
  const label = serviceItemLabel(hint.serviceItemId, items);
  const from =
    hint.source === "VALUE"
      ? "kendi eşlemesi"
      : hint.source === "PROPERTY"
        ? "özelliğin eşlemesi"
        : `ana bayrak "${hint.parentName ?? ""}" eşlemesi`;
  return `Bu gramaj ${label} olarak faturalanır (${from}).`;
}

/** Bölüm görünürlüğü: hiç hizmet kalemi yoksa ve eşleme de yoksa form bugünkü gibi kalır. */
export function showServiceMapping(
  items: readonly ServiceItemOption[],
  initial: FabricProperty | null,
): boolean {
  if (items.length > 0) return true;
  if (!initial) return false;
  return Boolean(initial.serviceItemId) || (initial.values ?? []).some((v) => Boolean(v.serviceItemId));
}
