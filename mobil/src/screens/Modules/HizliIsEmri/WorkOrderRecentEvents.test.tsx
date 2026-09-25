import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as PaperProvider } from 'react-native-paper';
import WorkOrderRecentEvents from './WorkOrderRecentEvents';

const mockGet = jest.fn();
jest.mock('../../../services/workOrder.service', () => ({
  workOrderService: { getRecentEvents: (...a: unknown[]) => mockGet(...a) },
}));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaperProvider>
        <WorkOrderRecentEvents workOrderId="wo-1" />
      </PaperProvider>
    </QueryClientProvider>,
  );
}

describe('WorkOrderRecentEvents', () => {
  beforeEach(() => mockGet.mockReset());

  it('son 5 hareketi ister ve satırı başlık · ayrıntı · kim · kanal ile basar', async () => {
    mockGet.mockResolvedValue([
      { id: 'woe:1', at: '2026-09-25T10:00:00.000Z', group: 'DURUM', title: 'Durum değişti', detail: 'Devam Ediyor → Tamamlandı',
        reason: 'kalan dağıtıldı', actor: 'Ayşe', channel: 'Tablet', trigger: 'Elle kapatma', derived: false },
    ]);
    renderIt();
    await waitFor(() => expect(screen.getByText('Durum değişti · Devam Ediyor → Tamamlandı')).toBeTruthy());
    expect(mockGet).toHaveBeenCalledWith('wo-1', 5);
    expect(screen.getByText('Ayşe · Tablet · Elle kapatma · Sebep: kalan dağıtıldı')).toBeTruthy();
  });

  it('hata "hareket yok" diye basılmaz', async () => {
    mockGet.mockRejectedValue(new Error('ağ'));
    renderIt();
    await waitFor(() => expect(screen.getByText(/yüklenemedi/)).toBeTruthy());
    expect(screen.queryByText('Kayıtlı hareket yok.')).toBeNull();
  });

  it('boş liste ayrı cümle', async () => {
    mockGet.mockResolvedValue([]);
    renderIt();
    await waitFor(() => expect(screen.getByText('Kayıtlı hareket yok.')).toBeTruthy());
  });
});
