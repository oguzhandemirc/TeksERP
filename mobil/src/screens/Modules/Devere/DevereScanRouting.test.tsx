// El terminali D3 — Levent Sarım: tezgah sekmesinde iki okutma bandı aynı anda görünür; tuşu YALNIZ etkin
// bant alır (sekme üst bileşende), ötekisi "tuşa basın" göstermez.
import React from 'react';
import { act } from '@testing-library/react-native';

import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { __resetScanBusForTests, emitScan } from '../../../services/hardwareScanner/scanBus';
import * as capabilities from '../../../services/hardwareScanner/capabilities';
import { pointMobileAdapter } from '../../../services/hardwareScanner/adapters';
import WindScanColumn from './WindScanColumn';
import MountedTab from './MountedTab';
import type { WindStationState } from './useWindStation';

jest.mock('../../../components/BarcodeScannerView', () => ({ BarcodeScannerView: () => null }));

const pm68: capabilities.DeviceScanCapabilities = {
  caps: { manufacturer: 'POINTMOBILE', brand: 'POINTMOBILE', model: 'PM68', sdkInt: 35, packages: {}, sharedLibraries: [] },
  nativeAvailable: true,
  adapter: pointMobileAdapter,
  scannerVendor: true,
  forcedWedge: false,
};

const station = (submitScan: jest.Mock) =>
  ({ scanValue: '', setScanValue: jest.fn(), scanMessage: null, submitScan }) as unknown as WindStationState;

const press = (data: string) => act(() => void emitScan({ data, symbology: 'CODE128', source: 'pointmobile' }));

beforeEach(() => {
  __resetScanBusForTests();
  useDeviceSettingsStore.setState({ scanMethod: 'auto', hardwareLink: 'auto', manualBarcodeEntry: false });
  jest.spyOn(capabilities, 'readScanCapabilities').mockReturnValue(pm68);
});
afterEach(() => jest.restoreAllMocks());

it('tezgah sekmesi: tuş levent-tak bandına gider, sar bandı tuş bandı çizmez', () => {
  const wind = jest.fn();
  const mount = jest.fn();
  const r = renderWithPaper(
    <>
      {/* Sıra kasıtlı: sar bandı SONRA bağlanır — dinleseydi LIFO'da üstte olur ve okumayı çalardı. */}
      <MountedTab beams={[]} loading={false} locked={false} onMount={() => {}} onScanBeam={mount} scanMessage={null} />
      <WindScanColumn station={station(wind)} listening={false} />
    </>,
  );
  expect(r.getAllByTestId('hardware-trigger-hint')).toHaveLength(1);
  press('LV-7');
  expect(mount).toHaveBeenCalledWith('LV-7');
  expect(wind).not.toHaveBeenCalled();
});

it('diğer sekmeler: tuş sar bandına gider', () => {
  const wind = jest.fn();
  const r = renderWithPaper(<WindScanColumn station={station(wind)} listening />);
  expect(r.getAllByTestId('hardware-trigger-hint')).toHaveLength(1);
  press('LV-8');
  expect(wind).toHaveBeenCalledWith('LV-8');
});

it('kilitli tezgah sekmesi (çevrimdışı) okuma almaz', () => {
  const mount = jest.fn();
  renderWithPaper(<MountedTab beams={[]} loading={false} locked onMount={() => {}} onScanBeam={mount} scanMessage={null} />);
  let out: string | undefined;
  act(() => {
    out = emitScan({ data: 'LV-9', symbology: null, source: 'pointmobile' });
  });
  expect(out).toBe('no-target');
  expect(mount).not.toHaveBeenCalled();
});
