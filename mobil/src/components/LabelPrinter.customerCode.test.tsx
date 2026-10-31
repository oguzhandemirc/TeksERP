// =============================================================================
// Bekçi: baskı BLOCK (400 CUSTOMER_CODE_MISSING, D4-F3 / DALGA4 §7.5-4) → okut-bağla çıkışı önerilir;
// başka hata ve iptal öneri açmaz.
// =============================================================================
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { LabelPrinter } from './LabelPrinter';
import { labelService } from '../services/label.service';
import { __resetPrintReportsForTests } from '../services/printJob.service';
import { isCustomerCodeMissing } from './customerCode/customerCodeLogic';
import type { Roll } from '../types/models';

const mockOffer = jest.fn((err: unknown, _roll: unknown) => isCustomerCodeMissing(err));
jest.mock('./customerCode/useCustomerCodeMissingExit', () => ({
  useCustomerCodeMissingExit: () => ({ offer: (e: unknown, r: unknown) => mockOffer(e, r), sheet: null }),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/printHtml', () => ({ printHtml: jest.fn(async () => undefined) }));
jest.mock('../services/api', () => ({ apiClient: { get: jest.fn(), post: jest.fn(async () => ({ data: {} })) } }));
jest.mock('../hooks/useFeatureFlags', () => ({ useMobileRasterEnabled: () => false }));
jest.mock('../services/label.service', () => ({
  labelService: {
    seedSnapshot: jest.fn(async () => ({})),
    recordPrintEvent: jest.fn(async () => ({})),
    getRollNative: jest.fn(),
  },
}));
jest.mock('../services/peripheral.service', () => ({
  peripheralService: {
    getForSession: jest.fn(async () => [
      { id: '44444444-4444-4444-8444-444444444444', name: 'KK1 Etiket', connectionType: 'BLUETOOTH_SPP', address: '00:11:22:33:44:55', simulate: false },
    ]),
  },
}));
jest.mock('../services/btPrinter.service', () => ({
  isBtPrinterSupported: () => true,
  ensurePrinterPaired: jest.fn(async () => undefined),
  printRaw: jest.fn(async () => undefined),
  printRawBytes: jest.fn(async () => undefined),
}));
jest.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => ({ active: { id: 's1' } }) } }));

const roll = { id: '55555555-5555-4555-8555-555555555555', barcode: 'T000123', ownerCustomerId: 'c1' } as Roll;

beforeEach(() => {
  jest.clearAllMocks();
  __resetPrintReportsForTests();
  onlineManager.setOnline(false);
});

it('400 CUSTOMER_CODE_MISSING → okut-bağla çıkışı bu topla önerilir', async () => {
  const err = Object.assign(new Error('Bu topa müşteri barkodu bağlanmamış'), { status: 400, details: { code: 'CUSTOMER_CODE_MISSING' } });
  (labelService.getRollNative as jest.Mock).mockRejectedValueOnce(err);
  const onDone = jest.fn();
  render(<LabelPrinter roll={roll} kind="ROLL_FINISHED" onDone={onDone} />);
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(mockOffer).toHaveBeenCalledWith(err, roll);
  expect(mockOffer.mock.results[0]!.value).toBe(true);
});

it('başka 400 → öneri açılmaz', async () => {
  const err = Object.assign(new Error('Şablon yok'), { status: 400, details: {} });
  (labelService.getRollNative as jest.Mock).mockRejectedValueOnce(err);
  const onDone = jest.fn();
  render(<LabelPrinter roll={roll} kind="ROLL_FINISHED" onDone={onDone} />);
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(mockOffer.mock.results.every((r) => r.value === false)).toBe(true);
});
