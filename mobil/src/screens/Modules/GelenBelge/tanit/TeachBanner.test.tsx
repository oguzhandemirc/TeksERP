// K30-A1 satır şeridi (tek form / toplu / masa): TANITILMAMIS → "Tanıt" şeridi; TANITILDI → "Şablon: <ad>" satırı + "Şablonu güncelle" düğmesi;
// izin / tanıtım alanı / yerel fotoğraf yoksa ya da satır sonuçlandıysa çizilmez. Kayıt sonrası belge yeniden okutulur
// (başarılı → onay detayı atılır + rereadRow); sunucu reddederse (409 satırlı taslak) önizleme değerleri applyTaught ile dolar.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithPaper } from '../../../../test/render';
import { useAuthStore } from '../../../../store/authStore';
import type { ReadTanitim } from '../../../../services/inboundDoc.service';
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import { approvalDetailKey } from '../useApprovalCard';
import type { DocRow } from '../woCreate/useWoRows';
import { clearLocalPages, rememberLocalPages } from './localPages';
import TeachBanner from './TeachBanner';

const mockApi = {
  scanWords: jest.fn(),
  suggestTemplate: jest.fn(),
  listUserTemplates: jest.fn(),
  getUserTemplate: jest.fn(),
  createUserTemplate: jest.fn(),
  updateUserTemplate: jest.fn(),
  requeueScan: jest.fn(),
};
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    scanWords: (...a: unknown[]) => mockApi.scanWords(...a),
    suggestTemplate: (...a: unknown[]) => mockApi.suggestTemplate(...a),
    listUserTemplates: (...a: unknown[]) => mockApi.listUserTemplates(...a),
    getUserTemplate: (...a: unknown[]) => mockApi.getUserTemplate(...a),
    createUserTemplate: (...a: unknown[]) => mockApi.createUserTemplate(...a),
    updateUserTemplate: (...a: unknown[]) => mockApi.updateUserTemplate(...a),
    requeueScan: (...a: unknown[]) => mockApi.requeueScan(...a),
  },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
// Modal + portal + sorgu zinciri tek başına ~0,5–1 sn; paralel işçi yükünde 5 sn varsayılanı aşabiliyor.
jest.setTimeout(20_000);

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x, y, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [w('GÜLEÇSOY', [50, 20], 1, 120), w('BOYA', [180, 20], 1), w('Ham', [50, 300], 3), w('PartiNo:', [100, 300], 3), w('P2618733', [200, 300], 3, 90)],
};
const FIELDS = { partiNo: 'P2618733', musteri: 'güleçsoy  boya' };
const SUGGEST = {
  template: { id: 'u-gulecsoy', fields: [{ key: 'partiNo' }], identifiers: { keywords: ['GÜLEÇSOY BOYA'] } },
  explain: [{ field: 'partiNo', strategy: 'anchor', label: 'Ham PartiNo', direction: 'right' }],
  errors: [],
  preview: { matched: true, score: 1, fields: FIELDS, lineCount: 0, warnings: [] },
};
const USER_T = { id: 't-u1', code: 'u-gulecsoy', name: 'Güleçsoy', version: 2, isActive: true, template: SUGGEST.template, updatedAt: '2026-11-01T00:00:00Z' };
const CUSTOMERS = [{ value: 'c0', label: 'Başka Firma' }, { value: 'c1', label: 'GÜLEÇSOY BOYA' }];

const row = (over: Partial<DocRow> = {}): DocRow => ({
  noteId: 'n1', noteNo: 'GB-1', runKey: 0, gramajTouched: false, form: null, result: null,
  detail: {
    id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: null, templateId: null,
    scans: [
      { id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' },
      { id: 's2', pageNo: 2, sha256: 'bb', status: 'READ', mimeType: 'application/pdf' },
    ],
  } as never,
  ...over,
});
const NOT_TAUGHT: ReadTanitim = { durum: 'TANITILMAMIS' };
const TAUGHT: ReadTanitim = { durum: 'TANITILDI', sablonKodu: 'u-gulecsoy', sablonAdi: 'Güleçsoy' };

const setPerms = (permissions: string[]) => act(() => useAuthStore.setState({ user: { permissions } as never }));
const flush = () => act(async () => {});
async function press(el: Parameters<typeof fireEvent.press>[0]) {
  fireEvent.press(el);
  await flush();
}
// Kapalı başlayan AppModal'ın ilk "gizle" animasyonu (reanimated sahtesi, ~170 ms) bitmeden açılırsa geç gelen bitiş
// geri çağrısı modalı yeniden kapatır — gerçek cihazda ilk karede biter; testte açmadan önce beklenir.
const settle = () => act(() => new Promise<void>((res) => setTimeout(res, 300)));

let wo: { rereadRow: jest.Mock; applyTaught: jest.Mock };
beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.scanWords.mockResolvedValue(SCAN);
  mockApi.suggestTemplate.mockResolvedValue(SUGGEST);
  mockApi.listUserTemplates.mockResolvedValue([USER_T]);
  mockApi.getUserTemplate.mockResolvedValue({ ...USER_T, versions: [] });
  mockApi.createUserTemplate.mockResolvedValue({ ...USER_T, version: 1 });
  mockApi.updateUserTemplate.mockResolvedValue({ ...USER_T, version: 3 });
  mockApi.requeueScan.mockResolvedValue({});
  wo = { rereadRow: jest.fn(), applyTaught: jest.fn() };
  clearLocalPages();
  rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
  setPerms(['gelen-belge:read', 'gelen-belge:template']);
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

const draw = (tanitim: ReadTanitim | undefined, r: DocRow = row()) =>
  renderWithPaper(<TeachBanner row={r} wo={wo} tanitim={tanitim} customers={CUSTOMERS} />);

/** Şeritten modalı aç → Parti no adımı → değere dokun → okunan değer gelince Kaydet. */
async function teachAndSave(s: ReturnType<typeof renderWithPaper>) {
  await settle();
  await press(s.getByTestId('tanit-serit-ac'));
  await press(await s.findByTestId('tanit-adim-partiNo'));
  await press(await s.findByTestId('tanit-kutu-4'));
  await waitFor(() => expect(s.getByTestId('tanit-okunan')).toHaveTextContent(/Okunan: P2618733/));
  await press(s.getByTestId('tanit-kaydet'));
  await flush();
  expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
}

describe('TeachBanner — görünürlük', () => {
  it('⭐ yerelde tanıtılmış satır (yeniden okutulamadı) → sunucu özeti TANITILMAMIS dese de şerit yok, güncelle bağlantısı', () => {
    const s = draw(NOT_TAUGHT, row({ taught: { seq: 1, code: 'u-gulecsoy', name: 'Güleçsoy' } }));
    expect(s.queryByTestId('tanit-serit')).toBeNull();
    expect(s.getByTestId('tanit-serit-guncelle')).toHaveTextContent(/Şablonu güncelle$/);
    expect(s.getByTestId('tanit-sablon')).toHaveTextContent(/Şablon:\s*Güleçsoy/);
  });

  it('⭐ TANITILMAMIS → belirgin şerit + "Tanıt"', () => {
    const s = draw(NOT_TAUGHT);
    expect(s.getByTestId('tanit-serit')).toHaveTextContent(/Bu belge tanınmadı\. Bir kez tanıtın/);
    expect(s.getByTestId('tanit-serit-ac')).toHaveTextContent(/Tanıt$/);
    expect(s.queryByTestId('tanit-serit-guncelle')).toBeNull();
  });

  it('TANITILDI → şerit yok, şablon satırı + "Şablonu güncelle"; modal güncelle kipinde açılır', async () => {
    const s = draw(TAUGHT);
    expect(s.queryByTestId('tanit-serit')).toBeNull();
    expect(s.getByTestId('tanit-serit-guncelle')).toHaveTextContent(/Şablonu güncelle$/);
    expect(s.getByTestId('tanit-sablon')).toHaveTextContent(/Şablon:\s*Güleçsoy/);
    await settle();
    await press(s.getByTestId('tanit-serit-guncelle'));
    await waitFor(() => expect(s.getByTestId('tanit-baslik')).toHaveTextContent(/Şablonu güncelle — Güleçsoy/));
    expect(mockApi.getUserTemplate).toHaveBeenCalledWith('u-gulecsoy');
  });

  it('bu tablette fotoğraf yoksa: TANITILMAMIS şeridi panel yolunu söyler, Tanıt yok; TANITILDI bağlantısı yok', () => {
    clearLocalPages();
    const a = draw(NOT_TAUGHT);
    expect(a.getByTestId('tanit-serit')).toHaveTextContent(/panelde Gelen Belgeler/);
    expect(a.queryByTestId('tanit-serit-ac')).toBeNull();
    const b = draw(TAUGHT);
    expect(b.queryByTestId('tanit-serit-guncelle')).toBeNull();
  });

  it.each([
    ['şablon izni yok', () => setPerms(['gelen-belge:read']), NOT_TAUGHT, row()],
    ['okuma izni yok', () => setPerms(['gelen-belge:template']), NOT_TAUGHT, row()],
    ['tanıtım alanı yok (eski sunucu / yerleşik şablon)', () => undefined, undefined, row()],
    ['satır sonuçlandı (İE açıldı)', () => undefined, NOT_TAUGHT, row({ result: { kind: 'OPENED' } as never })],
    ['satır detayı yok', () => undefined, NOT_TAUGHT, row({ detail: null })],
  ])('%s → hiçbir şey çizilmez', (_n, arrange, tanitim, r) => {
    arrange();
    const s = draw(tanitim, r);
    expect(s.queryByTestId('tanit-serit')).toBeNull();
    expect(s.queryByTestId('tanit-serit-guncelle')).toBeNull();
  });
});

describe('TeachBanner — kayıt sonrası yeniden okuma', () => {
  it('⭐ yeniden okuma kabul edildi → yalnız okunmuş FOTOĞRAF taramaları kuyruğa, onay detayı atılır, rereadRow', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const remove = jest.spyOn(qc, 'removeQueries');
    const s = renderWithPaper(
      <QueryClientProvider client={qc}>
        <TeachBanner row={row()} wo={wo} tanitim={NOT_TAUGHT} customers={CUSTOMERS} />
      </QueryClientProvider>,
    );
    await teachAndSave(s);
    await waitFor(() => expect(wo.rereadRow).toHaveBeenCalledWith('n1'));
    expect(mockApi.requeueScan.mock.calls).toEqual([['s1']]);
    expect(remove).toHaveBeenCalledWith({ queryKey: approvalDetailKey('n1') });
    expect(wo.applyTaught).not.toHaveBeenCalled();
  });

  it('⭐ sunucu yeniden okumadı (409 satırlı taslak) → önizleme değerleri applyTaught ile; müşteri ad eşleşmesi (büyük/küçük, boşluk)', async () => {
    mockApi.requeueScan.mockRejectedValue(Object.assign(new Error('Belge zaten okundu'), { status: 409 }));
    const s = draw(NOT_TAUGHT);
    await teachAndSave(s);
    await waitFor(() => expect(wo.applyTaught).toHaveBeenCalledTimes(1));
    expect(wo.applyTaught).toHaveBeenCalledWith('n1', FIELDS, 'c1', { code: 'u-gulecsoy', name: 'Güleçsoy' });
    expect(wo.rereadRow).not.toHaveBeenCalled();
  });

  it('müşteri adı listede yoksa sahip null gider (uydurma eşleşme yok)', async () => {
    mockApi.requeueScan.mockRejectedValue(new Error('409'));
    const s = renderWithPaper(<TeachBanner row={row()} wo={wo} tanitim={NOT_TAUGHT} customers={[{ value: 'c0', label: 'Başka Firma' }]} />);
    await teachAndSave(s);
    await waitFor(() => expect(wo.applyTaught).toHaveBeenCalledWith('n1', FIELDS, null, { code: 'u-gulecsoy', name: 'Güleçsoy' }));
  });
});
