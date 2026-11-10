// Tambur metre şeridi saf katmanı: metin parçaları, aşım hesabı (engel değil), girdi ayrıştırma.
import { cutOverage, fmtM, meterTrailParts, meterTrailText, overageWarningText, parseCutInput, type RollMeterTrail } from './meterTrail';

const BASE: RollMeterTrail = {
  rollId: 'r1',
  declaredM: 500,
  prior: { kind: 'KURSUN_OUT', stationName: 'Kurşun 1', meters: 548, at: '2026-11-10T08:00:00.000Z' },
  referenceM: 548,
  cutSoFarM: 320,
  remainingM: 228,
  overReference: false,
};

describe('meterTrailText', () => {
  it('⭐ tam şerit: Beyan · Kurşun · Kesilen · Kalan', () => {
    expect(meterTrailText(BASE)).toBe('Beyan 500 m · Kurşun 548 m · Kesilen 320 m · Kalan ≈ 228 m');
  });
  it('prior yoksa önceki ölçüm parçası yazılmaz', () => {
    expect(meterTrailText({ ...BASE, prior: null, referenceM: 500, remainingM: 180 })).toBe('Beyan 500 m · Kesilen 320 m · Kalan ≈ 180 m');
  });
  it('STATION_OUT → istasyon adı', () => {
    const t = { ...BASE, prior: { ...BASE.prior!, kind: 'STATION_OUT' as const, stationName: 'Ram 2' } };
    expect(meterTrailParts(t)?.[1]).toBe('Ram 2 548 m');
  });
  it('beyan da önceki ölçüm de yoksa şerit yok', () => {
    expect(meterTrailText({ ...BASE, declaredM: null, prior: null, referenceM: null, remainingM: null })).toBeNull();
    expect(meterTrailText(null)).toBeNull();
    expect(meterTrailText(undefined)).toBeNull();
  });
  it('eksi kalan → "Aşım +X m"', () => {
    expect(meterTrailParts({ ...BASE, cutSoFarM: 560, remainingM: -12 })?.[3]).toBe('Aşım +12 m');
  });
  it('ondalık Türkçe virgülle, tek basamak', () => {
    expect(fmtM(12.25)).toBe('12,3');
    expect(fmtM(547.96)).toBe('548');
  });
});

describe('cutOverage', () => {
  it('⭐ kesilen + girilen referansı aşarsa fark', () => {
    expect(cutOverage(BASE, 230)).toBeCloseTo(2);
    expect(overageWarningText(2)).toBe('Önceki ölçümü aşıyor (+2 m) — kesim kaydedilir, fazlası faturaya girer');
  });
  it('negatif sonda: tam kalan kadar kesim aşım değildir', () => {
    expect(cutOverage(BASE, 228)).toBeNull();
    expect(cutOverage(BASE, 228.04)).toBeNull();
  });
  it('referans yoksa uyarı yok', () => {
    expect(cutOverage({ ...BASE, referenceM: null }, 9999)).toBeNull();
    expect(cutOverage(null, 9999)).toBeNull();
  });
  it('girdi yokken önceden aşılmışsa yine uyarır', () => {
    expect(cutOverage({ ...BASE, cutSoFarM: 560 }, 0)).toBeCloseTo(12);
  });
});

describe('parseCutInput', () => {
  it('virgül kabul, boş/bozuk/≤0 → 0', () => {
    expect(parseCutInput('12,5')).toBe(12.5);
    expect(parseCutInput(' 40 ')).toBe(40);
    expect(parseCutInput('')).toBe(0);
    expect(parseCutInput('abc')).toBe(0);
    expect(parseCutInput('-3')).toBe(0);
    expect(parseCutInput(undefined)).toBe(0);
  });
});
