import { useMemo } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

/**
 * Bir sekme setinin sırasını kullanıcı tercihinde (backend) tutar.
 * - `key`: sekme seti kimliği (örn "subcontractors").
 * - `allKeys`: geçerli sekme key'leri (kaynak sıra = varsayılan).
 * Kayıtlı sıra geçerli key'lere göre süzülür; sonradan eklenen yeni sekmeler
 * sona eklenir (kaybolmaz). `reorder` ile yeni sıra debounce'lu backend'e yazılır.
 */
export function useTabOrder(key: string, allKeys: string[]) {
  const { prefs, setPreference } = usePreferences();
  const saved = prefs.tabOrder?.[key];

  const ordered = useMemo(() => {
    const valid = (saved ?? []).filter((k) => allKeys.includes(k));
    const missing = allKeys.filter((k) => !valid.includes(k));
    return [...valid, ...missing];
  }, [saved, allKeys]);

  const reorder = (next: string[]) => {
    setPreference({ tabOrder: { ...(prefs.tabOrder ?? {}), [key]: next } });
  };

  return { ordered, reorder };
}
