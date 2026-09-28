// =============================================================================
// Bekçi: Tambur "Bu müşteride hep" kaydı DOĞRU uca ve yalnız değişen alana yazar
// =============================================================================
// MUSTERI-KUMAS-RENK-ADI §7 (tablet 1.0.8 sızıntısı) + §12.6: kalıcı kayıt renk
// alanını koşulsuz genel ada yazıyordu. Saf plan `labelNameSave.test.ts`te
// ölçülür; burası bileşenin planı GERÇEKTEN kullandığını, yani ekrandan hangi
// servis çağrısının çıktığını ölçer. Sunucu küçük bir durum modeliyle taklit
// edilir: panelin arada yaptığı düzeltme (bayat önizleme) ve sipariş kalemi
// adının altındaki kumaşa özel satır ancak böyle kurulur.
// =============================================================================
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';
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

const toastShow = Toast.show as jest.Mock;

/** Sunucudaki ad satırları — backend `previewCustomerNames` zincirinin (kalem → kumaşa özel → genel → bizdeki) taklidi. */
interface Server {
  itemAlias: string | null;
  colorItem: string | null;
  colorGeneral: string | null;
  lineItem: string | null;
  lineColor: string | null;
  /** Eski backend: colorNameScope alanını hiç göndermez. */
  noScope?: boolean;
}
let server: Server;

function answer(params: { orderLineId?: string | null }) {
  const line = Boolean(params.orderLineId);
  const masterColor = server.colorItem
    ? { alias: server.colorItem, scope: 'ITEM' as const }
    : server.colorGeneral
      ? { alias: server.colorGeneral, scope: 'CUSTOMER' as const }
      : null;
  const itemOv = line ? server.lineItem : null;
  const colorOv = line ? server.lineColor : null;
  const [itemName, itemNameSource] = itemOv
    ? [itemOv, 'OVERRIDE']
    : server.itemAlias
      ? [server.itemAlias, 'MASTER']
      : ['PAMUKLU ASTAR', 'DEFAULT'];
  const [colorName, colorNameSource] = colorOv
    ? [colorOv, 'OVERRIDE']
    : masterColor
      ? [masterColor.alias, 'MASTER']
      : ['BEJ', 'DEFAULT'];
  const colorNameScope = colorNameSource === 'MASTER' ? masterColor!.scope : null;
  return {
    success: true,
    data: {
      itemId: 'ITEM-X',
      colorId: 'COLOR-1',
      customerId: 'CUST-1',
      customerName: 'MÜŞTERİ A',
      itemName,
      itemNameDefault: 'PAMUKLU ASTAR',
      itemNameSource,
      colorName,
      colorNameDefault: 'BEJ',
      colorNameSource,
      ...(server.noScope ? {} : { colorNameScope }),
    },
  };
}

function ciz(orderLineId: string | null = null) {
  return renderWithPaper(<LabelNamePreview rollId="ROLL-1" orderLineId={orderLineId} customerId="CUST-1" />);
}

function kapali(r: ReturnType<typeof ciz>, ad: string | RegExp): boolean {
  return r.getByRole('button', { name: ad }).props.accessibilityState?.disabled === true;
}

async function acVeKaydet(degisiklik: { renk?: string; kumas?: string }, eskiRenk = 'ABC') {
  const r = ciz();
  fireEvent.press(await r.findByText(/düzeltmek için dokun/));
  if (degisiklik.renk !== undefined) fireEvent.changeText(await r.findByDisplayValue(eskiRenk), degisiklik.renk);
  if (degisiklik.kumas !== undefined) {
    fireEvent.changeText(await r.findByDisplayValue('PAMUKLU ASTAR'), degisiklik.kumas);
  }
  fireEvent.press(await r.findByText('Kaydet'));
  return r;
}

describe('LabelNamePreview — kalıcı kayıt hangi uca gider', () => {
  beforeEach(() => {
    server = { itemAlias: null, colorItem: null, colorGeneral: null, lineItem: null, lineColor: null };
    mockPreview.mockReset();
    mockPreview.mockImplementation((params: { orderLineId?: string | null }) => Promise.resolve(answer(params)));
    mockSetItemAlias.mockClear();
    mockSetColorAlias.mockClear();
    mockSetItemColorAlias.mockClear();
    toastShow.mockClear();
  });

  it("kumaşa özel renk adı (ITEM) düzeltilince kumaşa özel PUT; genel ad YAZILMAZ", async () => {
    server.colorItem = 'ABC';
    await acVeKaydet({ renk: 'XYZ' });
    await waitFor(() => expect(mockSetItemColorAlias).toHaveBeenCalledTimes(1));
    expect(mockSetItemColorAlias).toHaveBeenCalledWith('CUST-1', 'ITEM-X', 'COLOR-1', 'XYZ');
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemAlias).not.toHaveBeenCalled();
  });

  it('yalnız kumaş adı düzeltilince renk HİÇ yazılmaz (1.0.8 sızıntısı)', async () => {
    server.colorItem = 'ABC';
    await acVeKaydet({ kumas: 'COTTON LINING' });
    await waitFor(() => expect(mockSetItemAlias).toHaveBeenCalledTimes(1));
    expect(mockSetItemAlias).toHaveBeenCalledWith('CUST-1', 'ITEM-X', 'COTTON LINING');
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('eski backend (colorNameScope yok) → bugünkü genel PUT', async () => {
    server.colorGeneral = 'ABC';
    server.noScope = true;
    await acVeKaydet({ renk: 'XYZ' });
    await waitFor(() => expect(mockSetColorAlias).toHaveBeenCalledTimes(1));
    expect(mockSetColorAlias).toHaveBeenCalledWith('CUST-1', 'COLOR-1', 'XYZ');
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('rozet kumaşa özel kademeyi söyler', async () => {
    server.colorItem = 'ABC';
    const r = ciz();
    expect(await r.findByText(/renk: müşteri adı · bu kumaşa özel/)).toBeTruthy();
  });

  it('hiçbir alan değişmediyse Kaydet KAPALI ve başarı mesajı çıkmaz', async () => {
    server.colorItem = 'ABC';
    const r = ciz();
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    await r.findByText('Değişiklik yok');
    expect(kapali(r, 'Değişiklik yok')).toBe(true);
    fireEvent.press(r.getByText('Değişiklik yok'));
    await new Promise((res) => setTimeout(res, 20));
    expect(toastShow).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(mockSetItemAlias).not.toHaveBeenCalled();
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('renk alanı boşaltılınca sebebi söylenir, kaydedilmez', async () => {
    server.colorItem = 'ABC';
    const r = ciz();
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    fireEvent.changeText(await r.findByDisplayValue('ABC'), '');
    expect(await r.findByText(/adı silmek panelden/)).toBeTruthy();
    expect(kapali(r, 'Değişiklik yok')).toBe(true);
  });
});

describe('LabelNamePreview — bayat önizlemeyle kademe kararı verilmez', () => {
  beforeEach(() => {
    server = { itemAlias: null, colorItem: null, colorGeneral: null, lineItem: null, lineColor: null };
    mockPreview.mockReset();
    mockPreview.mockImplementation((params: { orderLineId?: string | null }) => Promise.resolve(answer(params)));
    mockSetItemAlias.mockClear();
    mockSetColorAlias.mockClear();
    mockSetItemColorAlias.mockClear();
    toastShow.mockClear();
  });

  it('önizleme yüklendikten sonra panel kumaşa özel adı sildiyse pencere tazelenir, silinen satır YENİDEN YARATILMAZ', async () => {
    server.colorItem = 'ABC';
    const r = ciz();
    await r.findByText(/bu kumaşa özel/);
    server.colorItem = null;
    server.colorGeneral = 'GENEL';
    fireEvent.press(r.getByText(/düzeltmek için dokun/));
    fireEvent.changeText(await r.findByDisplayValue('GENEL'), 'XYZ');
    fireEvent.press(await r.findByText('Kaydet'));
    await waitFor(() => expect(mockSetColorAlias).toHaveBeenCalledWith('CUST-1', 'COLOR-1', 'XYZ'));
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('pencere açıkken panel kumaşa özel ad girdiyse kayıt DURUR, hiçbir şey yazılmaz', async () => {
    server.colorGeneral = 'ABC';
    const r = ciz();
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    fireEvent.changeText(await r.findByDisplayValue('ABC'), 'XYZ');
    await r.findByText('Kaydet');
    server.colorItem = 'DEF';
    fireEvent.press(r.getByText('Kaydet'));
    await waitFor(() =>
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Kaydedilmedi' })),
    );
    expect(mockSetColorAlias).not.toHaveBeenCalled();
    expect(mockSetItemColorAlias).not.toHaveBeenCalled();
  });

  it('renk adı sipariş kaleminden gelirken altındaki kumaşa özel ad güncellenir, genel ada YAZILMAZ', async () => {
    server.colorItem = 'ABC';
    server.lineColor = 'ABC-2';
    const r = ciz('OL-1');
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    fireEvent.changeText(await r.findByDisplayValue('ABC-2'), 'XYZ');
    await r.findByText('Kaydet');
    expect(r.getByText(/renk için özel bir ad girilmiş/)).toBeTruthy();
    expect(r.getByText('Renk adı yalnız bu kumaşta değişir.')).toBeTruthy();
    fireEvent.press(r.getByText('Kaydet'));
    await waitFor(() => expect(mockSetItemColorAlias).toHaveBeenCalledWith('CUST-1', 'ITEM-X', 'COLOR-1', 'XYZ'));
    expect(mockSetColorAlias).not.toHaveBeenCalled();
  });

  it('ikinci yazım düşerse hangisinin geçtiği söylenir ve önizleme tazelenir', async () => {
    server.colorItem = 'ABC';
    mockSetItemColorAlias.mockImplementationOnce(() => Promise.reject(new Error('Kumaş pasif durumda')));
    const r = ciz();
    fireEvent.press(await r.findByText(/düzeltmek için dokun/));
    fireEvent.changeText(await r.findByDisplayValue('PAMUKLU ASTAR'), 'COTTON');
    fireEvent.changeText(await r.findByDisplayValue('ABC'), 'XYZ');
    await r.findByText('Kaydet');
    const onceki = mockPreview.mock.calls.length;
    fireEvent.press(r.getByText('Kaydet'));
    await waitFor(() =>
      expect(toastShow).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text2: 'Kumaş adı kaydedildi, renk adı kaydedilemedi: Kumaş pasif durumda',
        }),
      ),
    );
    expect(mockSetItemAlias).toHaveBeenCalledTimes(1);
    // +1 kayıt anındaki taze okuma; fazlası hatadan sonraki tazeleme.
    await waitFor(() => expect(mockPreview.mock.calls.length).toBeGreaterThan(onceki + 1));
  });
});
