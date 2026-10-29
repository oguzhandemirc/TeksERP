// Ortak readMeter (Tambur + Kurşun): oku → çöz; ≤0 Tambur'da red, sayaçta 0 kabul; hata mesajı korunur.
import { readMeter } from './usePeripheralIO';

const mockRead = jest.fn();
jest.mock('../services/hal/btClassic.transport', () => ({
  btClassicTransport: () => ({ read: (...a: unknown[]) => mockRead(...a), write: jest.fn(), test: jest.fn() }),
  isBtSupported: () => true,
}));

const ROW = { connectionType: 'BLUETOOTH_SPP', kind: 'METER', address: 'AA', decimals: 1, scale: 1, pollCommand: 'T', readMode: 'POLL' as const };

describe('readMeter', () => {
  beforeEach(() => mockRead.mockReset());
  it('pozitif değer döner; POLL seçenekleri iletilir', async () => {
    mockRead.mockResolvedValue('12.5\r\n');
    const r = await readMeter(ROW);
    expect(r).toMatchObject({ ok: true, value: 12.5 });
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ readMode: 'POLL', pollCommand: 'T' }));
  });
  it('0 / çözülemeyen yanıt: Tambur mesajı aynı, noValue işaretli (sıfırlanmış sayaç)', async () => {
    mockRead.mockResolvedValue('0');
    expect(await readMeter(ROW)).toEqual({ ok: false, reason: 'READ_FAILED', message: 'Geçerli metre yanıtı gelmedi', noValue: true });
  });
  it('taşıyıcı hatası mesajıyla döner; adres yoksa UNSUPPORTED', async () => {
    mockRead.mockRejectedValue(new Error('Bağlantı yok'));
    expect(await readMeter(ROW)).toEqual({ ok: false, reason: 'READ_FAILED', message: 'Bağlantı yok' });
    expect(await readMeter({ ...ROW, address: null })).toEqual({ ok: false, reason: 'UNSUPPORTED' });
  });
});
