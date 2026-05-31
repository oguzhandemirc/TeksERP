import { useCallback } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

/**
 * Favori (sabitlenen) sayfa yönetimi — kullanıcı tercihlerinde (sidebar.favorites)
 * route pathname listesi tutar. Sidebar "Favoriler" bölümü ve PageHeader yıldızı
 * bunu kullanır. Backend'e debounce'lu yazılır (usePreferences).
 */
export function useFavorites() {
  const { prefs, setPreference } = usePreferences();
  const favorites = prefs.sidebar?.favorites ?? [];

  const isFavorite = useCallback((to: string) => favorites.includes(to), [favorites]);

  const toggleFavorite = useCallback(
    (to: string) => {
      const next = favorites.includes(to)
        ? favorites.filter((f) => f !== to)
        : [...favorites, to];
      setPreference({ sidebar: { ...prefs.sidebar, favorites: next } });
    },
    [favorites, prefs.sidebar, setPreference],
  );

  /** Favori sırasını günceller. Görünmeyen (yetkisiz/çözülemeyen) favoriler
   *  sürükleme listesinde olmaz; onları sona ekleyip korur. */
  const reorderFavorites = useCallback(
    (order: string[]) => {
      const inOrder = new Set(order);
      const rest = favorites.filter((f) => !inOrder.has(f));
      setPreference({ sidebar: { ...prefs.sidebar, favorites: [...order, ...rest] } });
    },
    [favorites, prefs.sidebar, setPreference],
  );

  return { favorites, isFavorite, toggleFavorite, reorderFavorites };
}
