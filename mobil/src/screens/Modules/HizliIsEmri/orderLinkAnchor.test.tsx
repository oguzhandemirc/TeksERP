// "Tek iş emri = tek renk/kumaş" çapası. Saha vakası (2026-11): BEYAZ seçildi, sihirbaz
// adımı değişip picker unmount olunca çapa kayboldu, EKRU da eklendi.
// Negatif sonda (2026-11-04): picker'a `picked` verilmeyip iç state'e dönülünce
// "remount sonrası çapa korunur" testi kırmızı (çip kaybolur, EKRU listelenir).
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, screen, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import type { AvailableOrderLine } from '../../../services/order.service';
import { addPicked, orderLineMismatch, prunePicked, selectedOf } from './orderLinkAnchor';
import OrderLinkPicker from './OrderLinkPicker';

const line = (over: Partial<AvailableOrderLine>): AvailableOrderLine =>
  ({
    lineId: 'l1', itemId: 'i1', orderId: 'o1', orderNumber: 'S-1', customerId: 'c1', customerName: 'Müşteri',
    branchName: null, itemCode: 'K1', itemName: 'Kumaş', customerItemName: null, colorId: 'beyaz', colorCode: null,
    colorName: 'BEYAZ', customerColorName: null, width: 300, quantity: 100, openQty: 100, ...over,
  }) as AvailableOrderLine;

const BYZ = line({});
const EKR = line({ lineId: 'l2', orderNumber: 'S-2', colorId: 'ekru', colorName: 'EKRU' });

const mockLines: AvailableOrderLine[] = [BYZ, EKR];
jest.mock('../../../services/order.service', () => ({
  orderService: {
    getAvailableOrderLinesCursor: async () => ({
      data: mockLines,
      pagination: { hasMore: false, nextCursor: null, totalEstimate: mockLines.length },
    }),
  },
}));

describe('orderLinkAnchor — saf kurallar', () => {
  it('çapa yoksa yalnız okutulan kumaş kısıtlar', () => {
    expect(orderLineMismatch(null, EKR, null)).toBeNull();
    expect(orderLineMismatch(null, EKR, 'i2')).toBe('farklı kumaş');
  });
  it('çapa varken farklı renk / kumaş / en reddedilir', () => {
    expect(orderLineMismatch(BYZ, EKR, null)).toBe('farklı renk');
    expect(orderLineMismatch(BYZ, line({ itemId: 'i2' }), null)).toBe('farklı kumaş');
    expect(orderLineMismatch(BYZ, line({ width: 280 }), null)).toBe('farklı en');
    expect(orderLineMismatch(BYZ, line({ lineId: 'l3', width: '300.000' as unknown as number }), null)).toBeNull();
  });
  it('ekle / buda / sıralı seçim; değişiklik yoksa aynı referans', () => {
    const m = addPicked(addPicked({}, BYZ), EKR);
    expect(selectedOf(['l2', 'l1'], m).map((l) => l.lineId)).toEqual(['l2', 'l1']);
    expect(Object.keys(prunePicked(m, ['l1']))).toEqual(['l1']);
    expect(prunePicked(m, ['l1', 'l2'])).toBe(m);
  });
});

describe('OrderLinkPicker — kontrollü çapa', () => {
  it('remount sonrası çapa korunur: çip görünür, farklı renkli kalem listelenmez', async () => {
    const picked = addPicked({}, BYZ);
    const props = { itemId: null, value: ['l1'], onChange: jest.fn(), picked, open: false, onOpenChange: jest.fn() };
    const first = renderWithPaper(<OrderLinkPicker {...props} />);
    expect(screen.getByText('S-1')).toBeTruthy();
    first.unmount();

    renderWithPaper(<OrderLinkPicker {...props} open />);
    expect(screen.getAllByText(/S-1/).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText(/Müşteri/).length).toBeGreaterThan(0));
    await act(async () => {});
    expect(screen.queryByText(/S-2/)).toBeNull();
  });
});

describe('Hızlı İş Emri — çapa hook içinde yaşar', () => {
  // Sihirbaz adımı değişince StepRolls (ve picker) unmount olur; çapa hook state'inde kalmalı.
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
  it('hook seçili kalemleri tutar: ekle / buda / sıfırla, dönüşte verir', () => {
    const hook = src('useQuickWorkOrder.ts');
    expect(hook).toMatch(/setPickedOrderLines\(\(cur\) => addPicked\(cur, line\)\)/);
    expect(hook).toMatch(/setPickedOrderLines\(\(cur\) => prunePicked\(cur, ids\)\)/);
    expect(hook).toMatch(/setPickedOrderLines\(\{\}\)/);
    expect(hook).toMatch(/^\s+pickedOrderLines,$/m);
  });
  it('StepRolls picker\'a kontrollü çapayı geçirir', () => {
    expect(src('wizard/StepRolls.tsx')).toMatch(/picked=\{wo\.pickedOrderLines\}/);
  });
});
