// =============================================================================
// ÜRÜN YAŞAM DÖNGÜSÜ — yazılan verinin TEK biçimi (bağımlılıksız yaprak modül)
// =============================================================================
// `items.isActive` YALNIZ buradan türer (D3: isActive = lifecycleStatus <> ARCHIVED).
// Yaprak tutuldu: birleştirme servisi de kullanır ve `item-lifecycle.helper` onu
// dolaylı olarak içe aktardığı için ikisi aynı dosyada döngü kurardı.
// =============================================================================
import { ItemLifecycleStatus } from "@prisma/client";

export const ITEM_LIFECYCLE_LABEL: Record<ItemLifecycleStatus, string> = {
  ACTIVE: "Aktif",
  PHASE_OUT: "Tükenene kadar",
  ARCHIVED: "Pasif",
};

export function itemLifecycleWriteData(to: ItemLifecycleStatus, userId: string | null | undefined, reason: string | null) {
  return {
    lifecycleStatus: to,
    isActive: to !== ItemLifecycleStatus.ARCHIVED,
    lifecycleChangedAt: new Date(),
    lifecycleChangedById: userId ?? null,
    lifecycleReason: reason ? reason.slice(0, 500) : null,
  };
}

/** Kartın DOĞUŞ durumu — geçiş değil (damga yazılmaz); `isActive:false` ile doğan kart Pasif doğar. */
export function itemBirthLifecycleData(isActive: boolean | undefined) {
  const to = isActive === false ? ItemLifecycleStatus.ARCHIVED : ItemLifecycleStatus.ACTIVE;
  return { lifecycleStatus: to, isActive: to !== ItemLifecycleStatus.ARCHIVED };
}
