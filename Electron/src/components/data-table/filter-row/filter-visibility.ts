// =============================================================================
// FİLTRE SATIRI GÖRÜNÜRLÜĞÜ — kullanıcının seçtiği kutular (2026-11-10)
// =============================================================================
// Çakılı kutu yok: sayfanın `primary` kümesi yalnız İLK AÇILIŞ varsayılanıdır; kullanıcı
// "+ Filtre" menüsünde tik ile ekler/kaldırır. Kayıt varsayılandan SAPMALARDIR
// (`prefs.filterRowVisibility[sayfa][filtreId] = true|false`) — sekmeli sayfada başka
// sekmenin kutuları kendi varsayılanında kalır. Etkin (değeri dolu) kutu HEP görünür:
// gizli filtre listeyi sessizce süzmez; gizlerken değeri temizlenir.
// =============================================================================
import { useCallback, useState } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { RowFilter } from "./row-filter";

export type VisibilityOverrides = Readonly<Record<string, boolean>>;

/** Anahtarı olmayan doğrudan anahtarlar ("İptaller dahil") görünürlük kaydına girmez: görünür ⇔ etkin. */
export function isToggleFilter(f: RowFilter): boolean {
  return Boolean(f.onAdd);
}

export function isShown(f: RowFilter, defaultShown: boolean, ov: VisibilityOverrides, active: boolean): boolean {
  if (active) return true;
  if (isToggleFilter(f)) return false;
  return ov[f.id] ?? defaultShown;
}

/** Varsayılana eşit seçim kayıttan düşer (kayıt yalnız sapmayı taşır). */
export function withOverride(ov: VisibilityOverrides, id: string, shown: boolean, defaultShown: boolean): Record<string, boolean> {
  const next = { ...ov };
  if (shown === defaultShown) delete next[id];
  else next[id] = shown;
  return next;
}

/** Bozuk/eski kayıt sayfayı kilitlemez: yalnız boolean değerler geçer. */
export function readOverrides(raw: unknown): VisibilityOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "boolean")) as VisibilityOverrides;
}

/** Kullanıcı tercihlerinde (sunucu blob'u, liste filtre kaydı ve sütun görünürlüğüyle aynı yer) sayfa başına. */
export function useFilterRowVisibility(pageKey: string) {
  const ctx = usePreferencesOrNull();
  const [local, setLocal] = useState<VisibilityOverrides>({});
  const ov = ctx ? readOverrides(ctx.prefs.filterRowVisibility?.[pageKey]) : local;
  const setPreference = ctx?.setPreference;

  const write = useCallback(
    (update: (cur: VisibilityOverrides) => VisibilityOverrides) => {
      if (!setPreference) return setLocal(update);
      setPreference((cur) => {
        const all = { ...(cur.filterRowVisibility ?? {}) };
        const next = update(readOverrides(all[pageKey]));
        if (Object.keys(next).length === 0) delete all[pageKey];
        else all[pageKey] = { ...next };
        return { filterRowVisibility: all };
      });
    },
    [setPreference, pageKey],
  );

  return { overrides: ov, write };
}

/** Sağlayıcısız izole çizimde (bileşen testleri) bellek içine düşer; `usePreferences` önce `useContext`i
 *  çağırıp sonra fırlattığından kanca sırası her çizimde aynıdır. */
function usePreferencesOrNull(): ReturnType<typeof usePreferences> | null {
  try {
    return usePreferences();
  } catch {
    return null;
  }
}
