import { useMemo } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

/**
 * Bir hub kart grid'inin (örn Operasyon) sırasını kullanıcı tercihinde (backend)
 * tutar — sekmelerdeki [[useTabOrder]] ile aynı desen.
 * - `key`: hub kimliği (örn "operations").
 * - `allKeys`: o an görünür kart key'leri (izin süzgecinden geçmiş) = varsayılan sıra.
 * Kayıtlı sıra geçerli key'lere göre süzülür; sonradan eklenen / izin kazanılan
 * kartlar sona eklenir (kaybolmaz). `reorder` ile yeni sıra debounce'lu kaydedilir.
 */
export function useHubOrder(key: string, allKeys: string[]) {
  const { prefs, setPreference } = usePreferences();
  const saved = prefs.hubOrder?.[key];

  const ordered = useMemo(() => {
    const valid = (saved ?? []).filter((k) => allKeys.includes(k));
    const missing = allKeys.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }, [saved, allKeys]);

  const reorder = (next: string[]) => {
    setPreference({ hubOrder: { ...(prefs.hubOrder ?? {}), [key]: next } });
  };

  return { ordered, reorder };
}
