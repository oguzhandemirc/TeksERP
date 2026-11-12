import { useCallback } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { DEFAULT_APPEARANCE, appearancePatch, resolveAppearance, type Appearance } from "./appearance";

export interface AppearanceApi {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  /** Yalnız görünümü varsayılana döndürür (favoriler, sekme sırası vb. kalır). */
  resetAppearance: () => void;
  isDefault: boolean;
}

/** Görünüm okuma/yazma — sağlayıcı yoksa (izole test) varsayılanı okur, yazım sessizce düşer. */
export function useAppearance(): AppearanceApi {
  const ctx = useOptionalPreferences();
  const setPreference = ctx?.setPreference;
  const appearance = resolveAppearance(ctx?.prefs);
  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => setPreference?.((cur) => appearancePatch(cur, patch)),
    [setPreference],
  );
  const resetAppearance = useCallback(
    () => setPreference?.({ appearance: { ...DEFAULT_APPEARANCE }, accent: null }),
    [setPreference],
  );
  const isDefault = (Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]).every(
    (k) => appearance[k] === DEFAULT_APPEARANCE[k],
  );
  return { appearance, setAppearance, resetAppearance, isDefault };
}
