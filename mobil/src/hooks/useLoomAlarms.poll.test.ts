// Bekçi: alarm yoklaması zil sağlıklıyken 60 sn, değilken (bayrak kapalı dahil) 15 sn — bugünkü davranış.
import { ALARM_POLL_MS, ALARM_POLL_HEALTHY_MS, alarmPollMs } from './useLoomAlarms';

jest.mock('./useNotificationBell', () => ({ useBellHealthy: () => false }));

it('15 ↔ 60', () => {
  expect(ALARM_POLL_MS).toBe(15_000);
  expect(alarmPollMs(false)).toBe(15_000);
  expect(alarmPollMs(true)).toBe(ALARM_POLL_HEALTHY_MS);
  expect(ALARM_POLL_HEALTHY_MS).toBe(60_000);
});
