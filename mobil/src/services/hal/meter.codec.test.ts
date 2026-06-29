// meter.codec: ham yanıttan metre/kantar değeri ayıklama (saf parser).
import { parseMeterReading, meterCodec } from './meter.codec';

describe('parseMeterReading (varsayılan: decimals=1, scale=1 — eski davranış)', () => {
  it('düz sayı + terminatör', () => {
    expect(parseMeterReading('123.4\r\n')).toBe(123.4);
  });
  it('etiket önekli cevapta SON sayıyı alır', () => {
    expect(parseMeterReading('M=123.4')).toBe(123.4);
    expect(parseMeterReading('LEN 0123.45 m\r\n')).toBe(123.5); // 1 ondalığa yuvarlar
  });
  it('virgüllü ondalık → noktaya çevirir', () => {
    expect(parseMeterReading('12,5\r\n')).toBe(12.5);
  });
  it('birden çok sayı → sonuncusu (en güncel okuma)', () => {
    expect(parseMeterReading('PREV 10.0 CUR 42.7\r\n')).toBe(42.7);
  });
  it('tam sayı', () => {
    expect(parseMeterReading('200\n')).toBe(200);
  });
  it('sayı yoksa/boşsa null', () => {
    expect(parseMeterReading('')).toBeNull();
    expect(parseMeterReading('ERR\r\n')).toBeNull();
    expect(parseMeterReading('---')).toBeNull();
  });
  it('sıfır/negatif atlar, geçerli pozitifi seçer', () => {
    expect(parseMeterReading('0\r\n')).toBeNull();
    expect(parseMeterReading('val 0 then 15.5\r\n')).toBe(15.5);
  });
});

describe('parseMeterReading — scale/decimals parametreleri', () => {
  it('scale ile ölçekler (cm→m: 0.01)', () => {
    expect(parseMeterReading('12345\r\n', { scale: 0.01 })).toBe(123.5); // 123.45→123.5
  });
  it('decimals=2 daha hassas yuvarlar', () => {
    expect(parseMeterReading('123.456\r\n', { decimals: 2 })).toBe(123.46);
  });
  it('decimals=0 tam sayıya yuvarlar', () => {
    expect(parseMeterReading('123.6\r\n', { decimals: 0 })).toBe(124);
  });
});

describe('meterCodec fabrikası', () => {
  it('decode opsiyonları uygular', () => {
    const codec = meterCodec({ scale: 0.01, decimals: 2 });
    expect(codec.decode('12345\r\n')).toBe(123.45);
    expect(codec.decode('ERR')).toBeNull();
  });
});
