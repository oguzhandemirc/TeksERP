// =============================================================================
// H3 bekçisi — kurşun sayaç akışı (karar belgesi §8 H3 kabulü)
// =============================================================================
// BT bağlı akış ≤2 dokunuş, elle ≤3; sapma modalı açıkken transport.write 0; kuyruğa
// kalıcı yazım kanıtlanmadan sıfırlama 0 ve sıra (yazım → sıfırlama); CUMULATIVE
// 1500 − 1402 = 98; SİMÜLASYON toast; PIN kuyruk/depo JSON'unda yok; OFF'ta gövde
// bayt-aynı; OPERATOR_REASON'da sebepsiz kayıt kuyruğa girmez.
import React, { useState } from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { dehydrate, onlineManager, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../test/render';
import { STATION_MUT, persistStationQueueNow } from '../../../offline/mutations';
import { PERSIST_DEHYDRATE_OPTIONS } from '../../../offline/persistPolicy';
import { buildIoFromPeripheral, readMeter } from '../../../hooks/usePeripheralIO';
import { kursunQcService, type CompleteQc2Request } from '../../../services/kursunQc.service';
import type { DevicePeripheral } from '../../../services/peripheral.service';
import type { KursunStepSummary } from '../../../types/models';
import GramajTapPanel from './GramajTapPanel';
import MeterModals from './MeterModals';
import MeterStrip from './MeterStrip';
import { composeStationPanels } from './stationPanels';
import { metersFromCounter, counterStrategy } from './meterCapture';
import { counterBaselineStore } from './meterDevice';
import { useGramajTap } from './useGramajTap';
import { useMeterAcks } from './useMeterAcks';
import { useMeterCapture } from './useMeterCapture';

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

const mockRead = readMeter as jest.Mock;
const mockIo = buildIoFromPeripheral as jest.Mock;
const mockPersist = persistStationQueueNow as jest.Mock;
const order: string[] = [];
const write = jest.fn(async () => {
  order.push('write');
});

type Capture = 'OFF' | 'OUT' | 'IN_OUT';
type Approval = 'NONE' | 'OPERATOR_REASON' | 'SUPERVISOR_PIN' | 'OFFICE';

function summary(capture: Capture | null, approval: Approval = 'NONE', thresholdM: number | null = null): KursunStepSummary {
  return {
    workOrderStepId: 'step-1',
    inspectionEnabled: false,
    properties: [
      { propertyId: 'kursun', code: 'KURSUN', name: 'Kurşunlu', mode: 'REQUIRED', valueType: 'FLAG', values: [] },
      { propertyId: 'gramaj', code: 'GRAMAJ', name: 'Gramaj', mode: 'OPTIONAL', valueType: 'CHOICE', values: [{ code: '50GR', name: '50 gr' }], variantOfPropertyId: 'kursun' },
    ],
    targetValues: [],
    ...(capture ? { meter: { capture, policy: { thresholdM, thresholdPct: null, basis: 'DECLARED_IN', approvalMode: approval } } } : {}),
    rolls: [],
  } as unknown as KursunStepSummary;
}

const ROLL = { rollId: 'roll-1', barcode: 'T000123456', currentQty: 100, meter: { declaredIn: 100, measuredIn: null } };

function device(over: Partial<DevicePeripheral> = {}): DevicePeripheral {
  return {
    id: 'per-1', code: 'S1', name: 'Sayaç', kind: 'METER', connectionType: 'BLUETOOTH_SPP', address: 'AA',
    port: null, readMode: 'POLL', pollCommand: null, terminator: null, identifyPattern: null, decimals: 1, scale: 1,
    timeoutMs: null, role: null, simulate: false, counterMode: 'RESETTING', resetCommand: 'R\\r', ...over,
  };
}

function Harness(p: { s: KursunStepSummary; peripheral: DevicePeripheral | null; complete: jest.Mock }) {
  const acks = useMeterAcks();
  const meter = useMeterCapture({ summary: p.s, peripheral: p.peripheral, acks });
  const panels = composeStationPanels({ inspectionEnabled: false, properties: p.s.properties ?? [] });
  const state = useGramajTap({
    cfg: panels.tap,
    summary: p.s,
    roll: ROLL,
    operator: 'Ayşe',
    complete: (vars, opts) => {
      p.complete(vars);
      opts.onSuccess?.();
      opts.onSettled?.();
    },
    refresh: jest.fn(),
    meter,
  });
  return (
    <>
      {meter.outOn && <MeterStrip meter={meter} acks={acks} roll={ROLL} stepId="step-1" />}
      <GramajTapPanel state={state} hasRoll />
      <MeterModals meter={meter} acks={acks} rolls={[ROLL]} />
    </>
  );
}

function setup(s: KursunStepSummary, peripheral: DevicePeripheral | null) {
  const complete = jest.fn();
  let presses = 0;
  const r = renderWithPaper(<Harness s={s} peripheral={peripheral} complete={complete} />);
  const press = async (id: string) => {
    presses += 1;
    await act(async () => {
      fireEvent.press(r.getByTestId(id));
    });
  };
  return { ...r, complete, press, presses: () => presses };
}

beforeEach(async () => {
  jest.clearAllMocks();
  order.length = 0;
  await AsyncStorage.clear();
  mockIo.mockReturnValue({ transport: { write, read: jest.fn(), test: jest.fn() }, codec: {}, supported: true });
  mockPersist.mockImplementation(async () => {
    order.push('persist');
    return true;
  });
  onlineManager.setOnline(true);
});

describe('sayaç aritmetiği', () => {
  it('CUMULATIVE 1500 − 1402 = 98; tekrar ve negatif elle yola düşer', () => {
    expect(metersFromCounter(1500, 1402)).toEqual({ kind: 'OK', meters: 98 });
    expect(metersFromCounter(1402, 1402)).toEqual({ kind: 'REPEAT' });
    expect(metersFromCounter(10, 1402)).toEqual({ kind: 'NEGATIVE' });
    expect(metersFromCounter(10, null)).toEqual({ kind: 'NO_BASELINE' });
  });
  it('sıfırlama yalnız RESETTING + dolu komutta', () => {
    expect(counterStrategy({ counterMode: 'RESETTING', resetCommand: 'R' })).toBe('RESET');
    expect(counterStrategy({ counterMode: 'RESETTING', resetCommand: ' ' })).toBe('DIFF');
    expect(counterStrategy({ counterMode: 'CUMULATIVE', resetCommand: 'R' })).toBe('DIFF');
    expect(counterStrategy({ counterMode: null, resetCommand: null })).toBe('DIFF');
  });
});

describe('OFF — bugünkü davranış', () => {
  it.each([[null], ['OFF' as Capture]])('kip %p: completeQc2 gövdesi bayt-aynı, sayaç okunmaz', async (cap) => {
    const t = setup(summary(cap), device());
    await t.press('gramaj-tap-50GR');
    expect(JSON.stringify(t.complete.mock.calls[0][0])).toBe(
      '{"rollId":"roll-1","stepId":"step-1","properties":[{"propertyId":"gramaj","valueCode":"50GR"},{"propertyId":"kursun"}]}',
    );
    expect(mockRead).not.toHaveBeenCalled();
    expect(t.queryByTestId('metre-serit')).toBeNull();
  });
});

describe('BT bağlı sayaç', () => {
  it('RESETTING: 1 dokunuşla (≤2) meterOut gider; sıfırlama kalıcı yazımdan SONRA', async () => {
    mockRead.mockResolvedValueOnce({ ok: true, value: 42.5 }).mockResolvedValueOnce({ ok: false, reason: 'READ_FAILED', message: 'x', noValue: true });
    const t = setup(summary('OUT'), device());
    await t.press('gramaj-tap-50GR');
    expect(t.presses()).toBeLessThanOrEqual(2);
    const vars = t.complete.mock.calls[0][0] as CompleteQc2Request;
    expect(vars.meterOut).toEqual({ meters: 42.5, source: 'MACHINE', peripheralId: 'per-1', rawCounter: 42.5, clientToken: expect.any(String) });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith('R\r', 'ascii');
    expect(order).toEqual(['persist', 'write']);
    expect(Toast.show).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(t.getByTestId('metre-kaynak')).toHaveTextContent('SAYAÇ');
  });

  it('kuyruğa kalıcı yazım kanıtlanamazsa sıfırlama YOK', async () => {
    mockPersist.mockResolvedValue(false);
    mockRead.mockResolvedValue({ ok: true, value: 42.5 });
    const t = setup(summary('OUT'), device());
    await t.press('gramaj-tap-50GR');
    await waitFor(() => expect(mockPersist).toHaveBeenCalled());
    expect(write).not.toHaveBeenCalled();
    expect(t.complete).toHaveBeenCalledTimes(1);
  });

  it('CUMULATIVE: başlangıç 1402, okuma 1500 → 98 m, rawCounter 1500, sıfırlama yok', async () => {
    await counterBaselineStore.set('per-1', 1402);
    mockRead.mockResolvedValue({ ok: true, value: 1500 });
    const t = setup(summary('OUT'), device({ counterMode: 'CUMULATIVE' }));
    await t.press('gramaj-tap-50GR');
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut).toMatchObject({ meters: 98, rawCounter: 1500 });
    expect(await counterBaselineStore.get('per-1')).toBe(1500);
    expect(write).not.toHaveBeenCalled();
  });

  it('SİMÜLASYON: toast + source SIMULATED, cihaz okunmaz', async () => {
    const t = setup(summary('OUT'), device({ simulate: true }));
    await t.press('gramaj-tap-50GR');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'SİMÜLASYON' }));
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut?.source).toBe('SIMULATED');
    expect(mockRead).not.toHaveBeenCalled();
    expect(t.getByTestId('metre-kaynak')).toHaveTextContent('SİMÜLASYON');
  });
});

describe('elle giriş', () => {
  it('sayaç yokken ≤3 dokunuş: gramaj → metre → Kaydet; source OPERATOR', async () => {
    const t = setup(summary('OUT'), null);
    await t.press('gramaj-tap-50GR');
    expect(t.complete).not.toHaveBeenCalled();
    await t.press('metre-elle-giris');
    await act(async () => fireEvent.changeText(t.getByTestId('metre-elle-giris'), '123,5'));
    await t.press('metre-elle-kaydet');
    expect(t.presses()).toBeLessThanOrEqual(3);
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut).toMatchObject({ meters: 123.5, source: 'OPERATOR', rawCounter: null });
  });
});

describe('sapma onayı', () => {
  it('OPERATOR_REASON: modal açıkken write 0; sebepsiz kuyruğa girmez; sebeple ack gider', async () => {
    mockRead.mockResolvedValue({ ok: true, value: 80 });
    const t = setup(summary('OUT', 'OPERATOR_REASON', 5), device());
    await t.press('gramaj-tap-50GR');
    expect(t.getByTestId('metre-sebep-kaydet')).toBeDisabled();
    await t.press('metre-sebep-kaydet');
    expect(t.complete).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await t.press('metre-sebep-vazgec');
    expect(t.complete).not.toHaveBeenCalled();

    await t.press('gramaj-tap-50GR');
    await t.press('metre-sebep-KUMAS_CEKTI');
    expect(write).not.toHaveBeenCalled();
    await t.press('metre-sebep-kaydet');
    expect((t.complete.mock.calls[0][0] as CompleteQc2Request).meterOut?.ack).toEqual({ reasonCode: 'KUMAS_CEKTI', reasonText: null });
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
});

function PinHarness() {
  const qc = useQueryClient();
  useState(() => {
    qc.setMutationDefaults(STATION_MUT.QC2_COMPLETE, { mutationFn: () => new Promise(() => undefined), networkMode: 'online', retry: false });
    return true;
  });
  const acks = useMeterAcks();
  const meter = useMeterCapture({ summary: summary('OUT', 'SUPERVISOR_PIN', 5), peripheral: null, acks });
  const m = useMutation<unknown, Error, CompleteQc2Request>({ mutationKey: STATION_MUT.QC2_COMPLETE });
  return (
    <>
      <MeterStrip meter={meter} acks={acks} roll={ROLL} stepId="step-1" />
      <GramajTapPanel
        state={useGramajTap({
          cfg: composeStationPanels({ inspectionEnabled: false, properties: summary('OUT').properties ?? [] }).tap,
          summary: summary('OUT'),
          roll: ROLL,
          operator: 'A',
          complete: (vars) => m.mutate(vars),
          refresh: jest.fn(),
          meter,
        })}
        hasRoll
      />
      <MeterModals meter={meter} acks={acks} rolls={[ROLL]} />
      <TestDump onDump={(j) => (dumped.json = j)} onAck={() => acks.onUnacked([{ readingId: 'rd-1', rollId: 'roll-1', approvalMode: 'SUPERVISOR_PIN' }])} />
    </>
  );
}

const dumped = { json: '' };
function TestDump({ onDump, onAck }: { onDump: (j: string) => void; onAck: () => void }) {
  const qc = useQueryClient();
  return (
    <>
      <GramajTapPanelButton testID="dump" onPress={() => onDump(JSON.stringify(dehydrate(qc, PERSIST_DEHYDRATE_OPTIONS)))} />
      <GramajTapPanelButton testID="unacked" onPress={onAck} />
    </>
  );
}
function GramajTapPanelButton({ testID, onPress }: { testID: string; onPress: () => void }) {
  const { Button } = jest.requireActual('react-native-paper');
  return <Button testID={testID} onPress={onPress}>x</Button>;
}

describe('SUPERVISOR_PIN', () => {
  it('çevrimdışı kuyruk ve kalıcı depo JSON\'unda PIN yok; PIN yalnız çevrimiçi POST gövdesinde', async () => {
    (kursunQcService.pinAckMeterReading as jest.Mock).mockResolvedValue({ success: true });
    onlineManager.setOnline(false);
    const t = renderWithPaper(<PinHarness />);
    await act(async () => fireEvent.press(t.getByTestId('gramaj-tap-50GR')));
    await act(async () => fireEvent.changeText(t.getByTestId('metre-elle-giris'), '80'));
    await act(async () => fireEvent.press(t.getByTestId('metre-elle-kaydet')));
    await act(async () => fireEvent.press(t.getByTestId('unacked')));
    // Çevrimdışı: PIN modalı açılmaz (onay bekler).
    expect(t.queryByTestId('metre-pin-giris')).toBeNull();
    expect(t.getByTestId('metre-pin-bekliyor')).toBeTruthy();

    onlineManager.setOnline(true);
    await act(async () => fireEvent.press(t.getByTestId('metre-pin-ac')));
    await act(async () => fireEvent.changeText(t.getByTestId('metre-pin-giris'), '987654'));
    await act(async () => fireEvent.press(t.getByTestId('metre-pin-onayla')));
    expect(kursunQcService.pinAckMeterReading).toHaveBeenCalledWith('rd-1', '987654');

    onlineManager.setOnline(false);
    await act(async () => fireEvent.press(t.getByTestId('dump')));
    expect(dumped.json).toContain('"meterOut"');
    expect(dumped.json).not.toContain('987654');
    expect(dumped.json).not.toContain('"pin"');
    const stored = JSON.stringify(await AsyncStorage.multiGet(await AsyncStorage.getAllKeys()));
    expect(stored).not.toContain('987654');
  });
});
