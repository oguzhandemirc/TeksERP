// Test fikstürü — tezgah alarmı tel nesnesi (yalnız testler içe aktarır).
import type { LoomAlarmItem } from '../types/loomAlarm';

export const T0 = Date.parse('2026-10-11T08:00:00.000Z');
export const MIN = 60_000;

export function alarmItem(over: Partial<LoomAlarmItem> = {}): LoomAlarmItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'STOP_OVER_TARGET',
    state: 'OPEN',
    tier: 1,
    machine: { id: 'm-1', code: 'TZ-12', name: 'Tezgah 12', hallId: 'h-1', hallName: 'Hol A' },
    stop: {
      id: 's-1',
      startedAt: new Date(T0 - 20 * MIN).toISOString(),
      endedAt: null,
      reasonCode: 'IP',
      reasonLabel: 'İp atlama',
      lossClass: null,
      source: 'MACHINE',
    },
    targetMinutes: 10,
    graceMinutes: 0,
    k1DueAt: new Date(T0 - 10 * MIN).toISOString(),
    k2DueAt: new Date(T0 + 10 * MIN).toISOString(),
    ackedBy: null,
    ackedAt: null,
    snoozedBy: null,
    snoozedUntil: null,
    closedAt: null,
    totalSec: null,
    overdueSec: null,
    cancelReason: null,
    createdAt: new Date(T0 - 10 * MIN).toISOString(),
    ...over,
  };
}
