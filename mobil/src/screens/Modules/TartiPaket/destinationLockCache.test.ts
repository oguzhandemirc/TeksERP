// BEKÇİ — tablet sevk yönü kilidi önbelleği (2026-09-23; panel turu SY3'ün tablet ikizi): sevkiyat
// kurulunca `destination-lock` bayatlamalı — yoksa ilk seçimi karta yazılan carinin sonraki sevki
// (ekrana 10 sn içinde dönüş) yönü bir daha sorar. Negatif sonda: `invalidateAfterShipment`taki
// `invalidateDestinationLock(qc)` satırı silindi → ⭐ ×.
import { QueryClient } from '@tanstack/react-query';
import { destinationLockQueryKey, invalidateAfterShipment } from './destinationDefault';

describe('tablet sevk yönü kilidi önbelleği', () => {
  it('⭐ sevkiyat sonrası cari ve şube anahtarlı kilit sorguları bayatlar', () => {
    const qc = new QueryClient();
    qc.setQueryData(destinationLockQueryKey('c1', null), { destination: null });
    qc.setQueryData(destinationLockQueryKey('c1', 'b1'), { destination: null });
    invalidateAfterShipment(qc, 'c1');
    expect(qc.getQueryState(destinationLockQueryKey('c1', null))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(destinationLockQueryKey('c1', 'b1'))?.isInvalidated).toBe(true);
  });
});
