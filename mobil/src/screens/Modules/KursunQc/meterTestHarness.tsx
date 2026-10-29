// =============================================================================
// H3 sayaç bekçilerinin ortak düzeneği (yalnız jest'ten içe aktarılır)
// =============================================================================
// Çağıran test dosyası usePeripheralIO, offline/mutations (persistStationQueueNow),
// kursunQc.service ve toast modüllerini jest.mock ile taklit eder; burada o taklitler kullanılır.
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderWithPaper } from '../../../test/render';
import { persistStationQueueNow } from '../../../offline/mutations';
import { buildIoFromPeripheral, readMeter } from '../../../hooks/usePeripheralIO';
import type { DevicePeripheral } from '../../../services/peripheral.service';
import type { KursunStepSummary } from '../../../types/models';
import GramajTapPanel from './GramajTapPanel';
import MeterModals from './MeterModals';
import MeterStrip from './MeterStrip';
import { composeStationPanels } from './stationPanels';
import { useGramajTap } from './useGramajTap';
import { useMeterAcks } from './useMeterAcks';
import { useMeterCapture } from './useMeterCapture';

export const mockRead = readMeter as jest.Mock;
const mockIo = buildIoFromPeripheral as jest.Mock;
export const mockPersist = persistStationQueueNow as jest.Mock;
export const order: string[] = [];
export const write = jest.fn(async () => {
  order.push('write');
});

export type Capture = 'OFF' | 'OUT' | 'IN_OUT';
export type Approval = 'NONE' | 'OPERATOR_REASON' | 'SUPERVISOR_PIN' | 'OFFICE';

export function summary(capture: Capture | null, approval: Approval = 'NONE', thresholdM: number | null = null): KursunStepSummary {
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

export const ROLL = { rollId: 'roll-1', barcode: 'T000123456', currentQty: 100, meter: { declaredIn: 100, measuredIn: null } };

export function device(over: Partial<DevicePeripheral> = {}): DevicePeripheral {
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
      // Mock bir hata döndürürse sunucu reddi taklit edilir (ekrandaki onError yolu).
      const err: unknown = p.complete(vars);
      if (err) meter.onCompleteError(vars, err);
      else opts.onSuccess?.();
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

export function setup(s: KursunStepSummary, peripheral: DevicePeripheral | null) {
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


/** Her testten önce: taklitler temiz, kalıcı depo boş, kalıcı yazım başarılı, çevrimiçi. */
export async function resetMeterMocks(): Promise<void> {
  jest.clearAllMocks();
  order.length = 0;
  await AsyncStorage.clear();
  mockIo.mockReturnValue({ transport: { write, read: jest.fn(), test: jest.fn() }, codec: {}, supported: true });
  mockPersist.mockImplementation(async () => {
    order.push('persist');
    return true;
  });
  onlineManager.setOnline(true);
}
