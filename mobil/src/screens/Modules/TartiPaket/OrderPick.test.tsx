// Bekçi: tablette sipariş seçerek sevk — seçim yoksa siparişsiz (bugünkü davranış);
// onay kartı önizlemeyi sunucudan çeker ve seçilen siparişleri sevk çağrısına verir.
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../services/api', () => ({
  apiClient: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
// eslint-disable-next-line import/first
import { renderWithPaper } from '../../../test/render';
// eslint-disable-next-line import/first
import { ShipConfirmSheet, orderOptions, orderPickText } from './OrderPick';

const ORD = {
  order: { id: 'o1', orderNumber: 'SIP-7', status: 'OPEN', deadline: null, customer: { id: 'c', name: 'X' }, branch: null },
  lines: [{ openQty: 120.4 }, { openQty: 80 }],
} as never;

describe('sipariş seçimi — saf', () => {
  it('seçim yoksa siparişsiz; varsa numaralar', () => {
    expect(orderPickText([], [ORD])).toBe('Siparişsiz sevk');
    expect(orderPickText(['o1'], [ORD])).toBe('1 sipariş: SIP-7');
  });
  it('seçenek alt metni kalem sayısı + açık metre', () => {
    expect(orderOptions([ORD])[0]).toMatchObject({ id: 'o1', label: 'SIP-7', sublabel: '2 kalem · açık 200 m' });
  });
});

describe('ShipConfirmSheet', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({ data: { success: true, data: [ORD] } });
    mockPost.mockReset().mockResolvedValue({
      data: { success: true, data: { sacks: [], lines: [], warnings: ['Uyarı: sipariş bağı yok'], totals: { totalMeters: 300, sackCount: 2, surplusMeters: 300 } } },
    });
  });

  it('önizleme sunucudan; onay seçili siparişleri (boş) verir', async () => {
    const onConfirm = jest.fn();
    renderWithPaper(
      <ShipConfirmSheet visible onDismiss={jest.fn()} customerId="c" branchId={null} sackIds={['s1', 's2']} title="Sevk Et" submitting={false} onConfirm={onConfirm} />,
    );
    expect(await screen.findByText('2 çuval · 300 m')).toBeTruthy();
    expect(screen.getByText('Uyarı: sipariş bağı yok')).toBeTruthy();
    expect(screen.getByText('Siparişsiz sevk')).toBeTruthy();
    const [url, body] = mockPost.mock.calls[0] as [string, { sackIds: string[]; orderIds: string[] }];
    expect(url).toBe('/shipping/shipments/preview');
    expect(body.sackIds).toEqual(['s1', 's2']);
    fireEvent.press(screen.getByTestId('sevk-onay'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([]));
  });

  it('çevrimdışı (sorgu duraklar): önizleme yerine sebep görünür, sessiz boş kalmaz', async () => {
    onlineManager.setOnline(false);
    try {
      renderWithPaper(
        <ShipConfirmSheet visible onDismiss={jest.fn()} customerId="c" branchId={null} sackIds={['s1']} title="Sevk Et" submitting={false} onConfirm={jest.fn()} />,
      );
      expect(await screen.findByTestId('sevk-onizleme-sorun')).toHaveTextContent(/Çevrimdışısınız/);
      expect(mockPost).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
