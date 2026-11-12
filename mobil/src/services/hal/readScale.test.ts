// Kantardan tek okuma (2026-11-10): simüle cihaz SIMULATED beyan eder; gerçek okuma SCALE; okunamayan/≤0 fail-closed.
import { NO_SCALE, readScaleOnce } from './readScale';
import type { DevicePeripheral } from '../peripheral.service';

jest.mock('../../hooks/usePeripheralIO', () => ({ buildIoFromPeripheral: jest.fn() }));
jest.mock('./btClassic.transport', () => ({ isBonded: jest.fn(), pairByMac: jest.fn() }));

const dev = (o: Partial<DevicePeripheral>) => ({ connectionType: 'BLUETOOTH_SPP', address: 'AA', readMode: 'STREAM', ...o }) as DevicePeripheral;
const io = (decoded: number | null) => () =>
  ({ supported: true, transport: { read: jest.fn().mockResolvedValue('raw') }, codec: { decode: () => decoded } }) as never;

describe('readScaleOnce', () => {
  it('cihaz yok → NO_SCALE', async () => {
    expect(await readScaleOnce(null)).toEqual({ ok: false, error: NO_SCALE });
  });
  it('simüle → SIMULATED + uyarı; değer uydurma beyanlı', async () => {
    const r = await readScaleOnce(dev({ simulate: true }), { random: () => 0.5 });
    expect(r).toMatchObject({ ok: true, kg: 55, source: 'SIMULATED' });
    expect(r.ok && r.notice?.title).toBe('SİMÜLASYON tartısı');
  });
  it('gerçek okuma → SCALE; eşli değilse önce eşleştirme uyarısı', async () => {
    const onPairing = jest.fn();
    const pair = jest.fn().mockResolvedValue(undefined);
    const r = await readScaleOnce(dev({}), { build: io(23.4), bonded: async () => false, pair, onPairing });
    expect(r).toEqual({ ok: true, kg: 23.4, source: 'SCALE' });
    expect(onPairing).toHaveBeenCalled();
    expect(pair).toHaveBeenCalledWith('AA');
  });
  it('≤0 ya da çözülemeyen değer → hata (mutasyona değer gitmez)', async () => {
    const r = await readScaleOnce(dev({}), { build: io(0), bonded: async () => true });
    expect(r).toMatchObject({ ok: false, error: { title: 'Kantar okunamadı' } });
  });
  it('desteklenmeyen derleme → hata', async () => {
    const r = await readScaleOnce(dev({}), { build: () => ({ supported: false }) as never });
    expect(r.ok).toBe(false);
  });
});
