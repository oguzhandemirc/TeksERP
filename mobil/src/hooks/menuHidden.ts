import type { MobileScreenMeta } from '../types/permissions';

/**
 * Ana sayfa ızgarasından HER ZAMAN kalkan karolar (kullanıcı kararı 2026-11-08): iş emri açmanın mobil girişi İş
 * Emirleri sayfası ("Okut"); ekran kodu ve route duruyor (visibleScreens değişmez, bağlantılar açılır).
 */
export const HOME_GRID_HIDDEN_SCREENS = ['HizliIsEmri', 'GelenBelge'] as const;

/** Izgaradan sabit gizlileri düşürür (saf); HER karoyu düşürecekse süzülmez — boş ekranda kalınmasın. */
export function filterHomeGridHidden(screens: MobileScreenMeta[]): MobileScreenMeta[] {
  const out = screens.filter((s) => !(HOME_GRID_HIDDEN_SCREENS as readonly string[]).includes(s.key));
  return out.length === 0 ? screens : out;
}

/**
 * K19 menü düzeni süzgeci (saf): gizlenen ekranın karosu ana ekrandan kalkar. Liste boş / okunamadı (eski sunucu)
 * → bugünkü grid. Süzgeç HER karoyu düşürecekse süzülmez — kullanıcı çıkışsız boş ekranda kalmasın.
 */
export function filterMenuHidden(screens: MobileScreenMeta[], hidden: readonly string[] | undefined): MobileScreenMeta[] {
  if (!hidden || hidden.length === 0) return screens;
  const set = new Set(hidden);
  const out = screens.filter((s) => !set.has(s.key));
  return out.length === 0 ? screens : out;
}

/**
 * Verilen ekranlardan biri ana ekranda (izin ∖ modül ∖ K19 gizli) karo olarak görünüyor mu? Karosu olmayan
 * işlevin yan yüzeylerdeki süzgeç/sekmesi bununla gizlenir (Depo'da Kartela sekmeleri, QA 2026-11-03).
 */
export function anyOnMenu(
  visible: MobileScreenMeta[],
  hidden: readonly string[] | undefined,
  keys: readonly string[],
): boolean {
  return filterMenuHidden(visible, hidden).some((s) => keys.includes(s.key));
}
