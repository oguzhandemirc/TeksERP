// =============================================================================
// Bekçi: "Bas" audit izi TOPUN kimliğine gider, `null`a değil
// =============================================================================
// Saha izi (fabrika log'u 2026-09-04): `POST /api/labels/rolls/null/print` → 400.
// Sebep: `handlePrint` önce `onPrint(payload)` çağırıyordu, parent o sırada
// sheet'i kapatıp `rollId`yi null'a çekiyordu; `printMut.mutate()` gövdesi ise
// BİR SONRAKİ render'ın kapanışıyla koşuyor ve `rollId!` "null" stringine
// dönüşüyordu. Baskı çalışıyor ama LABEL_PRINTED audit'i HİÇ DÜŞMÜYORDU —
// sessiz kayıp: kimse "etiket basılmadı" diye şikâyet etmez.
//
// Bu bekçi tam o sırayı kurar: onPrint içinde rollId null'lanır ve audit
// çağrısının GERÇEK kimliği taşıdığı doğrulanır. "Müşterisiz (Stok)" yolu
// aynı hatayı taşıyordu, o da ölçülür.
// =============================================================================
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SimplePortalHost } from '../SimplePortal';
// ⚠️ Bu import mock'lardan ÖNCE durur (import/first); babel `jest.mock`ları zaten
// import'ların üstüne kaldırır, yani mock'lar yine geçerli.
import { LabelPreviewSheet } from './LabelPreviewSheet';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 1, Warning: 2, Error: 3 },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

// `mock` ön eki zorunlu: jest.mock fabrikası kapsam dışı değişkene ancak böyle erişir.
const mockRecordPrintEvent = jest.fn(() => Promise.resolve({ success: true, data: null }));
jest.mock('../../services/label.service', () => ({
  labelService: {
    getRollLabel: jest.fn(() =>
      Promise.resolve({
        success: true,
        data: {
          rollId: 'ROLL-1',
          barcode: 'B1',
          status: 'WAREHOUSE',
          qualityGrade: 'A',
          widthCm: 150,
          lengthMeters: 42.5,
          weightKg: 12.25,
          packagingDate: null,
          itemCode: 'ITM-1',
          itemName: 'Kumaş',
          itemNameDefault: 'Kumaş',
          itemNameSource: 'DEFAULT',
          colorCode: 'C1',
          colorName: 'Mavi',
          colorNameDefault: 'Mavi',
          colorNameSource: 'DEFAULT',
          customerName: null,
          customerId: null,
          orderNumber: null,
          orderLineId: 'LINE-1',
          batchNumber: null,
          printedAt: '2026-09-10T00:00:00.000Z',
        },
      }),
    ),
    recordPrintEvent: (...a: unknown[]) => mockRecordPrintEvent(...(a as [])),
    updateOrderLineCustomerNames: jest.fn(),
  },
}));
jest.mock('../../hooks/usePermission', () => ({
  usePermissions: () => ({ has: () => true }),
}));

// jest-expo ortamında window.dispatchEvent yok; React'in hata raporlayıcısı ona
// dokunup GERÇEK hatayı maskeliyor. Tek satırlık köprü, asıl yığını görünür kılar.
if (typeof (globalThis as { window?: { dispatchEvent?: unknown } }).window?.dispatchEvent !== 'function') {
  (globalThis as unknown as { window: { dispatchEvent: () => boolean } }).window.dispatchEvent = () => true;
}

const GERCEK_ID = 'ROLL-1';

function Harness({ butonAdi }: { butonAdi: 'Bas' | 'Müşterisiz (Stok)' }): React.ReactElement {
  // Parent'ın SAHADAKİ davranışı (TamburScreen.tsx): callback içinde sheet kapanır
  // → rollId null olur. Hata tam bu sırada doğuyordu.
  const [rollId, setRollId] = React.useState<string | null>(GERCEK_ID);
  const kapat = (): void => setRollId(null);
  return (
    <LabelPreviewSheet
      visible={rollId !== null}
      rollId={rollId}
      onDismiss={kapat}
      onPrint={butonAdi === 'Bas' ? kapat : undefined}
      onPrintStock={butonAdi === 'Müşterisiz (Stok)' ? kapat : undefined}
    />
  );
}

function ciz(butonAdi: 'Bas' | 'Müşterisiz (Stok)'): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <PaperProvider>
        <QueryClientProvider client={qc}>
          <Harness butonAdi={butonAdi} />
          {/* App.tsx'teki kök modal katmanının test karşılığı — host yoksa
              AppModal hiçbir yerde çizilmez ve bekçi sessizce boşa düşer. */}
          <SimplePortalHost />
        </QueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>,
  );
}

describe('LabelPreviewSheet — audit izi kimliği', () => {
  beforeEach(() => mockRecordPrintEvent.mockClear());

  it('"Bas": sheet kapanırken bile audit GERÇEK rollId ile atılır', async () => {
    const r = ciz('Bas');
    const btn = await r.findByText('Bas');
    fireEvent.press(btn);
    await waitFor(() => expect(mockRecordPrintEvent).toHaveBeenCalled());
    const [gonderilenId] = mockRecordPrintEvent.mock.calls[0] as unknown as [string];
    expect(gonderilenId).toBe(GERCEK_ID);
    // Regresyon tam olarak buydu: URL'ye "null" yazılıyordu.
    expect(String(gonderilenId)).not.toBe('null');
  });

  it('"Müşterisiz (Stok)": aynı sıra, aynı güvence', async () => {
    const r = ciz('Müşterisiz (Stok)');
    const btn = await r.findByText('Müşterisiz (Stok)');
    fireEvent.press(btn);
    await waitFor(() => expect(mockRecordPrintEvent).toHaveBeenCalled());
    const [gonderilenId, ctx] = mockRecordPrintEvent.mock.calls[0] as unknown as [string, { stock?: boolean }];
    expect(gonderilenId).toBe(GERCEK_ID);
    expect(ctx?.stock).toBe(true);
  });
});
