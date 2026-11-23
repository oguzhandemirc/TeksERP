import { createContext, useContext } from "react";
import type { AppPreferences } from "@/types/preferences";

// Bağlam sağlayıcıdan AYRI modülde: testler `@/providers/PreferencesProvider`ı kısmi mock'lar; isteğe bağlı
// okuyucu (ör. çıktı diyaloğu) o mock'a yakalanmasın, sağlayıcı yoksa null alsın.

export type PreferencePatch = Partial<AppPreferences> | ((current: AppPreferences) => Partial<AppPreferences>);

export interface PreferencesContextValue {
  prefs: AppPreferences;
  /** Fonksiyon biçimi önbellekteki EN SON kopyayı alır — aynı tıkta iki yazar birbirini ezmesin. */
  setPreference: (patch: PreferencePatch) => void;
  resetPreferences: () => void;
  ready: boolean;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Sağlayıcı yoksa null (kabuk dışı/izole bileşen testleri) — çağıran varsayılana düşer. */
export function useOptionalPreferences(): PreferencesContextValue | null {
  return useContext(PreferencesContext);
}
