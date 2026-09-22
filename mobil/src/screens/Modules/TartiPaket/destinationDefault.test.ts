import { resolveDestination } from './destinationDefault';
import type { DestinationLock } from '../../../services/packing.service';

const lock = (d: DestinationLock['destination']): DestinationLock => ({
  destination: d,
  source: d ? 'CUSTOMER' : null,
  exportCode: null,
  quickShipBlockedReason: null,
});

// 2026-09-13'teki "varsayılan, kilit değil" davranışı 2026-09-23'te KİLİDE çevrildi (tablet ikizi);
// eski vakalar yeni kuralın karşılığına dönüştürüldü.
describe('resolveDestination — yön cariden/şubeden KİLİTLİ (tablet ikizi)', () => {
  it('cari EXPORT kilitli → EXPORT, seçim gerekmez', () => {
    expect(resolveDestination({ lock: lock('EXPORT'), picked: null })).toEqual({ destination: 'EXPORT', locked: true, needsPick: false });
  });
  it('zincir boş, seçim yok → yön YOK, seçim bekler (örtük DOMESTIC gönderilmez)', () => {
    expect(resolveDestination({ lock: lock(null), picked: null })).toEqual({ destination: null, locked: false, needsPick: true });
  });
  it('kilitliyken operatörün seçimi YOK SAYILIR (eski "seçim ezilmez" kuralının tersi)', () => {
    expect(resolveDestination({ lock: lock('EXPORT'), picked: 'DOMESTIC' }).destination).toBe('EXPORT');
  });
  it('zincir boşken ilk seçim kullanılır', () => {
    expect(resolveDestination({ lock: lock(null), picked: 'DOMESTIC' }).destination).toBe('DOMESTIC');
  });
  it('kilit henüz okunmadı → yön yok, seçim de istenmez', () => {
    expect(resolveDestination({ lock: undefined, picked: 'EXPORT' })).toEqual({ destination: null, locked: false, needsPick: false });
  });
});
