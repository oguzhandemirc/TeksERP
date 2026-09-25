// =============================================================================
// ÜRÜN KARTI YAŞAM DÖNGÜSÜ — backend `helpers/item-lifecycle-data.helper.ts` ve panel
// `Electron/src/lib/item-lifecycle.ts` tablet İKİZİ (URUN-YASAM-DONGUSU.md §9)
// =============================================================================
// Seçici kapsamı yalnız operatörün seçemeyeceği kartı listede göstermemek içindir;
// kararı her kayıtta sunucu verir (mesajı olduğu gibi gösterilir).
// =============================================================================
import type { ItemLifecycleStatus } from '../types/models';

export const ITEM_LIFECYCLE_LABEL: Record<ItemLifecycleStatus, string> = {
  ACTIVE: 'Aktif',
  PHASE_OUT: 'Tükenene kadar',
  ARCHIVED: 'Pasif',
};

/** Kartın durumu — `lifecycleStatus` taşımayan eski sunucuda `isActive`ten türetilir. */
export function itemLifecycleOf(it: { lifecycleStatus?: ItemLifecycleStatus | null; isActive?: boolean } | null | undefined): ItemLifecycleStatus {
  return it?.lifecycleStatus ?? (it?.isActive === false ? 'ARCHIVED' : 'ACTIVE');
}

/** Seçicinin kullanım sınıfı: sipariş kalemi (A1) · belgesiz stok girişi (C) · yeni üretim planı (A3). */
export type ItemPickUse = 'order' | 'stock' | 'plan';

/** Seçicide listelenecek durumlar (`filter[lifecycleStatus]`). Ayar yüklenmemişse backend varsayılanı. */
export function pickableLifecycle(
  use: ItemPickUse,
  flags?: { itemPhaseOutNewOrder?: string; itemPhaseOutNewPlan?: boolean } | null,
): string {
  const phaseOut = use === 'order' ? flags?.itemPhaseOutNewOrder === 'SERBEST' : use === 'plan' ? flags?.itemPhaseOutNewPlan !== false : false;
  return phaseOut ? 'ACTIVE,PHASE_OUT' : 'ACTIVE';
}

/** Seçici satırı rozeti — yalnız Tükenene kadar kartta (PickerModal `badge`). */
export function lifecycleBadge(it: { lifecycleStatus?: ItemLifecycleStatus | null; isActive?: boolean } | null | undefined, color: string): { text: string; color: string } | undefined {
  return itemLifecycleOf(it) === 'PHASE_OUT' ? { text: ITEM_LIFECYCLE_LABEL.PHASE_OUT, color } : undefined;
}
