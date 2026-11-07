import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';

import { renderWithPaper } from '../../../test/render';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { __resetScanBusForTests, emitScan } from '../../../services/hardwareScanner/scanBus';
import * as capabilities from '../../../services/hardwareScanner/capabilities';
import { pointMobileAdapter } from '../../../services/hardwareScanner/adapters';
import ScanMethodCard, { describeDetected } from './ScanMethodCard';
import { scanMenuSummary } from '../../../services/hardwareScanner/resolveScanMethod';

jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));

const pm68: capabilities.DeviceScanCapabilities = {
  caps: { manufacturer: 'POINTMOBILE', brand: 'POINTMOBILE', model: 'PM68', sdkInt: 35, packages: {}, sharedLibraries: ['device.sdk'] },
  nativeAvailable: true,
  adapter: pointMobileAdapter,
  scannerVendor: true,
  forcedWedge: false,
};
const tablet: capabilities.DeviceScanCapabilities = {
  caps: { manufacturer: 'samsung', brand: 'samsung', model: 'SM-X200', sdkInt: 34, packages: {}, sharedLibraries: [] },
  nativeAvailable: true,
  adapter: null,
  scannerVendor: false,
  forcedWedge: false,
};

beforeEach(() => {
  __resetScanBusForTests();
  useDeviceSettingsStore.setState({ scanMethod: 'auto', hardwareLink: 'auto' });
});
afterEach(() => jest.restoreAllMocks());

it('PM68 Otomatik: algılanan okuyucu yazılır, deneme alanı okunan kodu + semboloji + kaynağı gösterir', () => {
  jest.spyOn(capabilities, 'readScanCapabilities').mockReturnValue(pm68);
  const r = renderWithPaper(<ScanMethodCard />);
  expect(r.getByTestId('scan-method-detected')).toHaveTextContent('Algılanan: Point Mobile PM68 — tepedeki okuyucu');
  expect(r.getByTestId('scan-open-settings')).toBeTruthy();
  act(() => {
    emitScan({ data: 't00123', symbology: 'QR Code', source: 'pointmobile' }, 5000);
  });
  expect(r.getByTestId('scan-try-code')).toHaveTextContent('T00123');
  expect(r.getByText('QR Code · Point Mobile · 1. okuma')).toBeTruthy();
});

it('Kamera seçilince donanım bölümleri gizlenir ve okuma deneme alanına gitmez', () => {
  jest.spyOn(capabilities, 'readScanCapabilities').mockReturnValue(pm68);
  const r = renderWithPaper(<ScanMethodCard />);
  fireEvent.press(r.getByTestId('scan-method-camera'));
  expect(useDeviceSettingsStore.getState().scanMethod).toBe('camera');
  expect(r.queryByTestId('scan-try-box')).toBeNull();
  expect(r.queryByTestId('scan-link-wedge')).toBeNull();
  expect(emitScan({ data: 'T1', source: 'pointmobile' }, 9000)).toBe('no-target');
});

it('okuyucusuz tablet Otomatik = kamera (bugünkü davranış); "Donanım okuyucu" seçilince klavye yolu', () => {
  jest.spyOn(capabilities, 'readScanCapabilities').mockReturnValue(tablet);
  const r = renderWithPaper(<ScanMethodCard />);
  expect(r.getByTestId('scan-method-detected')).toHaveTextContent(/okuyucu yok, kamera/);
  expect(r.queryByTestId('scan-try-box')).toBeNull();
  fireEvent.press(r.getByTestId('scan-method-hardware'));
  expect(r.getByTestId('scan-method-detected')).toHaveTextContent(/okuyucu \(klavye yolu\)/);
  expect(r.getByTestId('scan-try-box')).toBeTruthy();
});

it('describeDetected: wedge ve kamera dalları', () => {
  expect(describeDetected({ method: { kind: 'wedge' }, device: pm68, hardware: true })).toBe(
    'Point Mobile PM68 — okuyucu (klavye yolu)',
  );
  expect(describeDetected({ method: { kind: 'camera' }, device: pm68, hardware: false })).toBe(
    'Point Mobile PM68 — kamera seçili',
  );
});

it('scanMenuSummary: menü satırı yöntemi ve elle yazmayı özetler', () => {
  expect(scanMenuSummary('intent', false)).toBe('Donanım okuyucu');
  expect(scanMenuSummary('camera', true)).toBe('Kamera + elle yazma');
  expect(scanMenuSummary('wedge', false)).toBe('Okuyucu (klavye yolu)');
});
