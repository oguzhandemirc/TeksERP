// Üst çubuktaki büyüteçle açılıp kapanan arama kutusunun durumu (saf). Kapatmak metni de temizler:
// kapalı kutunun görünmeyen bir süzgeci listeyi sessizce daraltmasın (karar K6a, 2026-11-11).

export interface CollapsibleSearchState {
  open: boolean;
  text: string;
}

export type CollapsibleSearchAction = { type: 'toggle' } | { type: 'close' } | { type: 'text'; text: string };

export const SEARCH_CLOSED: CollapsibleSearchState = { open: false, text: '' };

export function collapsibleSearchReducer(
  state: CollapsibleSearchState,
  action: CollapsibleSearchAction,
): CollapsibleSearchState {
  switch (action.type) {
    case 'toggle':
      return state.open ? SEARCH_CLOSED : { open: true, text: '' };
    case 'close':
      return state.open || state.text ? SEARCH_CLOSED : state;
    case 'text':
      // Kapalı kutuya metin yazılamaz; gecikmiş bir onChangeText süzgeci geri getirmesin.
      return state.open ? { open: true, text: action.text } : state;
  }
}

/** Listeye giden arama terimi — yalnız açık kutudan, kırpılmış. */
export function activeSearchTerm(state: CollapsibleSearchState): string {
  return state.open ? state.text.trim() : '';
}
