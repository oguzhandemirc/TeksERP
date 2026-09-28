// =============================================================================
// Bekçi: Tambur "Bu müşteride hep" kaydı DOĞRU uca ve yalnız değişen alana yazar
// =============================================================================
// MUSTERI-KUMAS-RENK-ADI §7 (tablet 1.0.8 sızıntısı) + §12.6: kalıcı kayıt renk
// alanını koşulsuz genel ada yazıyordu. Saf plan `labelNameSave.test.ts`te
// ölçülür; burası bileşenin planı GERÇEKTEN kullandığını, yani ekrandan hangi
// servis çağrısının çıktığını ölçer.
// =============================================================================
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { LabelNamePreview } from './LabelNamePreview';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const mockPreview = jest.fn();
const mockSetItemAlias = jest.fn((..._a: unknown[]) => Promise.resolve({ success: true, data: null }));
const mockSetColorAlias = jest.fn((..._a: unknown[]) => Promise.resolve({ success: true, data: null }));
const mockSetItemColorAlias = jest.fn((..._a: unknown[]) => Promise.resolve({ success: true, data: null }));
jest.mock('../../../services/label.service', () => ({
  labelService: {
    previewCustomerNames: (...a: unknown[]) => mockPreview(...a),
    setCustomerItemAlias: (...a: unknown[]) => mockSetItemAlias(...a),
    setCustomerColorAlias: (...a: unknown[]) => mockSetColorAlias(...a),
    setCustomerItemColorAlias: (...a: unknown[]) => mockSetItemColorAlias(...a),
    updateOrderLineCustomerNames: jest.fn(),
  },
}));
// Yalnız kalıcı yazma yetkisi: sipariş kapsamı çizilmez, "Bu müşteride hep" ön seçili gelir.
jest.mock('../../../hooks/usePermission', () => ({
  usePermissions: () => ({ has: (k: string) => k === 'customer-alias:write' }),
}));

if (typeof (globalThis as { window?: { dispatchEvent?: unknown } }).window?.dispatchEvent !== 'function') {
  (globalThis as unknown as { window: { dispatchEvent: () => boolean } }).window.dispatchEvent = () => true;
}

function preview(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      itemId: 'ITEM-X',
      colorId: 'COLOR-1',
      customerId: 'CUST-1',
      customerName: 'MÜŞTERİ A',
      itemName: 'PAMUKLU ASTAR',
      itemNameDefault: 'PAMUKLU ASTAR',
      itemNameSource: 'DEFAULT',
      colorName: 'ABC',
      colorNameDefault: 'BEJ',
      colorNameSource: 'MASTER',
      ...extra,
    },
  };
}

async function acVeKaydet(degisiklik: { renk?: string; kumas?: string }) {
  const r = renderWithPaper(<LabelNamePreview rollId="ROLL-1" orderLineId={null} customerId="CUST-1" />);
  fireEvent.press(await r.findByText(/düzeltmek için dokun/));
  if (degisiklik.renk !== undefined) fireEvent.changeText(await r.findByDisplayValue('ABC'), degisiklik.renk);
  if (degisiklik.kumas !== undefined) {
    fireEvent.changeText(await r.findByDisplayValue('PAMUKLU ASTAR'), degisiklik.kumas);
  }
  fireEvent.press(await r.findByText('Kaydet'));
  return r;
}

describe('LabelNamePreview — kalıcı kayıt hangi uca gider', () => {
  beforeEach(() => {
    mockPreview.mockReset();
    mockSetItemAlias.mockClear();
    mockSetColorAlias.mockClear();
    mockSetItemColorAlias.mockClear();
  });

  it("kumaşa özel renk adı (ITEM) düzeltilince kumaşa özel PUT; genel ad YAZILMAZ", async () => {
    mockPreview.mockResolvedValue(preview({ colorNameScope: 'ITEM' }));
    await acVeKaydet({ renk: 'XYZ' });
    await waitFor(() => expect(mockSetItemColorAlias).toHaveBeenCalledTimes(1));
    expect(mockSetItemColorAlias).toHaveBeenCalledWith('CUST-1', 'ITEM-X', 'COLOR-1', 'XYZ');
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemAlias).not.toHaveBeenCalled();
  });

  it('yalnız kumaş adı düzeltilince renk HİÇ yazılmaz (1.0.8 sızıntısı)', async () => {
    mockPreview.mockResolvedValue(preview({ colorNameScope: 'ITEM' }));
    await acVeKaydet({ kumas: 'COTTON LINING' });
    await waitFor(() => expect(mockSetItemAlias).toHaveBeenCalledTimes(1));
    expect(mockSetItemAlias).toHaveBeenCalledWith('CUST-1', 'ITEM-X', 'COTTON LINING');
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('eski backend (colorNameScope yok) → bugünkü genel PUT', async () => {
    mockPreview.mockResolvedValue(preview());
    await acVeKaydet({ renk: 'XYZ' });
    await waitFor(() => expect(mockSetColorAlias).toHaveBeenCalledTimes(1));
    expect(mockSetColorAlias).toHaveBeenCalledWith('CUST-1', 'COLOR-1', 'XYZ');
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('rozet kumaşa özel kademeyi söyler', async () => {
    mockPreview.mockResolvedValue(preview({ colorNameScope: 'ITEM' }));
    const r = renderWithPaper(<LabelNamePreview rollId="ROLL-1" orderLineId={null} customerId="CUST-1" />);
    expect(await r.findByText(/renk: müşteri adı · bu kumaşa özel/)).toBeTruthy();
  });

  it('hiçbir alan değişmediyse kaydedilmez', async () => {
    mockPreview.mockResolvedValue(preview({ colorNameScope: 'ITEM' }));
    const r = renderWithPaper(<LabelNamePreview rollId="ROLL-1" orderLineId={null} customerId="CUST-1" />);
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    fireEvent.press(await r.findByText('Değişiklik yok'));
    await new Promise((res) => setTimeout(res, 20));
    expect(mockSetItemAlias).not.toHaveBeenCalled();
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });
});
