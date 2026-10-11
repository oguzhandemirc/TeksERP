// Alarm sesi — KİŞİSEL tercih (`UserPreference.loomAlarm.sound`, varsayılan açık). Kullanıcıyı
// takip eder: aynı kişi başka bilgisayara girince kendi ayarını bulur.
import { useCallback } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";

export function useLoomAlarmSoundPref(): { on: boolean; toggle: () => void } {
  const ctx = useOptionalPreferences();
  const on = ctx?.prefs.loomAlarm?.sound !== false;
  const setPreference = ctx?.setPreference;
  const loomAlarm = ctx?.prefs.loomAlarm;
  const toggle = useCallback(() => {
    setPreference?.({ loomAlarm: { ...loomAlarm, sound: !on } });
  }, [setPreference, loomAlarm, on]);
  return { on, toggle };
}
