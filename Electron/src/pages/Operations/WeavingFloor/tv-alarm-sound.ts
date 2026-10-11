// =============================================================================
// SALON TV — opsiyonel alarm sesi (salon andonu). Varsayılan KAPALI; TV'nin kendi düğmesi.
// =============================================================================
// Kaynak salon verisinin kendisi (duruşun canlı alarmı + `ESCALATED` kademe) — TV hesabı alarm
// listesini görme izni taşımak zorunda değil. Anahtar `<alarm>:k<kademe>`: yeni alarm ya da
// kademe atlaması bir kez çalar. Tercih bu bilgisayarın (TV ekranı) yerel ayarıdır.
// =============================================================================
import { useEffect, useMemo } from "react";
import { sessionKeySet } from "@/pages/Operations/LoomAlarms/alarm-seen";
import { playAlarmTone } from "@/pages/Operations/LoomAlarms/alarm-sound";
import type { LiveLoom } from "./types";

const SOUND_KEY = "tezgahTv.ses";

export function readTvSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTvSound(on: boolean): void {
  try {
    if (on) localStorage.setItem(SOUND_KEY, "1");
    else localStorage.removeItem(SOUND_KEY);
  } catch {
    // Depolama kapalı: tercih yalnız bu açılışta geçerli.
  }
}

/** Salon verisindeki canlı alarm sinyalleri (anahtar + kademe). */
export function tvAlarmSignalsOf(looms: readonly LiveLoom[]): { key: string; tier: 1 | 2 }[] {
  const out: { key: string; tier: 1 | 2 }[] = [];
  for (const l of looms) {
    const id = l.openStop?.alarmId;
    if (!id) continue;
    const tier: 1 | 2 = l.openStop?.escalatedAt != null ? 2 : 1;
    out.push({ key: `${id}:k${tier}`, tier });
  }
  return out;
}

const defaultPlay = (tier: 1 | 2): void => void playAlarmTone(tier);

export function useTvAlarmSound(looms: readonly LiveLoom[] | undefined, on: boolean, play: (tier: 1 | 2) => void = defaultPlay): void {
  const seen = useMemo(() => sessionKeySet("tezgahTv.rung"), []);
  useEffect(() => {
    if (!looms) return;
    const fresh = tvAlarmSignalsOf(looms).filter((s) => !seen.has(s.key));
    if (fresh.length === 0) return;
    // Kapalıyken de işaretlenir: ses açıldığı an eski alarmlar toptan çalmasın.
    seen.addAll(fresh.map((s) => s.key));
    if (on) play(fresh.some((s) => s.tier === 2) ? 2 : 1);
  }, [looms, on, seen, play]);
}
