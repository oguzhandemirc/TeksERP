// El terminali D2: donanım modunda BarcodeScannerModal kamerayı BAĞLAMAZ, tuş okuması onScan'e düşer.
import React from 'react';
import { act } from '@testing-library/react-native';

import { renderWithPaper } from '../test/render';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { __resetScanBusForTests, emitScan } from '../services/hardwareScanner/scanBus';
import * as capabilities from '../services/hardwareScanner/capabilities';
import { pointMobileAdapter } from '../services/hardwareScanner/adapters';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import ScannerEntryBar from './ScannerEntryBar';
import AppModal from './AppModal';
import { Text } from 'react-native';

jest.mock('./BarcodeScannerView', () => {
  const { Text } = jest.requireActual('react-native');
  return { BarcodeScannerView: () => <Text testID="camera-view">kamera</Text> };
});

const pm68: capabilities.DeviceScanCapabilities = {
  caps: { manufacturer: 'POINTMOBILE', brand: 'POINTMOBILE', model: 'PM68', sdkInt: 35, packages: {}, sharedLibraries: [] },
  nativeAvailable: true,
  adapter: pointMobileAdapter,
  scannerVendor: true,
  forcedWedge: false,
};

const scan = (data: string) => act(() => void emitScan({ data, symbology: 'EAN-13', source: 'pointmobile' }));

beforeEach(() => {
  __resetScanBusForTests();
  useDeviceSettingsStore.setState({ scanMethod: 'auto', hardwareLink: 'auto', manualBarcodeEntry: false });
  jest.spyOn(capabilities, 'readScanCapabilities').mockReturnValue(pm68);
});
afterEach(() => jest.restoreAllMocks());

it('açık modal: kamera yerine donanım paneli, tuş okuması onScan alır', () => {
  const onScan = jest.fn();
  const r = renderWithPaper(<BarcodeScannerModal visible onDismiss={() => {}} onScan={onScan} title="Top Okut" />);
  expect(r.queryByTestId('camera-view')).toBeNull();
  expect(r.getByTestId('hardware-scan-panel')).toBeTruthy();
  scan('TOP-1');
  expect(onScan).toHaveBeenCalledWith('TOP-1');
});

it('kapalı modal: listenWhileHidden yoksa okuma almaz, varsa alır', () => {
  const onScan = jest.fn();
  const r = renderWithPaper(<BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} />);
  let out: string | undefined;
  act(() => {
    out = emitScan({ data: 'TOP-2', symbology: null, source: 'pointmobile' });
  });
  expect(out).toBe('no-target');
  r.rerender(<BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} listenWhileHidden />);
  scan('TOP-3');
  expect(onScan).toHaveBeenCalledWith('TOP-3');
});

it('Kamera seçiliyse donanım hedefi kurulmaz, kamera görünür', () => {
  useDeviceSettingsStore.setState({ scanMethod: 'camera' });
  const onScan = jest.fn();
  const r = renderWithPaper(<BarcodeScannerModal visible onDismiss={() => {}} onScan={onScan} listenWhileHidden />);
  expect(r.getByTestId('camera-view')).toBeTruthy();
  scan('TOP-4');
  expect(onScan).not.toHaveBeenCalled();
});

it('ScannerEntryBar donanımda: ekran dinliyorsa CTA yerine tuş bandı, dinlemiyorsa "Okuyucu ile Okut"', () => {
  const r = renderWithPaper(<ScannerEntryBar value="" onChangeText={() => {}} onScan={() => {}} hardwareListening />);
  expect(r.getByTestId('hardware-trigger-hint')).toBeTruthy();
  expect(r.queryByText('Kamera ile Okut')).toBeNull();
  r.rerender(<ScannerEntryBar value="" onChangeText={() => {}} onScan={() => {}} />);
  expect(r.getByText('Okuyucu ile Okut')).toBeTruthy();
});

it('kapalıyken gelen okumada işleyici bitince onModalHide çağrılır ("kapanınca işle" deseni)', async () => {
  const order: string[] = [];
  const onScan = jest.fn(async (b: string) => {
    await Promise.resolve();
    order.push(`scan:${b}`);
  });
  const onModalHide = jest.fn(() => order.push('hide'));
  renderWithPaper(
    <BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} onModalHide={onModalHide} listenWhileHidden />,
  );
  await act(async () => {
    emitScan({ data: 'TOP-5', symbology: null, source: 'pointmobile' });
  });
  // AppModal ilk bağlanışta da onHidden verebilir; sözleşme: okuma işlendikten SONRA bir kez daha.
  expect(order.slice(-2)).toEqual(['scan:TOP-5', 'hide']);
});

it('üstte açık AppModal varken kapalı tarayıcının dinleyicisi örtülür; yan panel (scanPassThrough) örtmez', () => {
  const onScan = jest.fn();
  const screen = (dialog: boolean, passThrough = false) => (
    <>
      <BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} listenWhileHidden />
      <AppModal visible={dialog} onDismiss={() => {}} scanPassThrough={passThrough}>
        <Text>Onay</Text>
      </AppModal>
    </>
  );
  const r = renderWithPaper(screen(true));
  let out: string | undefined;
  act(() => {
    out = emitScan({ data: 'TOP-5', symbology: null, source: 'pointmobile' });
  });
  expect(out).toBe('covered');
  expect(onScan).not.toHaveBeenCalled();
  r.rerender(screen(true, true));
  scan('TOP-6');
  r.rerender(screen(false));
  scan('TOP-7');
  expect(onScan.mock.calls.map((c) => c[0])).toEqual(['TOP-6', 'TOP-7']);
});

it('açık tarayıcı kendi penceresinin işaretiyle örtülmez', () => {
  const onScan = jest.fn();
  const r = renderWithPaper(<BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} listenWhileHidden />);
  r.rerender(<BarcodeScannerModal visible onDismiss={() => {}} onScan={onScan} listenWhileHidden />);
  scan('TOP-8');
  expect(onScan).toHaveBeenCalledWith('TOP-8');
});

it('sheet İÇİNDEKİ kapalı tarayıcı kendi sheet\'i açıkken dinler; sheet içinde açılan ikinci pencere onu örter', async () => {
  const onScan = jest.fn();
  const sheet = (inner: boolean) => (
    <AppModal visible onDismiss={() => {}}>
      <BarcodeScannerModal visible={false} onDismiss={() => {}} onScan={onScan} listenWhileHidden />
      <AppModal visible={inner} onDismiss={() => {}}>
        <Text>Seçici</Text>
      </AppModal>
    </AppModal>
  );
  const r = renderWithPaper(sheet(false));
  await act(async () => {
    await Promise.resolve();
  });
  scan('TOP-9');
  expect(onScan).toHaveBeenCalledWith('TOP-9');
  r.rerender(sheet(true));
  await act(async () => {
    await Promise.resolve();
  });
  let out: string | undefined;
  act(() => {
    out = emitScan({ data: 'TOP-10', symbology: null, source: 'pointmobile' });
  });
  expect(out).toBe('covered');
});
