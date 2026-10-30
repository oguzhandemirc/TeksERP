// =============================================================================
// Bekçi: LabelPrinter basım sonucunu Yazdırma geçmişine raporlar (izlenebilirlik A4)
// =============================================================================
// Sahte BT taşıması: bağlantı hatası → kuyruğa HATA (cihaz adı + MAC + BT_BAGLANTI), iş ucu
// çağrılmaz; başarı → iş ucuna `printJob` eki, `/print-jobs` raporu YOK (çift satır olmasın).
// NEGATİF SONDALAR (2026-10-25, md5 ile geri alındı): ① `step = 'send'` silindi ⇒ 1 kırmızı
// (kod BT_ESLESME'de kaldı) · ② catch'teki `reportPrintOutcome` çağrısı etkisizleştirildi ⇒ 2 kırmızı.
// =============================================================================
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { LabelPrinter } from './LabelPrinter';
import { labelService } from '../services/label.service';
import { printRaw, ensurePrinterPaired } from '../services/btPrinter.service';
import { __resetPrintReportsForTests, usePrintReports } from '../services/printJob.service';
import type { Roll } from '../types/models';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../services/printHtml', () => ({ printHtml: jest.fn(async () => undefined) }));
jest.mock('../services/api', () => ({ apiClient: { get: jest.fn(), post: jest.fn(async () => ({ data: {} })) } }));
jest.mock('../hooks/useFeatureFlags', () => ({ useMobileRasterEnabled: () => false }));
jest.mock('../services/label.service', () => ({
  labelService: {
    seedSnapshot: jest.fn(async () => ({})),
    recordPrintEvent: jest.fn(async () => ({})),
    getRollNative: jest.fn(async () => ({ language: 'PPLB', content: 'N\nP1\n', encoding: 'text' })),
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
jest.mock('./customerCode/useCustomerCodeMissingExit', () => ({ useCustomerCodeMissingExit: () => ({ offer: () => false, sheet: null }) }));
jest.mock('../store/sessionStore', () => ({ useSessionStore: { getState: () => ({ active: { id: 's1' } }) } }));

const roll = { id: '55555555-5555-4555-8555-555555555555', barcode: 'T000123' } as Roll;

beforeEach(() => {
  jest.clearAllMocks();
  __resetPrintReportsForTests();
  onlineManager.setOnline(false); // rapor kuyrukta kalsın, içeriği ölçülsün
});

it('BT bağlantı hatası → HATA raporu: cihaz adı + MAC + BT_BAGLANTI; iş ucu çağrılmaz', async () => {
  (printRaw as jest.Mock).mockRejectedValueOnce(new Error('Yazıcıya bağlanılamadı'));
  const onDone = jest.fn();
  render(<LabelPrinter roll={roll} kind="ROLL_RAW" onDone={onDone} />);
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const items = usePrintReports.getState().items;
  expect(items).toHaveLength(1);
  expect(items[0]!.body).toMatchObject({
    subjectKind: 'ETIKET_TOP',
    subjectTable: 'rolls',
    subjectId: roll.id,
    subjectNo: 'T000123',
    status: 'HATA',
    errorCode: 'BT_BAGLANTI',
    errorMessage: 'Yazıcıya bağlanılamadı',
    transport: 'BLUETOOTH',
    printerName: 'KK1 Etiket',
    printerAddress: '00:11:22:33:44:55',
    peripheralId: '44444444-4444-4444-8444-444444444444',
  });
  expect(labelService.recordPrintEvent).not.toHaveBeenCalled();
});

it('eşleşme hatası → BT_ESLESME', async () => {
  (ensurePrinterPaired as jest.Mock).mockRejectedValueOnce(new Error('Eşleşme reddedildi'));
  const onDone = jest.fn();
  render(<LabelPrinter roll={roll} kind="ROLL_RAW" onDone={onDone} />);
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(usePrintReports.getState().items[0]!.body.errorCode).toBe('BT_ESLESME');
});

it('başarı → iş ucuna printJob eki; /print-jobs raporu yok', async () => {
  const onDone = jest.fn();
  render(<LabelPrinter roll={roll} kind="ROLL_RAW" onDone={onDone} />);
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(usePrintReports.getState().items).toHaveLength(0);
  const call = (labelService.recordPrintEvent as jest.Mock).mock.calls[0];
  expect(call[0]).toBe(roll.id);
  expect(call[2]).toMatchObject({ transport: 'BLUETOOTH', printerAddress: '00:11:22:33:44:55', printerName: 'KK1 Etiket' });
  expect(call[2].clientToken).toMatch(/^[0-9a-f-]{36}$/);
});
