import type { MobileScreenMeta } from '../types/permissions';

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
