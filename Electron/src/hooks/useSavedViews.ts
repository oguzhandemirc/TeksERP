import { useCallback } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { SavedView } from "@/types/preferences";

/**
 * Tablo kayıtlı görünümleri — filtre/sıralama/arama URL snapshot'larını
 * isimlendirip saklar. `tableKey` genelde sayfa pathname'i. Backend'e
 * debounce'lu yazılır (usePreferences).
 */
export function useSavedViews(tableKey: string) {
  const { prefs, setPreference } = usePreferences();
  const all = prefs.savedViews ?? {};
  const views = all[tableKey] ?? [];

  const saveView = useCallback(
    (name: string, query: string) => {
      const view: SavedView = { id: crypto.randomUUID(), name, query };
      setPreference({ savedViews: { ...all, [tableKey]: [...views, view] } });
    },
    [all, tableKey, views, setPreference],
  );

  const removeView = useCallback(
    (id: string) => {
      setPreference({ savedViews: { ...all, [tableKey]: views.filter((v) => v.id !== id) } });
    },
    [all, tableKey, views, setPreference],
  );

  return { views, saveView, removeView };
}
