// =============================================================================
// TEZGAH ALARMI — kişi eylemleri (üstlen · bırak · sustur · not · not geri çek)
// =============================================================================
// ONLINE-ONLY (kuyruk yok): alarm canlı bir durumdur, saatler sonra yeniden oynatılan "üstlendim" yanlıştır.
// Token: eylem başına bir `useAttemptToken` denemesi (panel ikizi), parametreli eylemde parametre başına `keyed`
// alt token; yalnız belirsiz hatada (ağ/5xx) yapışır. 409/403
// arıza değildir ("Ahmet Usta 14:32'de üstlendi") — sunucu cümlesi toast'la basılır, liste tazelenir.
// =============================================================================
import { useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQueryClient } from '@tanstack/react-query';
import { useAttemptToken, type AttemptToken } from '../offline/attemptToken';
import { loomAlarmKeys } from '../lib/loomAlarm/keys';
import { loomAlarmService } from '../services/loomAlarm.service';
import { showScreenError } from '../lib/screenToast';
import type { LoomAlarmActionResult, SnoozeMinutes } from '../types/loomAlarm';

const DONE: Record<AlarmActionKind, string> = {
  ack: 'Alarm üstlenildi',
  release: 'Üstlenme bırakıldı',
  snooze: 'Alarm susturuldu',
  unsnooze: 'Susturma kaldırıldı',
  note: 'Not eklendi',
  retract: 'Not geri çekildi',
};

export interface LoomAlarmActions {
  busy: AlarmActionKind | null;
  ack(): Promise<boolean>;
  release(): Promise<boolean>;
  snooze(minutes: SnoozeMinutes): Promise<boolean>;
  unsnooze(): Promise<boolean>;
  note(text: string): Promise<boolean>;
  retract(eventId: string): Promise<boolean>;
}

export type AlarmActionKind = 'ack' | 'release' | 'snooze' | 'unsnooze' | 'note' | 'retract';

/** Eylemi token kuralıyla koşturur (saf olmayan tek parça; test `useLoomAlarmActions.test`). */
export async function runAlarmAction(
  attempt: AttemptToken,
  sub: string | undefined,
  call: (token: string) => Promise<LoomAlarmActionResult>,
): Promise<LoomAlarmActionResult> {
  const token = sub === undefined ? attempt.token() : attempt.keyed(sub);
  try {
    const r = await call(token);
    attempt.onSuccess();
    return r;
  } catch (e) {
    attempt.onFailure(e);
    throw e;
  }
}

export function useLoomAlarmActions(alarmId: string): LoomAlarmActions {
  const qc = useQueryClient();
  const attempts: Record<AlarmActionKind, AttemptToken> = {
    ack: useAttemptToken(),
    release: useAttemptToken(),
    snooze: useAttemptToken(),
    unsnooze: useAttemptToken(),
    note: useAttemptToken(),
    retract: useAttemptToken(),
  };
  const [busy, setBusy] = useState<AlarmActionKind | null>(null);

  const run = async (kind: AlarmActionKind, call: (token: string) => Promise<LoomAlarmActionResult>, sub?: string) => {
    if (busy) return false;
    setBusy(kind);
    try {
      await runAlarmAction(attempts[kind], sub, call);
      Toast.show({ type: 'success', text1: DONE[kind] });
      return true;
    } catch (e) {
      showScreenError(e, 'İşlem yapılamadı');
      return false;
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: loomAlarmKeys.all });
    }
  };

  return {
    busy,
    ack: () => run('ack', (t) => loomAlarmService.ack(alarmId, t)),
    release: () => run('release', (t) => loomAlarmService.release(alarmId, t)),
    snooze: (m) => run('snooze', (t) => loomAlarmService.snooze(alarmId, m, t), String(m)),
    unsnooze: () => run('unsnooze', (t) => loomAlarmService.unsnooze(alarmId, t)),
    note: (text) => run('note', (t) => loomAlarmService.note(alarmId, text, t), text),
    retract: (eventId) => run('retract', (t) => loomAlarmService.retractNote(alarmId, eventId, t), eventId),
  };
}
