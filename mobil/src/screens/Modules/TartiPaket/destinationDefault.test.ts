import { resolveDestination } from './destinationDefault';

describe('resolveDestination — cari varsayılanı kilit değil (tablet ikizi)', () => {
  it('dokunulmadı + müşteri EXPORT → EXPORT', () => {
    expect(resolveDestination({ current: 'DOMESTIC', touched: false, customerDefault: 'EXPORT' })).toBe('EXPORT');
  });
  it('varsayılan yok → DOMESTIC (bugünkü davranış)', () => {
    expect(resolveDestination({ current: 'DOMESTIC', touched: false, customerDefault: null })).toBe('DOMESTIC');
  });
  it('operatör dokundu → seçimi ezilmez, geri dönülmez', () => {
    expect(resolveDestination({ current: 'DOMESTIC', touched: true, customerDefault: 'EXPORT' })).toBe('DOMESTIC');
  });
});
