// =============================================================================
// MÜLKİYET (T3) — tablette "bu top bizim mi, müşterinin emaneti mi?" saf kuralları
// =============================================================================
// Soru sunucuda tek kaynakta (`stock-ownership.helper.ts`: emanet = `ownerCustomerId` dolu); tablet
// yalnız süzgeç değerini yollar ve rozeti çizer. Emanet modülü KAPALIYKEN ikisi de yok: istek
// parametresi gönderilmez, rozet çizilmez → ekran ve istek bugünküyle bayt-aynı.
// =============================================================================

/** Sunucunun `filter[mulkiyet]` değerleri; ALL = süzgeç yok (parametre gönderilmez). */
export type OwnershipScope = 'ALL' | 'OWN' | 'CONSIGNED';

export const OWNERSHIP_TABS: readonly { key: OwnershipScope; label: string }[] = [
  { key: 'ALL', label: 'Tümü' },
  { key: 'OWN', label: 'Bizim' },
  { key: 'CONSIGNED', label: 'Emanet' },
];

/** Modül kapalıysa seçim ne olursa olsun ALL — kapanan modülde kalmış "Emanet" seçimi listeyi daraltmasın. */
export function effectiveOwnershipScope(emanetOn: boolean, scope: OwnershipScope): OwnershipScope {
  return emanetOn ? scope : 'ALL';
}

/** Liste/şerit/kapsam isteğine eklenecek süzgeç parçası; ALL → boş (eski istekle aynı). */
export function ownershipFilter(scope: OwnershipScope): { mulkiyet?: OwnershipScope } {
  return scope === 'ALL' ? {} : { mulkiyet: scope };
}

export interface OwnedRollLike {
  ownerCustomerId?: string | null;
  ownerCustomer?: { id: string; name: string } | null;
}

/**
 * Satır rozeti: emanet açık + top sahipli → `{ name }` (ad yoksa null: eski sunucu adı yollamaz,
 * rozet yine "Emanet" der); aksi halde null (rozet yok).
 */
export function ownerBadgeOf(emanetOn: boolean, roll: OwnedRollLike): { name: string | null } | null {
  if (!emanetOn) return null;
  const id = roll.ownerCustomerId ?? roll.ownerCustomer?.id ?? null;
  if (!id) return null;
  return { name: roll.ownerCustomer?.name?.trim() || null };
}
