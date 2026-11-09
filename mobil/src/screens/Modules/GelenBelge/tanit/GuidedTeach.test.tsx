// Tablet tanıtma — ÜÇ AŞAMA (2026-11-09, sahte API): ① kimlik satırı aç/kapa + ad → ② satır seç, değere dokun → okunan değer +
// etiket → ③ kurallar (çok parti: fabrika = gövdede `rules` yok) → Kaydet; düzenlemede "Kaldır" → `base.drop`; benzer şablon iki yol.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { useAuthStore } from '../../../../store/authStore';
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import TeachEntry from './TeachEntry';
import { PREVIEW_DEBOUNCE_MS } from './useTeachModal';

const mockApi = {
  scanWords: jest.fn(),
  suggestTemplate: jest.fn(),
  listUserTemplates: jest.fn(),
  getUserTemplate: jest.fn(),
  createUserTemplate: jest.fn(),
  updateUserTemplate: jest.fn(),
  settings: jest.fn(),
};
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    scanWords: (...a: unknown[]) => mockApi.scanWords(...a),
    suggestTemplate: (...a: unknown[]) => mockApi.suggestTemplate(...a),
    listUserTemplates: (...a: unknown[]) => mockApi.listUserTemplates(...a),
    getUserTemplate: (...a: unknown[]) => mockApi.getUserTemplate(...a),
    createUserTemplate: (...a: unknown[]) => mockApi.createUserTemplate(...a),
    updateUserTemplate: (...a: unknown[]) => mockApi.updateUserTemplate(...a),
    settings: (...a: unknown[]) => mockApi.settings(...a),
  },
}));
jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));
// Modal + portal + sorgu zinciri tek başına ~0,5–1 sn; paralel işçi yükünde 5 sn varsayılanı aşabiliyor.
jest.setTimeout(20_000);

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x: x + 1000, y: y + 2000, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w('GÜLEÇSOY', [50, 20], 1, 120), w('BOYA', [180, 20], 1), w('ÇEKİ', [50, 60], 2), w('LİSTESİ', [120, 60], 2),
    w('Ham', [50, 300], 3), w('PartiNo:', [100, 300], 3), w('P2618733', [200, 300], 3, 90),
    w('Metre', [50, 600], 4), w('Kilo', [200, 600], 4), w('1234', [50, 1000], 9),
  ],
};
const SUGGEST = {
  template: { id: 'u-gulecsoy', fields: [{ key: 'partiNo' }], identifiers: { keywords: ['GÜLEÇSOY BOYA'] } },
  explain: [{ field: 'partiNo', strategy: 'anchor', label: 'Ham PartiNo', direction: 'right' }],
  errors: [],
  preview: { matched: true, score: 1, fields: { partiNo: 'P2618733' }, lineCount: 4, warnings: [] },
};
const USER_T = { id: 't-u1', code: 'u-gulecsoy', name: 'Güleçsoy', version: 2, isActive: true, template: { fields: [{ key: 'tarih' }], identifiers: { keywords: ['ESKİ KİMLİK'] } }, updatedAt: '2026-11-01T00:00:00Z' };
const detail = (templateId: string | null | undefined) => ({
  id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: null, templateId,
  scans: [{ id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' }],
});
const LOCAL = [{ sha256: 'aa', uri: 'file:///1.jpg' }];

const setPerms = (permissions: string[]) => act(() => useAuthStore.setState({ user: { permissions } as never }));
const flush = () => act(async () => {});
// Portal içeriği host'a mikrotask'ta taşınır (SimplePortal): her dokunuştan sonra boşalt.
async function press(el: Parameters<typeof fireEvent.press>[0]) {
  fireEvent.press(el);
  await flush();
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.scanWords.mockResolvedValue(SCAN);
  mockApi.suggestTemplate.mockResolvedValue(SUGGEST);
  mockApi.listUserTemplates.mockResolvedValue([USER_T]);
  mockApi.getUserTemplate.mockResolvedValue({ ...USER_T, versions: [] });
  mockApi.createUserTemplate.mockResolvedValue({ ...USER_T, version: 1 });
  mockApi.updateUserTemplate.mockResolvedValue({ ...USER_T, version: 3 });
  mockApi.settings.mockResolvedValue({ multiPartyWorkOrder: 'SINGLE' });
  setPerms(['gelen-belge:read', 'gelen-belge:template']);
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

const sleep = (ms: number) => act(() => new Promise<void>((res) => setTimeout(res, ms)));
const lastSuggest = () => mockApi.suggestTemplate.mock.calls[mockApi.suggestTemplate.mock.calls.length - 1][0];

async function openGuided(r: ReturnType<typeof renderWithPaper>) {
  await flush();
  fireEvent.press(await r.findByTestId('tanit-ac'));
  await flush();
  expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
  expect(r.getByTestId('tanit-asama-seridi')).toBeTruthy();
}

/** ①'den ②'ye geçip "Gönderen parti no" satırını seçer. */
async function toPartiNo(r: ReturnType<typeof renderWithPaper>) {
  await press(r.getByTestId('tanit-ileri'));
  expect(r.getByTestId('tanit-asama-2')).toBeTruthy();
  await press(r.getByTestId('tanit-adim-partiNo'));
  expect(r.getByTestId('tanit-soru')).toHaveTextContent('Gönderen parti no: belgede değerine dokunun');
}

async function markPartiNo(r: ReturnType<typeof renderWithPaper>) {
  await toPartiNo(r);
  await press(r.getByTestId('tanit-kutu-6'));
  await waitFor(() => expect(r.getByTestId('tanit-deger-partiNo')).toHaveTextContent('P2618733'));
}

describe('TeachModal — üç aşama', () => {
  it('⭐ ① kimlik aç/kapa → İleri → ② değere dokun → okunan değer + etiket → işareti kaldır → ③ özet → Kaydet POST (fabrika ayarı: rules yok)', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    expect(r.getByTestId('tanit-asama-1')).toBeTruthy();
    expect(r.queryByTestId('tanit-asama-2')).toBeNull();
    expect(r.getByTestId('tanit-asama-TANIMA')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(r.getByTestId('tanit-baslik-secili')).toHaveTextContent(/GÜLEÇSOY BOYA/);
    await press(r.getByTestId('tanit-kutu-0'));
    expect(r.getByTestId('tanit-baslik-secili')).not.toHaveTextContent(/GÜLEÇSOY BOYA/);
    await press(r.getByTestId('tanit-kutu-1'));
    expect(r.getByTestId('tanit-baslik-secili')).toHaveTextContent(/GÜLEÇSOY BOYA/);

    await toPartiNo(r);
    expect(mockApi.suggestTemplate).not.toHaveBeenCalled(); // alan yokken önizleme koşmaz
    await press(r.getByTestId('tanit-kutu-6'));
    expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Okunuyor/);
    await waitFor(() => expect(r.getByTestId('tanit-deger-partiNo')).toHaveTextContent('P2618733'));
    expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Etiket: “Ham PartiNo”/);
    expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.suggestTemplate.mock.calls[0][0]).toMatchObject({ scanId: 's1', name: 'GÜLEÇSOY BOYA', assignments: [{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }] });

    await press(r.getByTestId('tanit-etiket-degistir'));
    expect(r.queryByTestId('tanit-deger-partiNo')).toBeNull();
    await press(r.getByTestId('tanit-kutu-6'));
    await waitFor(() => expect(r.getByTestId('tanit-deger-partiNo')).toHaveTextContent('P2618733'));

    await press(r.getByTestId('tanit-ileri'));
    expect(r.getByTestId('tanit-asama-3')).toBeTruthy();
    expect(r.queryByTestId('tanit-ileri')).toBeNull();
    expect(r.getByTestId('tanit-asama-TANIMA')).toHaveProp('accessibilityLabel', '1. Tanıma, tamam');
    expect(r.getByTestId('tanit-ozet')).toHaveTextContent('3 kimlik yazısı · 1 alan · 0 kural');
    expect(r.getByTestId('tanit-cok-parti-FABRIKA')).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
    await waitFor(() => expect(r.getByTestId('tanit-kural-cok-parti')).toHaveTextContent(/Şu an: Tek İE/));
    const calls = mockApi.suggestTemplate.mock.calls.length;
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(calls); // önizleme tazeydi
    expect(lastSuggest()).not.toHaveProperty('rules');
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.createUserTemplate.mock.calls[0][0]).toMatchObject({ name: 'GÜLEÇSOY BOYA', template: SUGGEST.template });
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
  });

  it('⭐ kimlik yazısı yokken İleri kapalı, nedeni tek satır; şeritten ileri atlanamaz', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    await press(r.getByTestId('tanit-kutu-0'));
    await press(r.getByTestId('tanit-kutu-2'));
    await press(r.getByTestId('tanit-kutu-4'));
    expect(r.getByTestId('tanit-baslik-secili')).toHaveTextContent(/Henüz kimlik yazısı seçilmedi/);
    expect(r.getByTestId('tanit-ileri')).toBeDisabled();
    expect(r.getByTestId('tanit-kaydet-neden')).toHaveTextContent(/^İlerlemek için: En az bir kimlik yazısı/);
    expect(r.getByTestId('tanit-asama-ESLEME')).toBeDisabled();
    await press(r.getByTestId('tanit-asama-KURALLAR'));
    expect(r.getByTestId('tanit-asama-1')).toBeTruthy();
    await press(r.getByTestId('tanit-kutu-2'));
    expect(r.getByTestId('tanit-ileri')).not.toBeDisabled();
  });

});

describe('TeachModal — üç aşama: kurallar ve önizleme', () => {
  it('⭐ ③ "Her parti ayrı İE" gövdeye rules girer; "Fabrika ayarı"na dönünce gövdede rules YOK', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    await markPartiNo(r);
    await press(r.getByTestId('tanit-ileri'));
    await press(r.getByTestId('tanit-cok-parti-PER_PARTY'));
    await waitFor(() => expect(lastSuggest().rules).toEqual({ multiParty: 'PER_PARTY' }));
    expect(r.getByTestId('tanit-ozet')).toHaveTextContent(/1 kural$/);
    await press(r.getByTestId('tanit-cok-parti-FABRIKA'));
    await waitFor(() => expect(lastSuggest()).not.toHaveProperty('rules'));
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
  });

  it('③ tekrar eden bölüm: Evet → başlangıç yazısına dokun → önizleme bölüm sayısı; tablo yoksa Kaydet kapalı', async () => {
    mockApi.suggestTemplate.mockResolvedValue({ ...SUGGEST, preview: { ...SUGGEST.preview, blocks: [{ blockNo: 1 }, { blockNo: 2 }] } });
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    await markPartiNo(r);
    await press(r.getByTestId('tanit-ileri'));
    await press(r.getByTestId('tanit-tekrar-evet'));
    expect(r.getByTestId('tanit-kaydet')).toBeDisabled();
    await press(r.getByTestId('tanit-kutu-4'));
    await press(r.getByTestId('tanit-kutu-5'));
    expect(r.getByTestId('tanit-bolum-baslangic-deger')).toHaveTextContent('Ham PartiNo:');
    expect(r.getByTestId('tanit-kaydet-neden')).toHaveTextContent(/top tablosu gerekli/);
    await press(r.getByTestId('tanit-asama-ESLEME'));
    await press(r.getByTestId('tanit-sutun-m'));
    await press(r.getByTestId('tanit-kutu-7'));
    expect(r.getByTestId('tanit-sutun-m-deger')).toHaveTextContent('Metre');
    await press(r.getByTestId('tanit-asama-KURALLAR'));
    await waitFor(() => expect(r.getByTestId('tanit-bolum-onizleme')).toHaveTextContent('‘Ham PartiNo:’ ile başlıyor · 2 bölüm bulundu'));
    expect(lastSuggest()).toMatchObject({ sectionStartLabel: 'Ham PartiNo:', assignments: [{ field: 'partiNo', section: true }], table: { columns: [{ key: 'm', header: 'Metre' }] } });
    expect(r.getByTestId('tanit-kaydet')).not.toBeDisabled();
  });

  it('debounce: iki hızlı dokunuş tek önizleme isteği (iki kelimelik değer)', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    await toPartiNo(r);
    await press(r.getByTestId('tanit-kutu-5'));
    await press(r.getByTestId('tanit-kutu-6'));
    expect(mockApi.suggestTemplate).not.toHaveBeenCalled();
    await waitFor(() => expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1));
    await sleep(PREVIEW_DEBOUNCE_MS + 200);
    expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.suggestTemplate.mock.calls[0][0].assignments).toEqual([{ field: 'partiNo', rect: { x: 100, y: 300, width: 190, height: 20 } }]);
  });
});

