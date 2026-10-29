// =============================================================================
// H3 bekçisi — geç gelen sunucu reddi ve sıfırlanamayan sayaç (PR #261 inceleme bulguları)
// =============================================================================
// SIMULATED_METER_DISABLED → aynı dokunuş elle metreyle; 409 KURSUN_METER_MISMATCH → aynı değerle
// sebep modalı; doğrulanmamış sıfırlamadan sonraki okuma metre sayılmaz; CUMULATIVE başlangıcı
// yalnız kayıt kuyruğa girince ilerler.
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import type { CompleteQc2Request } from '../../../services/kursunQc.service';
import { counterBaselineStore, unresetCounterStore } from './meterDevice';
import { device, mockPersist, mockRead, resetMeterMocks, setup, summary, write } from './meterTestHarness';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../../hooks/usePeripheralIO', () => ({
  readMeter: jest.fn(),
  buildIoFromPeripheral: jest.fn(),
}));
jest.mock('../../../offline/mutations', () => ({
  ...jest.requireActual('../../../offline/mutations'),
  persistStationQueueNow: jest.fn(),
}));
jest.mock('../../../services/kursunQc.service', () => ({
  kursunQcService: { pinAckMeterReading: jest.fn(), recordMeterReading: jest.fn(), completeQc2: jest.fn() },
}));


beforeEach(resetMeterMocks);

describe('geç gelen sunucu reddi (inceleme bulguları)', () => {
  const reject = (code: string, extra: Record<string, unknown> = {}) => ({ status: code === 'KURSUN_METER_MISMATCH' ? 409 : 400, details: { code, ...extra } });

  it('SIMULATED_METER_DISABLED: aynı dokunuş elle metreyle sürer; sonraki dokunuşta simüle değer gitmez', async () => {
    const t = setup(summary('OUT'), device({ simulate: true }));
    t.complete.mockReturnValueOnce(reject('SIMULATED_METER_DISABLED'));
    await t.press('gramaj-tap-50GR');
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut?.source).toBe('SIMULATED');
    await act(async () => fireEvent.changeText(t.getByTestId('metre-elle-giris'), '77'));
    await t.press('metre-elle-kaydet');
    const retry = t.complete.mock.calls[1][0] as CompleteQc2Request;
    expect(retry.meterOut).toMatchObject({ meters: 77, source: 'OPERATOR' });
    expect(retry.properties).toEqual((t.complete.mock.calls[0][0] as CompleteQc2Request).properties);
    expect(retry.meterOut?.clientToken).not.toBe((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut?.clientToken);

    await t.press('gramaj-tap-50GR');
    expect(t.complete).toHaveBeenCalledTimes(2);
    expect(t.getByTestId('metre-elle-giris')).toBeTruthy();
  });

  it('KURSUN_METER_MISMATCH: sayaç sıfırlanmaz, sebep modalı AYNI değerle açılır; sebeple yeniden gider ve sonra sıfırlanır', async () => {
    mockRead.mockResolvedValueOnce({ ok: true, value: 140 }).mockResolvedValue({ ok: false, reason: 'READ_FAILED', message: 'x', noValue: true });
    const t = setup(summary('OUT', 'OPERATOR_REASON', null), device());
    t.complete.mockReturnValueOnce(reject('KURSUN_METER_MISMATCH', { diffMeters: 40, allowedMeters: 5 }));
    await t.press('gramaj-tap-50GR');
    expect(t.getByTestId('metre-sebep-kaydet')).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    expect(await unresetCounterStore.has('per-1')).toBe(false);
    await t.press('metre-sebep-KUMAS_CEKTI');
    await t.press('metre-sebep-kaydet');
    const retry = t.complete.mock.calls[1][0] as CompleteQc2Request;
    expect(retry.meterOut).toMatchObject({ meters: 140, source: 'MACHINE', rawCounter: 140, ack: { reasonCode: 'KUMAS_CEKTI', reasonText: null } });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    // Yeniden okuma yok: tek okuma + sıfırlama doğrulama okuması.
    expect(mockRead).toHaveBeenCalledTimes(2);
    await waitFor(async () => expect(await unresetCounterStore.has('per-1')).toBe(false));
  });
});

describe('sıfırlanamayan sayaç', () => {
  it('sıfırlama kanıtlanamazsa işaret kalır; sonraki okuma birikmiş değeri MACHINE saymaz, elle girilir ve ham değer iz olarak gider', async () => {
    mockPersist.mockResolvedValueOnce(false);
    mockRead.mockResolvedValueOnce({ ok: true, value: 42.5 }).mockResolvedValueOnce({ ok: true, value: 90 }).mockResolvedValue({ ok: false, reason: 'READ_FAILED', message: 'x', noValue: true });
    const t = setup(summary('OUT'), device());
    await t.press('gramaj-tap-50GR');
    await waitFor(() => expect(mockPersist).toHaveBeenCalledTimes(1));
    expect(write).not.toHaveBeenCalled();
    await waitFor(async () => expect(await unresetCounterStore.has('per-1')).toBe(true));

    await t.press('gramaj-tap-50GR');
    expect(t.complete).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.changeText(t.getByTestId('metre-elle-giris'), '47,5'));
    await t.press('metre-elle-kaydet');
    expect((t.complete.mock.calls[1][0] as CompleteQc2Request).meterOut).toMatchObject({ meters: 47.5, source: 'OPERATOR', rawCounter: 90, peripheralId: 'per-1' });
    // Elle kayıt kuyruğa girince sayaç yine sıfırlanır; doğrulanınca işaret kalkar.
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await unresetCounterStore.has('per-1')).toBe(false));
  });

  it('CUMULATIVE: sebep modalında vazgeçilirse başlangıç ilerlemez; yeniden dokunuş aynı farkı görür', async () => {
    await counterBaselineStore.set('per-1', 1402);
    mockRead.mockResolvedValue({ ok: true, value: 1600 });
    const t = setup(summary('OUT', 'OPERATOR_REASON', 5), device({ counterMode: 'CUMULATIVE' }));
    await t.press('gramaj-tap-50GR');
    await t.press('metre-sebep-vazgec');
    expect(await counterBaselineStore.get('per-1')).toBe(1402);
    await t.press('gramaj-tap-50GR');
    await t.press('metre-sebep-KUMAS_CEKTI');
    await t.press('metre-sebep-kaydet');
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut).toMatchObject({ meters: 198, source: 'MACHINE', rawCounter: 1600 });
    await waitFor(async () => expect(await counterBaselineStore.get('per-1')).toBe(1600));
  });
});
