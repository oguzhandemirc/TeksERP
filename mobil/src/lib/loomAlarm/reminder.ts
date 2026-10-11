// =============================================================================
// TEZGAH ALARMI — arka plan HATIRLATMASI planı (saf)
// =============================================================================
// Arka planda JS durur (Android `onHostPause`); arka plana geçerken bildiğimiz açık-üstlenilmemiş
// alarmlar için TEK yerel hatırlatma zamanlanır, ön plana dönüşte iptal edilir. Hatırlatma o anki
// bilgiyi söyler ("HH:mm itibarıyla") — alarm arada kapanmış olabilir, metin bunu saklamaz.
// Arka plandayken YENİ doğan alarm bu yolla bildirilemez (internet push dilimi, tasarım §A.12).
// =============================================================================
import { bySeverity } from './signal';
import { isSnoozed, reasonText } from './format';
import type { LoomAlarmItem } from '../../types/loomAlarm';

const MINUTE = 60_000;
const DEFAULT_RENOTIFY_MIN = 10;

export interface ReminderPlan {
  fireAt: number;
  title: string;
  body: string;
  /** Tek alarm → alarm sayfası; birden çok → Uyarılar listesi. */
  alarmId: string | null;
}

/** Bir alarmın hatırlatma anı: susturulduysa susturma bitimi, değilse tekrar çalma aralığı sonrası. */
export function reminderAtOf(a: LoomAlarmItem, now: number, renotifyMinutes: number): number {
  if (isSnoozed(a, now)) return Date.parse(a.snoozedUntil as string);
  const step = renotifyMinutes >= 1 ? renotifyMinutes : DEFAULT_RENOTIFY_MIN;
  return now + step * MINUTE;
}

export function reminderPlanOf(
  items: readonly LoomAlarmItem[],
  now: number,
  renotifyMinutes: number,
  fmtTime: (ms: number) => string,
): ReminderPlan | null {
  const open = items.filter((a) => a.state === 'OPEN').sort(bySeverity);
  if (open.length === 0) return null;
  const fireAt = Math.min(...open.map((a) => reminderAtOf(a, now, renotifyMinutes)));
  const lead = open[0];
  const more = open.length > 1 ? ` (+${open.length - 1} alarm daha)` : '';
  return {
    fireAt,
    title: `Tezgah alarmı üstlenilmemişti: ${lead.machine.code}${more}`.slice(0, 120),
    body: `${fmtTime(now)} itibarıyla ${open.length} açık alarm · ${lead.machine.code} · ${reasonText(lead)}. Güncel durum için dokunun.`.slice(0, 300),
    alarmId: open.length === 1 ? lead.id : null,
  };
}
