import {
  isQualityOnlyStation,
  screenForStation,
  stationMatchesScreen,
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
    // KaliteKontrol tek istisna: KursunQc ile aynı türü paylaşır (yer ayrımı stationMatchesScreen).
    for (const [screen, kind] of Object.entries(STATION_KIND_BY_SCREEN)) {
      if (screen === 'KaliteKontrol') continue;
      expect(SCREEN_BY_STATION_KIND[kind!]).toBe(screen);
    }
  });

  it('tam 6 oturumlu ekran var (KK1/KursunQc/KaliteKontrol/Tambur/TartiPaket/Dokuma)', () => {
    expect(SESSION_SCREEN_KEYS.sort()).toEqual(['KK1', 'KursunQc', 'KaliteKontrol', 'Tambur', 'TartiPaket', 'Dokuma'].sort());
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

describe('Kurşun ↔ Kalite Kontrol yer ayrımı (isQualityOnlyStation)', () => {
  const KURSUN = { kind: 'PROCESS_QC', isKursunStation: true, canInspect: true };
  const DETAYLI = { kind: 'PROCESS_QC', isKursunStation: false, canInspect: true };
  const LEGACY = { kind: 'PROCESS_QC' }; // eski sunucu: alan yok

  it('⭐ kurşunsuz muayeneli PROCESS_QC Kalite listesinde, Kurşun listesinde DEĞİL', () => {
    expect(stationMatchesScreen('KaliteKontrol', DETAYLI)).toBe(true);
    expect(stationMatchesScreen('KursunQc', DETAYLI)).toBe(false);
    expect(screenForStation(DETAYLI)).toBe('KaliteKontrol');
  });

  it('⭐ kurşun istasyonu Kurşun listesinde, Kalite listesinde değil', () => {
    expect(stationMatchesScreen('KursunQc', KURSUN)).toBe(true);
    expect(stationMatchesScreen('KaliteKontrol', KURSUN)).toBe(false);
    expect(screenForStation(KURSUN)).toBe('KursunQc');
  });

  it('eski sunucu (alan yok) → bugünkü davranış: Kurşun ekranı', () => {
    expect(isQualityOnlyStation(LEGACY)).toBe(false);
    expect(stationMatchesScreen('KursunQc', LEGACY)).toBe(true);
    expect(screenForStation(LEGACY)).toBe('KursunQc');
  });

  it('muayenesi kapalı kurşunsuz PROCESS_QC Kurşun ekranında kalır (öksüz yer yok)', () => {
    const noInspect = { kind: 'PROCESS_QC', isKursunStation: false, canInspect: false };
    expect(stationMatchesScreen('KursunQc', noInspect)).toBe(true);
    expect(stationMatchesScreen('KaliteKontrol', noInspect)).toBe(false);
  });

  it('başka tür hiçbir zaman Kalite ekranına düşmez', () => {
    expect(stationMatchesScreen('KaliteKontrol', { kind: 'TAMBUR', isKursunStation: false })).toBe(false);
    expect(screenForStation({ kind: 'TAMBUR' })).toBe('Tambur');
    expect(screenForStation({ kind: 'OTHER' })).toBeNull();
  });
});
