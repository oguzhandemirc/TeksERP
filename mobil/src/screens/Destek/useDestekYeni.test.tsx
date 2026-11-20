// clientToken TEK üretim + çift dokunuş + ağ hatasında aynı token + çevrimdışı.
// ⭐ NEGATİF SONDA (2026-11-16, ölçüldü): `tokenAfterError`ın belirsiz-hata dalı
//    kapatılınca bu dosya + destekForm.test ❌4; uçuş kilidi (`ucusta`) kapatılınca
//    ❌1 ("çift dokunuş TEK istek"). İkisi de geri alındı, temiz ağaçta yeşil.
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

import { destekService } from '../../services/destek.service';
import { useDestekTaslakStore } from '../../store/destekTaslakStore';
import { CEVRIMDISI_METNI, useDestekYeni } from './useDestekYeni';

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace: mockReplace }) }));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('../../services/destek.service', () => ({ destekService: { talepAc: jest.fn() } }));
const talepAc = destekService.talepAc as jest.Mock;

const TALEP = { id: 'b1e1c2d3-0000-4000-8000-000000000001', number: 'DST-2026-000001' };

function kur() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const r = renderHook(() => useDestekYeni(), { wrapper });
  act(() => r.result.current.setForm({ tur: 'BUG', konu: 'Konu', mesaj: 'Mesaj' }));
  return r;
}

const gonderilenToken = (i: number) => talepAc.mock.calls[i][0].clientToken as string;

beforeEach(() => {
  talepAc.mockReset();
  mockReplace.mockReset();
  onlineManager.setOnline(true);
  useDestekTaslakStore.getState().yeniTaslak({ ekran: null, ekranAdi: 'Tambur', ekranAnahtari: 'Tambur' });
});

it('çift dokunuş TEK istek atar', async () => {
  let coz: (v: unknown) => void = () => undefined;
  talepAc.mockReturnValue(new Promise((r) => (coz = r)));
  const r = kur();
  act(() => {
    r.result.current.gonder();
    r.result.current.gonder();
  });
  expect(talepAc).toHaveBeenCalledTimes(1);
  await act(async () => coz(TALEP));
  expect(mockReplace).toHaveBeenCalledWith('DestekDetay', { id: TALEP.id, number: TALEP.number });
});

it('ağ hatası → form açık, yeniden denemede AYNI token; başarı sonrası token yenilenir', async () => {
  talepAc.mockRejectedValueOnce(Object.assign(new Error('ağ'), { status: undefined }));
  talepAc.mockRejectedValueOnce(Object.assign(new Error('zaman aşımı'), { status: 504, details: { code: 'DESTEK_ZAMAN_ASIMI' } }));
  talepAc.mockResolvedValueOnce(TALEP);
  const r = kur();
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(r.result.current.gonderiliyor).toBe(false));
  expect(r.result.current.gonderHatasi).toMatch(/Sunucuya ulaşılamadı/);
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(r.result.current.gonderiliyor).toBe(false));
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  expect(gonderilenToken(1)).toBe(gonderilenToken(0));
  expect(gonderilenToken(2)).toBe(gonderilenToken(0));
});

it('token yeniden render ile DEĞİŞMEZ (form açılışında bir kez)', async () => {
  talepAc.mockRejectedValue(Object.assign(new Error('x'), { status: 502 }));
  const r = kur();
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(r.result.current.gonderiliyor).toBe(false));
  r.rerender({});
  act(() => r.result.current.setForm({ tur: 'QUESTION', konu: 'Konu 2', mesaj: 'Mesaj 2' }));
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(talepAc).toHaveBeenCalledTimes(2));
  expect(gonderilenToken(1)).toBe(gonderilenToken(0));
});

it('kesin 4xx sonrası TAZE token', async () => {
  talepAc.mockRejectedValueOnce(Object.assign(new Error('Konu boş'), { status: 400, details: { code: 'SUBJECT_EMPTY' } }));
  talepAc.mockResolvedValueOnce(TALEP);
  const r = kur();
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(r.result.current.gonderHatasi).toBe('Konu boş'));
  await act(async () => r.result.current.gonder());
  await waitFor(() => expect(talepAc).toHaveBeenCalledTimes(2));
  expect(gonderilenToken(1)).not.toBe(gonderilenToken(0));
});

it('çevrimdışı → istek HİÇ çıkmaz, açık mesaj (kuyruk yok)', () => {
  onlineManager.setOnline(false);
  const r = kur();
  act(() => r.result.current.gonder());
  expect(talepAc).not.toHaveBeenCalled();
  expect(r.result.current.gonderHatasi).toBe(CEVRIMDISI_METNI);
});

it('geçersiz form istek atmaz', () => {
  const r = kur();
  act(() => r.result.current.setForm({ tur: null, konu: '', mesaj: '' }));
  act(() => r.result.current.gonder());
  expect(talepAc).not.toHaveBeenCalled();
  expect(r.result.current.hatalar.tur).toBeTruthy();
});
