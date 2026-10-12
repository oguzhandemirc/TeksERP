// devicePattern: cihaz deseninin tablet tarafı savunması (denetim G4-B2).
import { compileDevicePattern, matchDevicePattern, PATTERN_INPUT_MAX, PATTERN_SOURCE_MAX } from './devicePattern';
import { parseMeterReading } from './meter.codec';

describe('compileDevicePattern', () => {
  it('boş / boşluk → null', () => {
    expect(compileDevicePattern('')).toBeNull();
    expect(compileDevicePattern('   ')).toBeNull();
    expect(compileDevicePattern(undefined)).toBeNull();
  });
  it('derlenemeyen desen → null (fırlatmaz)', () => {
    expect(compileDevicePattern('([0-9]')).toBeNull();
  });
  it('tavanı aşan desen → null', () => {
    expect(compileDevicePattern('a'.repeat(PATTERN_SOURCE_MAX))).not.toBeNull();
    expect(compileDevicePattern('a'.repeat(PATTERN_SOURCE_MAX + 1))).toBeNull();
  });
});

describe('matchDevicePattern', () => {
  it('tavan içi girdide eşleşir', () => {
    const re = compileDevicePattern('(\\d+\\.\\d+)B')!;
    expect(matchDevicePattern(re, '25.85B0')?.[1]).toBe('25.85');
  });
  it('tavanı aşan girdi desene sokulmaz', () => {
    const re = compileDevicePattern('(\\d+\\.\\d+)B')!;
    expect(matchDevicePattern(re, 'x'.repeat(PATTERN_INPUT_MAX) + '25.85B0')).toBeNull();
  });
  it('üstel desen + uzun kötü girdi okumayı kilitlemez', () => {
    const re = compileDevicePattern('(a+)+$')!;
    const t = Date.now();
    expect(matchDevicePattern(re, 'a'.repeat(5000) + '!')).toBeNull();
    expect(Date.now() - t).toBeLessThan(100);
  });
});

describe('parseMeterReading desen savunması', () => {
  it('geçersiz desen → sezgisel', () => {
    expect(parseMeterReading('M=12.5', { pattern: '([0-9]' })).toBe(12.5);
  });
  it('tavanı aşan çerçeve → desen atlanır, sezgisel', () => {
    expect(parseMeterReading(' '.repeat(300) + '42.0', { pattern: '(\\d+)X' })).toBe(42);
  });
  it('tavan içinde desen yine önce gelir', () => {
    expect(parseMeterReading('10.0 B 25.85', { pattern: '(\\d+\\.\\d+) B' })).toBe(10);
  });
});
