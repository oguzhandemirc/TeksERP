import { renderHook } from '@testing-library/react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useLandscapeLock } from './useLandscapeLock';
import { usePortraitLock } from './usePortraitLock';

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { LANDSCAPE: 'LANDSCAPE', PORTRAIT_UP: 'PORTRAIT_UP' },
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
}));
// Saha tableti: çıkışta yatayda hapsetme hatası yalnız tablette görülüyordu.
jest.mock('./useDeviceType', () => ({ useDeviceType: () => 'tablet' }));

const lockAsync = ScreenOrientation.lockAsync as jest.Mock;
const unlockAsync = ScreenOrientation.unlockAsync as jest.Mock;

/** Yönelim çağrılarını sırasıyla: 'lock:LANDSCAPE' | 'unlock'. */
const calls: string[] = [];
const last = () => calls[calls.length - 1];

beforeEach(() => {
  calls.length = 0;
  lockAsync.mockReset().mockImplementation((o: string) => {
    calls.push(`lock:${o}`);
    return Promise.resolve();
  });
  unlockAsync.mockReset().mockImplementation(() => {
    calls.push('unlock');
    return Promise.resolve();
  });
});

describe('useLandscapeLock — tablette çıkışta kilit bırakılır', () => {
  it('girişte yatay kilitler, çıkışta kilidi bırakır (yeniden yatay kilitlemez)', () => {
    const ekran = renderHook(() => useLandscapeLock());
    expect(calls).toEqual(['lock:LANDSCAPE']);
    ekran.unmount();
    expect(last()).toBe('unlock');
    expect(calls.filter((c) => c === 'lock:LANDSCAPE')).toHaveLength(1);
  });

  it('iç içe iki ekran: ilki çıkınca yatay kilit sürer, ikisi de çıkınca bırakılır', () => {
    const alt = renderHook(() => useLandscapeLock());
    const ust = renderHook(() => useLandscapeLock());
    alt.unmount();
    expect(calls).not.toContain('unlock');
    expect(last()).toBe('lock:LANDSCAPE');
    ust.unmount();
    expect(last()).toBe('unlock');
  });

  it('enabled=false kilide dokunmaz (altta yatay kilit varsa bozulmaz)', () => {
    const kilitli = renderHook(() => useLandscapeLock());
    const serbest = renderHook(() => useLandscapeLock(false));
    serbest.unmount();
    expect(calls).toEqual(['lock:LANDSCAPE']);
    kilitli.unmount();
    expect(last()).toBe('unlock');
  });

  it('enabled true→false geçişi kilidi bırakır', () => {
    const ekran = renderHook(({ on }: { on: boolean }) => useLandscapeLock(on), { initialProps: { on: true } });
    ekran.rerender({ on: false });
    expect(last()).toBe('unlock');
    ekran.unmount();
  });

  it('dikey kilitli ekran üstüne yatay ekran açılıp kapanınca dikey kilit geri gelir', () => {
    const dikey = renderHook(() => usePortraitLock());
    const yatay = renderHook(() => useLandscapeLock());
    yatay.unmount();
    expect(last()).toBe('lock:PORTRAIT_UP');
    dikey.unmount();
    expect(last()).toBe('unlock');
  });
});
