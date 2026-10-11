// =============================================================================
// TEZGAH ALARMI — hangi eylem düğmesi çizilir (saf; panel `alarm-policy.ts` aynası)
// =============================================================================
// Asıl kapı sunucudadır (izin + atomik claim); burada yalnız anlamsız düğme gizlenir.
// Kapalı alarmda (RESOLVED/CANCELLED) yalnız NOT kalır — sunucu kapanmış alarma da not kabul eder.
// =============================================================================
import { isLiveAlarm, isSnoozed } from './format';
import type { LoomAlarmItem, LoomAlarmTimelineEntry } from '../../types/loomAlarm';

/** Kullanıcının alarm yetkileri (izin + bayrak çözülmüş). */
export interface LoomAlarmAccess {
  /** Liste/alarm sayfası okunabilir. */
  canView: boolean;
  /** Üstlen · bırak (kendi) · sustur · not. */
  canAct: boolean;
  /** Başkasının üstlenmesini bırakma (`loom:alarm-escalation`). */
  canReleaseOthers: boolean;
}
export interface AlarmButtons {
  ack: boolean;
  /** Kendi üstlenmesini bırakma. */
  release: boolean;
  /** Başkasının üstlenmesini bırakma (`loom:alarm-escalation`). */
  releaseOther: boolean;
  snooze: boolean;
  unsnooze: boolean;
  note: boolean;
}

const NONE: AlarmButtons = { ack: false, release: false, releaseOther: false, snooze: false, unsnooze: false, note: false };

export function alarmButtons(
  a: Pick<LoomAlarmItem, 'state' | 'ackedBy' | 'snoozedUntil'>,
  access: Pick<LoomAlarmAccess, 'canAct' | 'canReleaseOthers'>,
  meId: string | null,
  now: number,
): AlarmButtons {
  if (!access.canAct) return NONE;
  if (!isLiveAlarm(a.state)) return { ...NONE, note: true };
  const mine = a.ackedBy !== null && a.ackedBy.id === meId;
  const snoozed = isSnoozed(a, now);
  return {
    ack: a.state === 'OPEN',
    release: a.state === 'ACKED' && mine,
    releaseOther: a.state === 'ACKED' && !mine && a.ackedBy !== null && access.canReleaseOthers,
    snooze: !snoozed,
    unsnooze: snoozed,
    note: true,
  };
}

/** Not geri çekilebilir mi: yalnız sahibi, bir kez, eylem izniyle (kapalı alarmda da — not defterdir). */
export function canRetractNote(e: Pick<LoomAlarmTimelineEntry, 'kind' | 'user' | 'retracted'>, canAct: boolean, meId: string | null): boolean {
  return canAct && e.kind === 'NOTE' && !e.retracted && e.user !== null && e.user.id === meId;
}
