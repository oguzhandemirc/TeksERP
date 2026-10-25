// =============================================================================
// Bekçi: donanım özeti (eşleme v2) — backend `computeHwDigest` ile BAYT-EŞİT
// =============================================================================
// Vektör `Teks-Erp/scripts/test_cihaz_yeniden_baglama.ts` §1 ile ortak (openssl ile doğrulandı).
// NEGATİF SONDA (ölçüldü 2026-10-25): domain'den `\n` atılınca 2 kırmızı (§1, §2); dönüşe ham
// değer eklenince 2 kırmızı (§2, §4).
// =============================================================================
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { computeHwDigest, getHardwareDigest, getDeviceModel } from './hardwareId';

jest.mock('expo-application', () => ({ getAndroidId: jest.fn() }));

const VEKTOR = {
  installationId: '00000000-0000-4000-8000-000000000001',
  ham: '9774d56d682e549c',
  ozet: 'b1c0721db73f7297afbeadaddff6de68c62f572cc68d36c9a0de087600dea9c7',
};

const setOs = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

describe('hardwareId', () => {
  const realOs = Platform.OS;
  afterEach(() => setOs(realOs));

  it('§1 test vektörü backend ile bayt-eşit', () => {
    expect(computeHwDigest(VEKTOR.installationId, 'ANDROID_ID', VEKTOR.ham)).toBe(VEKTOR.ozet);
  });

  it('§2 Android: ANDROID_ID okunur, özet {v:1, kaynak, ozet} döner', () => {
    setOs('android');
    (Application.getAndroidId as jest.Mock).mockReturnValue(VEKTOR.ham);
    expect(getHardwareDigest(VEKTOR.installationId)).toEqual({ v: 1, kaynak: 'ANDROID_ID', ozet: VEKTOR.ozet });
  });

  it('§3 installationId yoksa null (anahtarsız özet gönderilmez)', () => {
    setOs('android');
    (Application.getAndroidId as jest.Mock).mockReturnValue(VEKTOR.ham);
    expect(getHardwareDigest(null)).toBeNull();
    expect(getHardwareDigest('  ')).toBeNull();
  });

  it('§4 dönüşte ham değer YOK', () => {
    setOs('android');
    (Application.getAndroidId as jest.Mock).mockReturnValue(VEKTOR.ham);
    expect(JSON.stringify(getHardwareDigest(VEKTOR.installationId))).not.toContain(VEKTOR.ham);
  });

  it('§5 okuma arızası / Android dışı → null (announce düşmez)', () => {
    setOs('android');
    (Application.getAndroidId as jest.Mock).mockImplementation(() => {
      throw new Error('native yok');
    });
    expect(getHardwareDigest(VEKTOR.installationId)).toBeNull();
    setOs('ios');
    (Application.getAndroidId as jest.Mock).mockReturnValue(VEKTOR.ham);
    expect(getHardwareDigest(VEKTOR.installationId)).toBeNull();
    expect(getDeviceModel()).toBeUndefined();
  });
});
