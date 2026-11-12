import { useCallback } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { PANO_DONEMLERI, type PanoDonem } from "./types";

/** Tercih yok / tanınmayan kayıt → "hafta": "bugün" vardiya başında boş panoyla açılıyordu. */
export function validPeriod(v: unknown): PanoDonem {
  return (PANO_DONEMLERI as readonly unknown[]).includes(v) ? (v as PanoDonem) : "hafta";
}

/** Pano dönemi — kullanıcı tercihinde (`prefs.dashboard.donem`) hatırlanır, cihazdan bağımsız. */
export function usePanoDonem(): [PanoDonem, (d: PanoDonem) => void] {
  const ctx = useOptionalPreferences();
  const donem = validPeriod(ctx?.prefs.dashboard?.donem);
  const setPreference = ctx?.setPreference;
  const setDonem = useCallback(
    (d: PanoDonem) => setPreference?.((cur) => ({ dashboard: { ...(cur.dashboard ?? {}), donem: d } })),
    [setPreference],
  );
  return [donem, setDonem];
}
