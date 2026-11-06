// Bekçi: tablet bekleyen sevkiyat iptali — yıkıcı işlem önizlemesi HER birimi ve topu
// listeler, nereye döneceğini söyler; sunucu "iptal edilemez" derse düğme kapalı.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
// eslint-disable-next-line import/first
import { renderWithPaper } from '../../../test/render';
// eslint-disable-next-line import/first
import ShipmentCancelModal from './ShipmentCancelModal';

const SHIP = { id: 's1', shipmentNo: 'SVK-1', customer: { id: 'c', name: 'Gülkesim' }, branch: null } as never;
const preview = (over: Record<string, unknown> = {}) => ({
  data: {
    success: true,
    data: {
      shipmentId: 's1', shipmentNo: 'SVK-1', status: 'PLANNED', customerName: 'Gülkesim', branchName: null,
      canCancel: true, reason: null, sackCount: 2, rollCount: 3, swatchCount: 0, affectedOrders: [],
      units: [
        { id: 'u1', sackNo: 'CV1', unitKind: 'BULK', unitLabel: null, returnsTo: 'SHELF', rolls: [{ id: 'r1', barcode: 'T-1', qty: 10 }, { id: 'r2', barcode: 'T-2', qty: 5 }] },
        { id: 'u2', sackNo: 'CV2', unitKind: 'SACK', unitLabel: null, returnsTo: 'SACK_POOL', rolls: [{ id: 'r3', barcode: 'T-3', qty: 7 }] },
      ],
      ...over,
    },
  },
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('ShipmentCancelModal', () => {
  it('her birim + top + dönüş yeri listelenir; onayla iptal ucu çağrılır', async () => {
    mockGet.mockResolvedValue(preview());
    mockPost.mockResolvedValue({ data: { success: true, data: { shipmentId: 's1', freedSacks: 1 } } });
    const onDone = jest.fn();
    renderWithPaper(<ShipmentCancelModal shipment={SHIP} onDismiss={jest.fn()} onDone={onDone} />);
    expect(await screen.findByText('Dökme')).toBeTruthy();
    expect(screen.getByText('2 top · Toplar rafa döner')).toBeTruthy();
    expect(screen.getByText('1 top · Çuval depoya (havuza) döner')).toBeTruthy();
    expect(screen.getByText('T-1 · T-2')).toBeTruthy();
    expect(String(mockGet.mock.calls[0][0])).toBe('/shipping/shipments/s1/cancel-preview');
    fireEvent.press(screen.getByTestId('sevk-iptal-onay'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(String(mockPost.mock.calls[0][0])).toBe('/shipping/shipments/s1/cancel');
  });

  it('sunucu iptal edilemez derse sebep görünür, düğme kapalı', async () => {
    mockGet.mockResolvedValue(preview({ canCancel: false, reason: 'e-İrsaliye gönderilmiş' }));
    renderWithPaper(<ShipmentCancelModal shipment={SHIP} onDismiss={jest.fn()} onDone={jest.fn()} />);
    expect(await screen.findByText('e-İrsaliye gönderilmiş')).toBeTruthy();
    fireEvent.press(screen.getByTestId('sevk-iptal-onay'));
    await new Promise((r) => setTimeout(r, 30)); // mutasyon mikro-görevleri aksın
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('çevrimdışı (sorgu duraklar): modal sessiz kalmaz, sebep + yeniden dene görünür', async () => {
    onlineManager.setOnline(false);
    try {
      mockGet.mockResolvedValue(preview());
      renderWithPaper(<ShipmentCancelModal shipment={SHIP} onDismiss={jest.fn()} onDone={jest.fn()} />);
      expect(await screen.findByTestId('sevk-iptal-onizleme-sorun')).toHaveTextContent(/Çevrimdışısınız/);
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
