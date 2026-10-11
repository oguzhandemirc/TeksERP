// Yerel bildirim köprüsü: tek kimlikli hatırlatma (öncekini ezer), DATE tetiği + alarm kanalı,
// dokunma sıcak/soğuk açılışta aynı geri çağrıya; native modül yoksa (eski APK) çökmez.

import {
  ALARM_CHANNEL_ID,
  ALARM_REMINDER_ID,
  cancelAlarmReminder,
  ensureNotifyPermission,
  scheduleAlarmReminder,
  subscribeAlarmTaps,
} from './alarmNotify';

// Fabrika tembel çağrılır (köprü paketi ilk kullanımda `require` eder) — `mockN` o ana dek tanımlıdır.
const mockN = {
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
};
jest.mock('expo-notifications', () => mockN);

const response = (data: object) => ({ notification: { request: { content: { data } } } });
const flush = () => new Promise((r) => setImmediate(r));

describe('alarmNotify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hatırlatma: önce aynı kimliği iptal, sonra DATE tetiğiyle alarm kanalına', async () => {
    await scheduleAlarmReminder({ fireAt: 1_000, title: 't', body: 'b', data: { kind: 'loom-alarm' } });
    expect(mockN.cancelScheduledNotificationAsync).toHaveBeenCalledWith(ALARM_REMINDER_ID);
    expect(mockN.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: ALARM_REMINDER_ID,
      content: { title: 't', body: 'b', data: { kind: 'loom-alarm' }, sound: true },
      trigger: { type: 'date', date: new Date(1_000), channelId: ALARM_CHANNEL_ID },
    });
    await cancelAlarmReminder();
    expect(mockN.cancelScheduledNotificationAsync).toHaveBeenLastCalledWith(ALARM_REMINDER_ID);
  });

  it('zamanlama hatası yutulur (izin yok)', async () => {
    mockN.scheduleNotificationAsync.mockImplementationOnce(() => Promise.reject(new Error('no')));
    await expect(scheduleAlarmReminder({ fireAt: 1, title: 't', body: 'b', data: { kind: 'loom-alarm' } })).resolves.toBeUndefined();
  });

  it('izin: sorulabiliyorsa sorar; kalıcı red sorulmaz', async () => {
    await expect(ensureNotifyPermission()).resolves.toBe('granted');
    mockN.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
    await expect(ensureNotifyPermission()).resolves.toBe('denied');
    expect(mockN.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('dokunma: soğuk açılış (son yanıt) ve sıcak dinleyici aynı geri çağrıya', async () => {
    let listener: ((r: unknown) => void) | null = null;
    mockN.addNotificationResponseReceivedListener.mockImplementation((fn: (r: unknown) => void) => {
      listener = fn;
      return { remove: jest.fn() };
    });
    mockN.getLastNotificationResponseAsync.mockResolvedValueOnce(response({ kind: 'loom-alarm', alarmId: 'x' }));
    const onTap = jest.fn();
    const off = subscribeAlarmTaps(onTap);
    await flush();
    expect(onTap).toHaveBeenCalledWith({ kind: 'loom-alarm', alarmId: 'x' });
    expect(mockN.clearLastNotificationResponseAsync).toHaveBeenCalled();
    listener!(response({ kind: 'loom-alarm' }));
    expect(onTap).toHaveBeenLastCalledWith({ kind: 'loom-alarm' });
    off();
  });
});

describe('alarmNotify — native modül yok (eski APK)', () => {
  it('yükleme fırlatırsa bildirim yolu kapanır, çağrılar sessiz', async () => {
    jest.resetModules();
    jest.doMock('expo-notifications', () => {
      throw new Error('Cannot find native module ExpoNotifications');
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- resetModules sonrası taze modül (doMock'lu paket)
    const m = require('./alarmNotify') as typeof import('./alarmNotify');
    expect(m.notificationsAvailable()).toBe(false);
    await expect(m.ensureNotifyPermission()).resolves.toBe('denied');
    await expect(m.scheduleAlarmReminder({ fireAt: 1, title: 't', body: 'b', data: { kind: 'loom-alarm' } })).resolves.toBeUndefined();
    expect(typeof m.subscribeAlarmTaps(() => {})).toBe('function');
  });
});
