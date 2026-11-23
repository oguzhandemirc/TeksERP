import { useCallback, useMemo } from "react";
import { useOptionalPreferences } from "@/providers/preferences-context";
import { readSavedExportChoice, type SavedExportChoice } from "@/lib/export-columns";

/**
 * Çıktı diyaloğunun hatırlanan seçimi — KULLANICI tercihinde (`prefs.exportDialog[anahtar]`, başka bilgisayarda da
 * aynı kişiye gelir). `save(null)` kaydı siler ("Seçimi hatırla" kapatıldı → bir dahaki açılış ekran sütunlarıyla).
 * ⚠️ `ready` gelmeden yazılmaz: önbellek boşken yazım kullanıcının diğer tercihlerini ezer. Sağlayıcı yoksa
 * (izole bileşen) hatırlama kapalıdır.
 */
export function useExportDialogPrefs(prefKey: string | undefined) {
  const ctx = useOptionalPreferences();
  const ready = Boolean(ctx?.ready);
  const setPreference = ctx?.setPreference;
  const raw = prefKey ? ctx?.prefs.exportDialog?.[prefKey] : undefined;
  const saved = useMemo(() => readSavedExportChoice(raw), [raw]);
  const save = useCallback(
    (next: SavedExportChoice | null) => {
      if (!ready || !prefKey || !setPreference) return;
      setPreference((cur) => {
        const map = { ...(cur.exportDialog ?? {}) };
        if (next) map[prefKey] = next;
        else delete map[prefKey];
        return { exportDialog: map };
      });
    },
    [ready, prefKey, setPreference],
  );
  return { saved, save, ready };
}
