import {
  SCREEN_BY_STATION_KIND,
  STATION_KIND_BY_SCREEN,
  SESSION_SCREEN_KEYS,
  isSessionScreen,
  isSessionStationKind,
} from './stationScreens';
import { SCREEN_BY_KEY } from '../types/permissions';

describe('stationScreens registry', () => {
  it('çift yön tutarlı: kind→ekran→kind aynı yere döner', () => {
    for (const [kind, screen] of Object.entries(SCREEN_BY_STATION_KIND)) {
      expect(STATION_KIND_BY_SCREEN[screen]).toBe(kind);
    }
    for (const [screen, kind] of Object.entries(STATION_KIND_BY_SCREEN)) {
      expect(SCREEN_BY_STATION_KIND[kind!]).toBe(screen);
    }
  });

  it('tam 5 oturumlu ekran var (KK1/KursunQc/Tambur/TartiPaket)', () => {
    expect(SESSION_SCREEN_KEYS.sort()).toEqual(['KK1', 'KursunQc', 'Tambur', 'TartiPaket', 'Dokuma'].sort());
  });

  it('oturumlu ekranların hepsi MOBILE_SCREENS kaydında mevcut', () => {
    for (const key of SESSION_SCREEN_KEYS) {
      expect(SCREEN_BY_KEY[key]).toBeDefined();
    }
  });

  it('gezici ekranlar oturumlu DEĞİL', () => {
    for (const key of ['Depo', 'Sevkiyat', 'FasonSevk', 'FasonKabul', 'KartelaSevk', 'IadeGirisi', 'HizliIsEmri', 'KursunDagitim'] as const) {
      expect(isSessionScreen(key)).toBe(false);
    }
  });

  it('isSessionStationKind yalnız 4 türü kabul eder', () => {
    expect(isSessionStationKind('RAW_QC')).toBe(true);
    expect(isSessionStationKind('SHIPPING')).toBe(true);
    expect(isSessionStationKind('SUBCONTRACTOR')).toBe(false);
    expect(isSessionStationKind('OTHER')).toBe(false);
    expect(isSessionStationKind(null)).toBe(false);
    expect(isSessionStationKind(undefined)).toBe(false);
  });
});
