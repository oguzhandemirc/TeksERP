// btMeter.service: makine cevabından metre değeri ayıklama (saf parser).
import { parseMeterReading } from './btMeter.service';

describe('parseMeterReading', () => {
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

  it('sayı yoksa veya boşsa null', () => {
    expect(parseMeterReading('')).toBeNull();
    expect(parseMeterReading('ERR\r\n')).toBeNull();
    expect(parseMeterReading('---')).toBeNull();
  });

  it('sıfır / negatif gibi geçersiz değerleri atlar, geçerli pozitifi seçer', () => {
    expect(parseMeterReading('0\r\n')).toBeNull();
    expect(parseMeterReading('val 0 then 15.5\r\n')).toBe(15.5);
  });
});
