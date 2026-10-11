// =============================================================================
// TEZGAH ALARMI — sinyal politikası (ses · titreşim · bildirim ne zaman, kaç kez)
// =============================================================================
// Panel `alarm-signal.ts` aynası. Anahtar `<id>:k<kademe>` (yeni alarm/kademe) ve tekrar çalmada
// `<id>:k<kademe>:r<n>` (üstlenilmemiş + susturulmamış, `renotifyMinutes` aralığıyla); aynı anahtar bir
// kez çalar. Tekrar çalma GÖRÜNTÜ kararıdır (sunucuya satır yazmaz).
// =============================================================================
import { formatMinutes, isSnoozed, reasonText, alarmElapsedMs } from './format';
import type { LoomAlarmItem } from '../../types/loomAlarm';

const MINUTE = 60_000;

export interface AlarmSignal {
  key: string;
  alarm: LoomAlarmItem;
  tier: 1 | 2;
  /** 0 = ilk çalma (yeni alarm/kademe); n ≥ 1 = n. tekrar. */
  repeat: number;
}

const tierOf = (a: Pick<LoomAlarmItem, 'tier'>): 1 | 2 => (a.tier >= 2 ? 2 : 1);

/** Kademe başlangıcı anahtarı — şerit kapatma bu anahtarla hatırlanır. */
export const alarmTierKey = (a: Pick<LoomAlarmItem, 'id' | 'tier'>): string => `${a.id}:k${tierOf(a)}`;

/** Bu alarmın ŞU ANKİ sinyali; çalmaması gerekiyorsa null. */
export function alarmSignalOf(a: LoomAlarmItem, now: number, renotifyMinutes: number): AlarmSignal | null {
  const tier = tierOf(a);
  const base = alarmTierKey(a);
  if (a.state === 'ACKED') return tier === 2 ? { key: base, alarm: a, tier, repeat: 0 } : null;
  if (a.state !== 'OPEN') return null;
  if (isSnoozed(a, now) || !(renotifyMinutes >= 1)) return { key: base, alarm: a, tier, repeat: 0 };
  const due = Date.parse(tier === 2 ? (a.k2DueAt ?? a.k1DueAt) : a.k1DueAt);
  const repeat = Number.isFinite(due) ? Math.max(0, Math.floor((now - due) / (renotifyMinutes * MINUTE))) : 0;
  return { key: repeat > 0 ? `${base}:r${repeat}` : base, alarm: a, tier, repeat };
}

/** Öncelik: üst kademe önce, sonra en eski duruş. */
export function bySeverity(x: Pick<LoomAlarmItem, 'tier' | 'stop'>, y: Pick<LoomAlarmItem, 'tier' | 'stop'>): number {
  return tierOf(y) - tierOf(x) || Date.parse(x.stop.startedAt) - Date.parse(y.stop.startedAt);
}

/** Henüz çalınmamış sinyaller, öncelik sırasıyla. */
export function freshSignals(
  items: readonly LoomAlarmItem[],
  seen: { has: (key: string) => boolean },
  now: number,
  renotifyMinutes: number,
): AlarmSignal[] {
  const out: AlarmSignal[] = [];
  for (const a of items) {
    const s = alarmSignalOf(a, now, renotifyMinutes);
    if (s && !seen.has(s.key)) out.push(s);
  }
  return out.sort((x, y) => bySeverity(x.alarm, y.alarm));
}

/** Şeridin öne çıkardığı alarm: kapatılmamış açık (üstlenilmemiş) alarmların en önceliklisi. */
export function stripLeadOf(items: readonly LoomAlarmItem[], dismissed: { has: (key: string) => boolean }): LoomAlarmItem | null {
  const open = items.filter((a) => a.state === 'OPEN' && !dismissed.has(alarmTierKey(a)));
  return open.sort(bySeverity)[0] ?? null;
}

/** Bildirim metni: 'TZ-12 · İp atlama' / '23 dk (hedef 10 dk) · Kademe 2 · +2 alarm daha'. */
export function notificationTextOf(s: AlarmSignal, now: number, others: number): { title: string; body: string } {
  const a = s.alarm;
  const min = formatMinutes(Math.floor(alarmElapsedMs(a, now) / MINUTE));
  const target = a.targetMinutes === null ? '' : ` (hedef ${a.targetMinutes} dk)`;
  const head = s.tier === 2 ? 'Patrona iletildi' : s.repeat > 0 ? 'Hâlâ üstlenilmedi' : 'Yeni tezgah alarmı';
  const more = others > 0 ? ` · +${others} alarm daha` : '';
  return {
    title: `${head}: ${a.machine.code} · ${reasonText(a)}`.slice(0, 120),
    body: `${a.machine.hallName} · ${min} duruyor${target}${more}`.slice(0, 300),
  };
}
