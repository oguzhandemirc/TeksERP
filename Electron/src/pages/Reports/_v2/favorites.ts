// Rapor favorileri — `UserPreference.preferences.raporlar.favoriler` (kişisel, ayrı tablo YOK).
// Saklanan şey katalog ANAHTARIDIR; çizim anında katalog + kapıdan geçmeyen anahtar sessizce düşer
// (rapor kapandıysa favori şeridi onu göstermez ama tercihten de silmez — açılınca geri gelir).
import { useCallback, useMemo } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

export function toggleFavorite(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function useReportFavorites() {
  const { prefs, setPreference } = usePreferences();
  const favorites = useMemo(() => prefs.raporlar?.favoriler ?? [], [prefs.raporlar?.favoriler]);
  const isFavorite = useCallback((key: string) => favorites.includes(key), [favorites]);
  const toggle = useCallback(
    (key: string) => setPreference({ raporlar: { ...prefs.raporlar, favoriler: toggleFavorite(favorites, key) } }),
    [favorites, prefs.raporlar, setPreference],
  );
  return { favorites, isFavorite, toggle };
}
