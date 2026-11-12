import { useCallback, useMemo } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { cleanBoxOptions, nextBoxOptions, type BoxOptionKey, type BoxOptions } from "./box-options";

export type SetBoxOption = <K extends BoxOptionKey>(key: K, value: BoxOptions[K]) => void;

/** Kutu ayarları — kullanıcı tercihinde (`prefs.dashboard.boxOptions`); yalnız gösterimi süzer, istek atmaz. */
export function usePanoBoxOptions(): { options: BoxOptions; setOption: SetBoxOption } {
  const ctx = useOptionalPreferences();
  const raw = ctx?.prefs.dashboard?.boxOptions;
  const setPreference = ctx?.setPreference;
  const options = useMemo(() => cleanBoxOptions(raw), [raw]);
  const setOption = useCallback<SetBoxOption>(
    (key, value) => setPreference?.((cur) => ({
      dashboard: { ...(cur.dashboard ?? {}), boxOptions: nextBoxOptions(cur.dashboard?.boxOptions, key, value) },
    })),
    [setPreference],
  );
  return { options, setOption };
}
