// K29 S15b: Hızlı İE rota seçicide "Sahada belirlenir (rotasız)" — rota uygulaması "Okutmayla" iken İLK ve VARSAYILAN.
// Seçenek kimliği S14b'nin sözde rotasıyla aynı (`SCAN_ROUTE_ID`); sunucuya HİÇ gitmez — gövdede `scanRouted: true` olur.
import { SCAN_ROUTE, SCAN_ROUTE_ID } from '../GelenBelge/woCreate/woFromDoc';

export { SCAN_ROUTE_ID };
export const SCAN_ROUTE_HINT = 'Adımlar istasyonda okutuldukça eklenir.';

export const isScanRouteId = (id: string | null | undefined): boolean => id === SCAN_ROUTE_ID;

type Option = { value: string; label: string; sublabel?: string; badge?: { text: string; color: string } };
type Chip = { id: string; name: string; isLast: boolean; isFav: boolean };

/** Seçici listesi: Okutmayla kipinde rotasız seçenek başta; sıralıda liste aynen. */
export function withScanRouteOption<T extends Option>(options: readonly T[], scanMode: boolean): Option[] {
  return scanMode ? [{ value: SCAN_ROUTE_ID, label: SCAN_ROUTE.name, sublabel: SCAN_ROUTE_HINT }, ...options] : [...options];
}

/** Hızlı çipler: Okutmayla kipinde rotasız çip başta (çip sayısı tavanı korunur). */
export function withScanRouteChip(chips: readonly Chip[], scanMode: boolean, max = 4): Chip[] {
  return scanMode ? [{ id: SCAN_ROUTE_ID, name: SCAN_ROUTE.name, isLast: false, isFav: false }, ...chips].slice(0, max) : [...chips];
}

/** Gövdenin rota alanı: rotasız → `scanRouted: true` (rota anahtarı yok); aksi halde bugünkü `routeTemplateId`. */
export function routeBodyOf(routeTemplateId: string | null): { scanRouted: true } | { routeTemplateId: string | null } {
  return isScanRouteId(routeTemplateId) ? { scanRouted: true } : { routeTemplateId };
}

/**
 * Kipe göre olması gereken seçim; `null` = dokunma. Okutmayla + kullanıcı/kısayol seçmediyse rotasız; kip sıralıya
 * döndüyse rotasız seçim düşer (sunucu 400 verirdi).
 */
export function scanRouteDefault(a: { scanMode: boolean; userPicked: boolean; hasInitialRoute: boolean; current: string | null }): { next: string | null } | null {
  if (!a.scanMode) return isScanRouteId(a.current) ? { next: null } : null;
  if (a.userPicked || a.hasInitialRoute || isScanRouteId(a.current)) return null;
  return { next: SCAN_ROUTE_ID };
}
