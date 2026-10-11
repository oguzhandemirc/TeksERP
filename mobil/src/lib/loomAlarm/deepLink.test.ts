// Bildirime dokunma → uygulama içi hedef. Tanınmayan veri yok sayılır; yol uydurulmaz.
import { alarmNotificationData, alarmTargetOf } from './deepLink';
import { rootNavigateToAlarm, rootNavigationRef } from '../../navigation/navigationRef';

const ID = '11111111-1111-4111-8111-111111111111';

describe('alarmTargetOf', () => {
  it('alarm kimliği → alarm sayfası', () => {
    expect(alarmTargetOf(alarmNotificationData(ID))).toEqual({ screen: 'UyariDetay', alarmId: ID });
  });
  it('kimliksiz (çok alarm) → Uyarılar listesi', () => {
    expect(alarmTargetOf(alarmNotificationData(null))).toEqual({ screen: 'Uyarilar' });
  });
  it('UUID olmayan kimlik → liste (uydurulmaz)', () => {
    expect(alarmTargetOf({ kind: 'loom-alarm', alarmId: '../../x' })).toEqual({ screen: 'Uyarilar' });
  });
  it('bizim olmayan bildirim / bozuk veri → null', () => {
    expect(alarmTargetOf({ kind: 'update' })).toBeNull();
    expect(alarmTargetOf(null)).toBeNull();
    expect(alarmTargetOf('loom-alarm')).toBeNull();
  });
});

describe('rootNavigateToAlarm', () => {
  afterEach(() => jest.restoreAllMocks());

  it('dokunma → Main içinde UyariDetay {alarmId}', () => {
    jest.spyOn(rootNavigationRef, 'isReady').mockReturnValue(true);
    const nav = jest.spyOn(rootNavigationRef, 'navigate').mockImplementation(() => {});
    rootNavigateToAlarm({ screen: 'UyariDetay', alarmId: ID });
    expect(nav).toHaveBeenCalledWith('Main', { screen: 'UyariDetay', params: { alarmId: ID } });
  });

  it('kapsayıcı hazır değilse (soğuk açılış) hazır olunca gider', () => {
    jest.useFakeTimers();
    const ready = jest.spyOn(rootNavigationRef, 'isReady').mockReturnValue(false);
    const nav = jest.spyOn(rootNavigationRef, 'navigate').mockImplementation(() => {});
    rootNavigateToAlarm({ screen: 'Uyarilar' });
    expect(nav).not.toHaveBeenCalled();
    ready.mockReturnValue(true);
    jest.advanceTimersByTime(300);
    expect(nav).toHaveBeenCalledWith('Main', { screen: 'Uyarilar' });
    jest.useRealTimers();
  });
});
