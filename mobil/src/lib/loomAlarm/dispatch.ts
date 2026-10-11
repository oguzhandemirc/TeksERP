// TEZGAH ALARMI — çalınmamış sinyalleri AL ve çalındı işaretle (bildirici + Tezgah şeridi ortak; saf).
import { freshSignals, type AlarmSignal } from './signal';
import { alarmSeen } from './seen';
import type { LoomAlarmItem } from '../../types/loomAlarm';

export function consumeFreshSignals(
  items: readonly LoomAlarmItem[],
  now: number,
  renotifyMinutes: number,
  seen: { has: (k: string) => boolean; add: (k: string) => void } = alarmSeen,
): AlarmSignal[] {
  const fresh = freshSignals(items, seen, now, renotifyMinutes);
  for (const s of fresh) seen.add(s.key);
  return fresh;
}
