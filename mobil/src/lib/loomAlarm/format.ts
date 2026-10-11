// =============================================================================
// TEZGAH ALARMI — saf biçim yardımcıları (Uyarılar listesi · alarm sayfası · şerit · bildirim aynı cümleyi kurar)
// =============================================================================
// Panel `pages/Operations/LoomAlarms/alarm-format.ts` aynası (istemciler kod paylaşmaz). Saat basımı yalnız
// `lib/factory-time`tan (fabrika dilimi, cihaz dilimi değil).
// =============================================================================
import type { LoomAlarmEventKind, LoomAlarmItem, LoomAlarmState } from '../../types/loomAlarm';

const MINUTE = 60_000;

export const ALARM_STATE_LABEL: Record<LoomAlarmState, string> = {
  OPEN: 'Açık',
  ACKED: 'Üstlenildi',
  RESOLVED: 'Çözüldü',
  CANCELLED: 'İptal edildi',
};

export const isLiveAlarm = (state: string): boolean => state === 'OPEN' || state === 'ACKED';

/** Kademe rozeti: 1 = görevli grubu, 2 = üst kademeye (patron) iletildi. */
export function tierLabel(tier: number): string {
  return tier >= 2 ? 'Patrona iletildi' : 'Görevliye bildirildi';
}

export const tierShort = (tier: number): string => (tier >= 2 ? 'Kademe 2' : 'Kademe 1');

export const reasonText = (a: Pick<LoomAlarmItem, 'stop'>): string =>
  a.stop.reasonLabel ?? a.stop.reasonCode ?? 'Sebep bekleniyor';

/** Duruşun süresi (ms): kapalıysa bitişe kadar, canlıysa şu ana kadar. */
export function alarmElapsedMs(a: Pick<LoomAlarmItem, 'stop' | 'closedAt'>, now: number): number {
  const end = a.stop.endedAt ?? a.closedAt;
  const endMs = end ? Date.parse(end) : now;
  return Math.max(0, endMs - Date.parse(a.stop.startedAt));
}

/** '23 dk / hedef 10' — hedefsiz duruşta yalnız süre. */
export function durationVsTarget(a: Pick<LoomAlarmItem, 'stop' | 'closedAt' | 'targetMinutes'>, now: number): string {
  const min = Math.floor(alarmElapsedMs(a, now) / MINUTE);
  const elapsed = formatMinutes(min);
  return a.targetMinutes === null ? elapsed : `${elapsed} / hedef ${a.targetMinutes} dk`;
}

/** Dakikayı okunur süreye: '7 dk', '1 sa 05 dk'. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} dk`;
  return `${Math.floor(min / 60)} sa ${String(min % 60).padStart(2, '0')} dk`;
}

/** Saniyeyi okunur süreye; null → '—'. */
export function formatSeconds(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec} sn`;
  return formatMinutes(Math.round(sec / 60));
}

/** Canlı sayaç: '23:41' / '1:02:05'. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Hedef aşıldı mı (canlı alarmın sayaç rengi). */
export function isPastTarget(a: Pick<LoomAlarmItem, 'stop' | 'closedAt' | 'targetMinutes'>, now: number): boolean {
  return a.targetMinutes !== null && alarmElapsedMs(a, now) >= a.targetMinutes * MINUTE;
}

/** Susturma sürüyor mu (yalnız tekrar-çalmayı keser; üst kademeyi durdurmaz). */
export function isSnoozed(a: Pick<LoomAlarmItem, 'snoozedUntil'>, now: number): boolean {
  return a.snoozedUntil !== null && Date.parse(a.snoozedUntil) > now;
}

const EVENT_LABEL: Record<LoomAlarmEventKind, string> = {
  RAISED: 'Alarm çaldı',
  TIER_SKIPPED: 'Kademe atlandı',
  ACK: 'Üstlenildi',
  ACK_RELEASE: 'Üstlenme bırakıldı',
  SNOOZE: 'Susturuldu',
  UNSNOOZE: 'Susturma kaldırıldı',
  NOTE: 'Not',
  NOTE_RETRACT: 'Not geri çekildi',
  RESOLVED: 'Duruş kapandı — alarm çözüldü',
  CANCELLED: 'Alarm iptal edildi',
};

/** Tanınmayan olay türü (yeni sunucu) jenerik basılır — uydurulmaz. */
export function eventLabel(kind: string, tier: number | null): string {
  const base = (EVENT_LABEL as Record<string, string>)[kind] ?? 'Olay';
  if (kind === 'RAISED' && tier !== null) return tier >= 2 ? 'Patrona iletildi (2. kademe)' : 'Görevliye bildirildi (1. kademe)';
  return base;
}

const SOURCE_LABEL: Record<string, string> = {
  MACHINE: 'Ölçülen',
  INFERRED: 'Çıkarım',
  OPERATOR: 'Elle kayıt',
  SUPERVISOR: 'Elle kayıt (amir)',
  SIMULATED: 'Simülasyon',
};

/** Duruş kaydının kaynağı; tanınmayan değer olduğu gibi basılır. */
export const sourceLabel = (source: string): string => SOURCE_LABEL[source] ?? source;
