// Belgeden İE formu — müşteri kayıtlı değil teklifi (Gülkesim 2026-11-04; modal 2026-11-05).
// Senaryolar: okuma bitince kendiliğinden açılır (not başına BİR KEZ, aynı anda tek teklif, kilitliyken açılmaz) ·
// a) benzer yok → "Yeni müşteri kaydedilsin mi?" · b) benzer var (tek de olsa) → "Bunu mu demek istediniz?" listesi (ad + kod),
// Hiçbiri → yeni kayıt · Listeden seç → satır seçicisi · Vazgeç sonrası "öneriyi aç" yeniden açar · ad düzenleme ·
// izin yok (istemci + sunucu 403) · belirsiz hatada token yapışır, kesin hatada/ad değişince yenilenir.
// Negatif sonda (2026-11-04, ölçüldü; md5 ile geri): `pick` onPicked'siz → aday ✕; `decline` kapatınca → Hiçbiri ✕;
// kayıt okunan adla → ad düzenleme ✕; `canCreate` hep true → izin yok ✕; 403 eşlemesi bozulunca → 403 ✕;
// `onFailure` yerine `renew` → token ✕; ad değişiminde yenileme kapatılınca → token ✕.
// Sonda 2026-11-05 (modal): `claimAutoOpen` "bir kez" koşulu kaldırılınca 4 ✕; tek-teklif koşulu kaldırılınca → tek teklif ✕;
// kilit (`disabled`) koşulu kaldırılınca → kilitli ✕; "Listeden seç" `onPickFromList`siz → 2 ✕; AppModal `visibleRef` koruması
// kaldırılınca 15 ✕ (bağlanışta açılan modal hiç görünmez).
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import CustomerFromDocOffer from './CustomerFromDocSheet';
import { resetCustomerOfferStore } from './customerOfferStore';
import ModuleSheet from '../../../../components/ModuleSheet';
import type { OwnerUnmatched } from '../../../../services/inboundDoc.service';

const mockQuickCreate = jest.fn();
jest.mock('../../../../services/customer.service', () => ({
  customerService: { quickCreate: (b: unknown) => mockQuickCreate(b) },
}));
let mockPerms: string[] = ['gelen-belge:write'];
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: (c: string) => mockPerms.includes(c) }) }));

const none: OwnerUnmatched = { text: 'YENI TEKSTIL', candidates: [] };
const oneSimilar: OwnerUnmatched = { text: 'MAVIDERE BOYAHNE', candidates: [{ customerId: 'c1', code: 'M-001', name: 'MAVIDERE BOYAHANECI', score: 0.9 }] };
const twoSimilar: OwnerUnmatched = { text: 'MAVIDERE BOYAHNE', candidates: [...oneSimilar.candidates, { customerId: 'c2', name: 'MAVIDERE BOYAHANELERI', score: 0.86 }] };

/** Açık (visible) teklif kartlarının başlıkları — kapanış animasyonu testte sürer, içerik bir süre ağaçta kalır. */
const openTitles = (ui: ReturnType<typeof renderWithPaper>) =>
  ui.UNSAFE_getAllByType(ModuleSheet).filter((x) => x.props.visible).map((x) => x.props.title as string);

// SimplePortal bildirimi mikrotaskta (RunOpenModal.test tuzağı): her basıştan sonra boşalt.
const flush = async () => {
  await act(async () => {});
  await act(async () => {});
};

function renderOffer(unmatched: OwnerUnmatched, opts: { noteId?: string; noteNo?: string; disabled?: boolean } = {}) {
  const onPicked = jest.fn();
  const onPickFromList = jest.fn();
  const el = (disabled: boolean) => (
    <CustomerFromDocOffer noteId={opts.noteId ?? 'n1'} noteNo={opts.noteNo ?? 'GB-1'} unmatched={unmatched} disabled={disabled}
      onPicked={onPicked} onPickFromList={onPickFromList} />
  );
  const ui = renderWithPaper(el(opts.disabled ?? false));
  return { ui, onPicked, onPickFromList, rerender: (disabled: boolean) => ui.rerender(el(disabled)) };
}

/** Kendiliğinden açılan teklif (okuma bitti, satır kilitsiz). */
async function setup(unmatched: OwnerUnmatched) {
  const r = renderOffer(unmatched);
  await flush();
  return r;
}

beforeEach(() => {
  resetCustomerOfferStore();
  mockQuickCreate.mockReset();
  mockPerms = ['gelen-belge:write'];
});

describe('CustomerFromDocOffer — teklif varyantları', () => {
  it('⭐ a) benzer yok → kendiliğinden "Yeni müşteri kaydedilsin mi?"; okunan adla kaydedilir, formda seçili gelir', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'n1', name: 'YENI TEKSTIL' } });
    const { ui, onPicked } = await setup(none);
    expect(ui.getByText('Yeni müşteri kaydedilsin mi?')).toBeTruthy();
    expect(ui.getByTestId('musteri-ekle-govde')).toHaveTextContent('Belgede müşteri adı “YENI TEKSTIL” okundu. Bu adla kayıtlı müşteri yok.', { exact: false });
    expect(ui.queryByTestId('musteri-ekle-hayir')).toBeNull();
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('n1', 'YENI TEKSTIL'));
    expect(mockQuickCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'YENI TEKSTIL', clientToken: expect.any(String) }));
  });

  it('⭐ b) tek benzer de olsa "Bunu mu demek istediniz?" listesi (ad + kod); dokununca seçilir, kayıt yok', async () => {
    const { ui, onPicked } = await setup(oneSimilar);
    expect(ui.getByText('Bunu mu demek istediniz?')).toBeTruthy();
    expect(ui.getByTestId('musteri-ekle-aday-c1')).toHaveTextContent('Kod: M-001', { exact: false });
    expect(ui.queryByTestId('musteri-ekle-evet')).toBeNull();
    fireEvent.press(ui.getByTestId('musteri-ekle-aday-c1'));
    await flush();
    expect(onPicked).toHaveBeenCalledWith('c1', 'MAVIDERE BOYAHANECI');
    expect(mockQuickCreate).not.toHaveBeenCalled();
  });

  it('⭐ b) birden çok benzer: hepsi listede, ikincisi seçilebilir', async () => {
    const { ui, onPicked } = await setup(twoSimilar);
    expect(ui.getByTestId('musteri-ekle-aday-c1')).toBeTruthy();
    fireEvent.press(ui.getByTestId('musteri-ekle-aday-c2'));
    await flush();
    expect(onPicked).toHaveBeenCalledWith('c2', 'MAVIDERE BOYAHANELERI');
  });

  it('⭐ b) Hiçbiri → yeni kayıt modalı, okunan ad ön dolu', async () => {
    mockQuickCreate.mockResolvedValue({ success: true, data: { id: 'n2', name: 'MAVIDERE BOYAHNE' } });
    const { ui, onPicked } = await setup(oneSimilar);
    expect(ui.getByTestId('musteri-ekle-hayir')).toHaveTextContent('Hiçbiri — “MAVIDERE BOYAHNE” adıyla yeni kaydet');
    fireEvent.press(ui.getByTestId('musteri-ekle-hayir'));
    await flush();
    expect(ui.getByTestId('musteri-ekle-ad').props.value).toBe('MAVIDERE BOYAHNE');
    fireEvent.press(ui.getByTestId('musteri-ekle-kaydet'));
    await flush();
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith('n2', 'MAVIDERE BOYAHNE'));
  });

  it('⭐ Listeden seç → modal kapanır, satır seçicisi açılır', async () => {
    const { ui, onPickFromList, onPicked } = await setup(none);
    fireEvent.press(ui.getByTestId('musteri-ekle-listeden'));
    await flush();
    expect(onPickFromList).toHaveBeenCalledTimes(1);
    expect(onPicked).not.toHaveBeenCalled();
    expect(openTitles(ui)).toEqual([]);
  });
});

describe('CustomerFromDocOffer — kendiliğinden açılış', () => {
  it('⭐ Vazgeç → yeniden kendiliğinden açılmaz; "öneriyi aç" bağlantısı açar', async () => {
    const { ui, rerender } = await setup(none);
    expect(ui.getByTestId('belge-satir-musteri-ekle-GB-1')).toHaveTextContent('Belgedeki ad: YENI TEKSTIL — öneriyi aç', { exact: false });
    fireEvent.press(ui.getAllByTestId('musteri-ekle-vazgec')[0]);
    await flush();
    expect(openTitles(ui)).toEqual([]);
    rerender(false);
    await flush();
    expect(openTitles(ui)).toEqual([]);
    fireEvent.press(ui.getByTestId('belge-satir-musteri-ekle-GB-1'));
    await flush();
    expect(openTitles(ui)).toEqual(['Yeni müşteri kaydedilsin mi?']);
  });

  it('⭐ not başına bir kez: söküp yeniden bağlanan satır kendiliğinden açılmaz', async () => {
    const first = await setup(none);
    fireEvent.press(first.ui.getAllByTestId('musteri-ekle-vazgec')[0]);
    await flush();
    first.ui.unmount();
    const again = renderOffer(none);
    await flush();
    expect(openTitles(again.ui)).toEqual([]);
  });

  it('⭐ aynı anda tek teklif: ikinci not ilki kapanınca açılır', async () => {
    const props = { disabled: false, onPicked: jest.fn(), onPickFromList: jest.fn() };
    const ui = renderWithPaper(
      <>
        <CustomerFromDocOffer noteId="nA" noteNo="GB-A" unmatched={none} {...props} />
        <CustomerFromDocOffer noteId="nB" noteNo="GB-B" unmatched={oneSimilar} {...props} />
      </>,
    );
    await flush();
    expect(openTitles(ui)).toEqual(['Yeni müşteri kaydedilsin mi?']);
    fireEvent.press(ui.getAllByTestId('musteri-ekle-vazgec')[0]);
    await flush();
    await waitFor(() => expect(openTitles(ui)).toEqual(['Bunu mu demek istediniz?']));
  });

  it('⭐ satır kilitliyken (kayıt sürüyor) kendiliğinden açılmaz; kilit kalkınca açılır', async () => {
    const r = renderOffer(none, { disabled: true });
    await flush();
    expect(openTitles(r.ui)).toEqual([]);
    r.rerender(false);
    await flush();
    expect(r.ui.getByTestId('musteri-ekle-kaydet')).toBeTruthy();
  });
});

describe('CustomerFromDocOffer — kayıt', () => {
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
