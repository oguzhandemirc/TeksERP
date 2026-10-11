// =============================================================================
// TEZGAH ALARMI — ses + işletim sistemi bildirimi (kabukta, zil yoklamasının verisiyle)
// =============================================================================
// Her yoklama/tik'te `freshSignals`: henüz çalınmamış anahtar varsa EN ÖNCELİKLİSİ için tek
// ses (kişisel tercih açıksa) + tek bildirim (pencere arkadaysa; ana süreç karar verir).
// Anahtarlar sessionStorage'da tutulur — aynı alarm/kademe ikinci kez çalmaz.
// =============================================================================
import { useEffect, useMemo } from "react";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { LoomAlarmNotifyRequest } from "@shared/loom-alarm-notify";
import type { LoomAlarmApi } from "@shared/ipc-contract";
import { freshSignals, notificationTextOf, type AlarmSignal } from "./alarm-signal";
import { sessionKeySet, type KeySet } from "./alarm-seen";
import { playAlarmTone } from "./alarm-sound";
import type { LoomAlarmItem } from "./types";

export const DEFAULT_RENOTIFY_MINUTES = 10;

export interface SignalOutputs {
  playTone: (tier: 1 | 2) => void;
  notify: (req: LoomAlarmNotifyRequest) => void;
}

/** Electron köprüsü (web panelinde/testte null → OS bildirimi yok, şerit + ses sürer). */
export function loomAlarmBridge(): LoomAlarmApi | null {
  return typeof window !== "undefined" ? (window.api?.loomAlarm ?? null) : null;
}

const defaultOutputs: SignalOutputs = {
  playTone: (tier) => void playAlarmTone(tier),
  notify: (req) => void loomAlarmBridge()?.notify(req).catch(() => undefined),
};

/** Saf çekirdek: çalınmamış sinyalleri işaretler, tek ses + tek bildirim üretir; çalınanları döner. */
export function dispatchAlarmSignals(
  items: readonly LoomAlarmItem[],
  seen: KeySet,
  now: number,
  opts: { renotifyMinutes: number; soundOn: boolean; out: SignalOutputs },
): AlarmSignal[] {
  const { out } = opts;
  const fresh = freshSignals(items, seen, now, opts.renotifyMinutes);
  const top = fresh[0];
  if (!top) return [];
  seen.addAll(fresh.map((s) => s.key));
  if (opts.soundOn) out.playTone(top.tier);
  out.notify({ alarmId: top.alarm.id, ...notificationTextOf(top, now, fresh.length - 1) });
  return fresh;
}

export function useAlarmRenotifyMinutes(): number {
  const q = useFeatureFlags();
  const v = q.data?.data?.tezgahAlarmRenotifyMinutes;
  return typeof v === "number" && v >= 1 ? v : DEFAULT_RENOTIFY_MINUTES;
}

export function useLoomAlarmSignals(args: {
  items: readonly LoomAlarmItem[] | undefined;
  userId: string | null;
  now: number;
  soundOn: boolean;
  outputs?: SignalOutputs;
}): void {
  const { items, userId, now, soundOn } = args;
  const outputs = args.outputs ?? defaultOutputs;
  const renotifyMinutes = useAlarmRenotifyMinutes();
  const seen = useMemo(() => (userId ? sessionKeySet(`loomAlarm.rung.${userId}`) : null), [userId]);
  useEffect(() => {
    if (!items || !seen) return;
    dispatchAlarmSignals(items, seen, now, { renotifyMinutes, soundOn, out: outputs });
  }, [items, seen, now, renotifyMinutes, soundOn, outputs]);
}

/** Bildirime tıklanınca (ana süreç pencereyi öne getirdi) alarm sayfasını aç. */
export function useLoomAlarmOpenRequests(onOpen: (alarmId: string) => void): void {
  useEffect(() => {
    const bridge = loomAlarmBridge();
    if (!bridge) return;
    return bridge.onOpen(onOpen);
  }, [onOpen]);
}
