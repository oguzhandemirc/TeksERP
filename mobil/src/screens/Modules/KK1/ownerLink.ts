// =============================================================================
// KK1 — EMANET SAHİBİ (saf kural, G3t): "Bu top müşterinin emanet malı mı?" → hangi müşteri?
// =============================================================================
// Sahiplik DOĞUM niteliğidir (panelde de yalnız girişte verilir); sevkte yalnız o müşteriye
// çıkar. Bayrak kapalıyken seçici HİÇ çizilmez ve payload bugünküyle birebir (alan yok).
// Seçim kayıttan sonra KALIR (yarı mamul kalıbı: saha bir müşterinin malını arka arkaya girer);
// "Emanet değil" ile temizlenir. Ham ve yarı mamul modunun İKİSİNDE de sorulur (panel emsali:
// müşterinin boyalı kumaşı da emanet olabilir).
// =============================================================================

export interface OwnerLinkState {
  ownerCustomerId: string | null;
  /** Yalnız gösterim (bağlamdan gelen ad); payload'a girmez. */
  ownerLabel: string;
}

export const EMPTY_OWNER_LINK: OwnerLinkState = { ownerCustomerId: null, ownerLabel: '' };

/** Seçici yalnız emanet modülü açıkken çizilir (moddan bağımsız). */
export function isOwnerPickerVisible(emanetEnabled: boolean): boolean {
  return emanetEnabled;
}

/** Payload parçası: görünmüyorsa ya da seçim yoksa BOŞ nesne (bugünkü payload birebir); seçimse id. */
export function ownerLinkPayload(state: OwnerLinkState, emanetEnabled: boolean): { ownerCustomerId?: string } {
  if (!isOwnerPickerVisible(emanetEnabled) || !state.ownerCustomerId) return {};
  return { ownerCustomerId: state.ownerCustomerId };
}
