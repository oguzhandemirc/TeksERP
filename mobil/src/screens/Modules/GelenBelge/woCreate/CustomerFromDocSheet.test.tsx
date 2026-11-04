// Belgeden İE formu — müşteri kayıtlı değil teklifi (Gülkesim 2026-11-04).
// Senaryolar: eşleşme yok · benzer var + Evet · benzer var + Hayır · ad düzenleme · izin yok (istemci + sunucu 403) ·
// belirsiz hatada token yapışır, kesin hatada/ad değişince yenilenir.
// Negatif sonda (2026-11-04, ölçüldü; md5 ile geri): aday yokken de "ask" → 5 ✕; `pick` onPicked'siz → Evet ✕; `decline`
// kapatınca → Hayır ✕; kayıt okunan adla → ad düzenleme ✕; `canCreate` hep true → izin yok ✕; 403 eşlemesi bozulunca → 403 ✕;
// `onFailure` yerine `renew` → token ✕; ad değişiminde yenileme kapatılınca → token ✕.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import CustomerFromDocOffer from './CustomerFromDocSheet';
import type { OwnerUnmatched } from '../../../../services/inboundDoc.service';

const mockQuickCreate = jest.fn();
jest.mock('../../../../services/customer.service', () => ({
  customerService: { quickCreate: (b: unknown) => mockQuickCreate(b) },
}));
let mockPerms: string[] = ['gelen-belge:write'];
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (c: string) => mockPerms.includes(c) }) }));

const none: OwnerUnmatched = { text: 'YENI TEKSTIL', candidates: [] };
const oneSimilar: OwnerUnmatched = { text: 'MAVIDERE BOYAHNE', candidates: [{ customerId: 'c1', name: 'MAVIDERE BOYAHANECI', score: 0.9 }] };

// SimplePortal bildirimi mikrotaskta (RunOpenModal.test tuzağı): her basıştan sonra boşalt.
const flush = () => act(async () => {});

async function setup(unmatched: OwnerUnmatched) {
  const onPicked = jest.fn();
  const ui = renderWithPaper(<CustomerFromDocOffer noteNo="GB-1" unmatched={unmatched} disabled={false} onPicked={onPicked} />);
  await flush();
  fireEvent.press(ui.getByTestId('belge-satir-musteri-ekle-GB-1'));
  await flush();
  return { ui, onPicked };
}

beforeEach(() => {
  mockQuickCreate.mockReset();
  mockPerms = ['gelen-belge:write'];
});

describe('CustomerFromDocOffer', () => {
  it('⭐ eşleşme yok → doğrudan yeni kayıt; okunan adla kaydedilir, formda seçili gelir', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'n1', name: 'YENI TEKSTIL' } });
    const { ui, onPicked } = await setup(none);
    expect(ui.queryByTestId('musteri-ekle-hayir')).toBeNull();
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('n1', 'YENI TEKSTIL'));
    expect(mockQuickCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'YENI TEKSTIL', clientToken: expect.any(String) }));
  });

  it('⭐ benzer var + Evet → aday seçilir, kayıt yapılmaz', async () => {
    const { ui, onPicked } = await setup(oneSimilar);
    expect(ui.getByTestId('musteri-ekle-aday')).toBeTruthy();
    fireEvent.press(ui.getByTestId('musteri-ekle-evet'));
    await flush();
    expect(onPicked).toHaveBeenCalledWith('c1', 'MAVIDERE BOYAHANECI');
    expect(mockQuickCreate).not.toHaveBeenCalled();
  });

  it('⭐ benzer var + Hayır → yeni kayıt modalı, okunan ad ön dolu', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'n2', name: 'MAVIDERE BOYAHNE' } });
    const { ui, onPicked } = await setup(oneSimilar);
    fireEvent.press(ui.getByTestId('musteri-ekle-hayir'));
    await flush();
    expect(ui.getByTestId('musteri-ekle-ad').props.value).toBe('MAVIDERE BOYAHNE');
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('n2', 'MAVIDERE BOYAHNE'));
  });

  it('⭐ ad düzenlenir → düzenlenen adla kaydedilir', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'n3', name: 'YENI TEKSTIL AS' } });
    const { ui, onPicked } = await setup(none);
    fireEvent.changeText(ui.getByTestId('musteri-ekle-ad'), 'YENI TEKSTIL AS');
    await flush();
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('n3', 'YENI TEKSTIL AS'));
    expect(mockQuickCreate.mock.calls[0][0].name).toBe('YENI TEKSTIL AS');
  });

  it('⭐ izin yok → "Kayıt için yetkiniz yok", Kaydet kapalı, çağrı yok', async () => {
    mockPerms = [];
    const { ui } = await setup(none);
    expect(ui.getByTestId('musteri-ekle-yetki-yok')).toHaveTextContent('Kayıt için yetkiniz yok');
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    expect(mockQuickCreate).not.toHaveBeenCalled();
  });

  it('⭐ sunucu 403 → "Kayıt için yetkiniz yok"', async () => {
    mockQuickCreate.mockRejectedValue(Object.assign(new Error('Yetkiniz yok'), { status: 403 }));
    const { ui, onPicked } = await setup(none);
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(ui.getByTestId('musteri-ekle-hata')).toHaveTextContent('Kayıt için yetkiniz yok'));
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('⭐ belirsiz hata (ağ/5xx) → aynı token yapışır; kesin 4xx ve ad değişimi yeni token', async () => {
    mockQuickCreate.mockRejectedValueOnce(Object.assign(new Error('Sunucuya ulaşılamıyor'), { status: undefined }));
    mockQuickCreate.mockRejectedValueOnce(Object.assign(new Error('Sunucu hatası'), { status: 503 }));
    mockQuickCreate.mockRejectedValueOnce(Object.assign(new Error('Bu ad kayıtlı'), { status: 409 }));
    mockQuickCreate.mockRejectedValueOnce(Object.assign(new Error('Sunucu hatası'), { status: 500 }));
    mockQuickCreate.mockRejectedValueOnce(Object.assign(new Error('Sunucu hatası'), { status: 500 }));
    const { ui } = await setup(none);
    const press = async (n: number) => {
      fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
      await flush();
      await waitFor(() => expect(mockQuickCreate).toHaveBeenCalledTimes(n));
    };
    await press(1);
    await press(2);
    await press(3);
    await press(4);
    fireEvent.changeText(ui.getByTestId('musteri-ekle-ad'), 'YENI TEKSTIL 2');
    await flush();
    await press(5);
    const t = mockQuickCreate.mock.calls.map((c) => c[0].clientToken as string);
    expect(t[1]).toBe(t[0]);
    expect(t[2]).toBe(t[0]);
    expect(t[3]).not.toBe(t[2]);
    expect(t[4]).not.toBe(t[3]);
  });
});
