// Tablet tanıtma — REHBERLİ kip (K30-A2/A3, sahte API): başlık dokun aç/kapa → alan adımları (Bu belgede yok · değer dokun → okunan
// değer + etiket · Etiketi değiştir) → Bitir (ad önerisi) → Kaydet tek dokunuş; önizleme debounce'lu; benzer şablon sorusu iki yol.
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
};
jest.mock('../../../../services/inboundDoc.service', () => ({
  inboundDocService: {
    scanWords: (...a: unknown[]) => mockApi.scanWords(...a),
    suggestTemplate: (...a: unknown[]) => mockApi.suggestTemplate(...a),
    listUserTemplates: (...a: unknown[]) => mockApi.listUserTemplates(...a),
    getUserTemplate: (...a: unknown[]) => mockApi.getUserTemplate(...a),
    createUserTemplate: (...a: unknown[]) => mockApi.createUserTemplate(...a),
    updateUserTemplate: (...a: unknown[]) => mockApi.updateUserTemplate(...a),
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
  setPerms(['gelen-belge:read', 'gelen-belge:template']);
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

const sleep = (ms: number) => act(() => new Promise<void>((res) => setTimeout(res, ms)));

async function openGuided(r: ReturnType<typeof renderWithPaper>) {
  await flush();
  fireEvent.press(await r.findByTestId('tanit-ac'));
  await flush();
  expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
  expect(r.getByTestId('tanit-rehber')).toBeTruthy();
}

/** Başlık adımından Parti no adımına: Sonraki → Müşteri "Bu belgede yok". */
async function toPartiNo(r: ReturnType<typeof renderWithPaper>) {
  await press(r.getByTestId('tanit-sonraki'));
  expect(r.getByTestId('tanit-soru')).toHaveTextContent(/Müşteri/);
  await press(r.getByTestId('tanit-yok'));
  expect(r.getByTestId('tanit-soru')).toHaveTextContent('Parti no değerine dokunun');
}

describe('TeachModal — rehberli kip', () => {
  it('⭐ başlık aç/kapa → Bu belgede yok → değere dokun → okunan değer + etiket → Etiketi değiştir → Bitir → Kaydet tek dokunuş POST', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    expect(r.getByTestId('tanit-soru')).toHaveTextContent('Belgenin başlığına dokunun');
    expect(r.getByTestId('tanit-baslik-secili')).toHaveTextContent(/GÜLEÇSOY BOYA/);
    await press(r.getByTestId('tanit-kutu-0'));
    expect(r.getByTestId('tanit-baslik-secili')).not.toHaveTextContent(/GÜLEÇSOY BOYA/);
    await press(r.getByTestId('tanit-kutu-1'));
    expect(r.getByTestId('tanit-baslik-secili')).toHaveTextContent(/GÜLEÇSOY BOYA/);

    await toPartiNo(r);
    // Alan yokken önizleme koşmaz (eksik var).
    expect(mockApi.suggestTemplate).not.toHaveBeenCalled();
    await press(r.getByTestId('tanit-kutu-6'));
    expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Okunuyor/);
    await waitFor(() => expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Okunan: P2618733/));
    expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Etiket: “Ham PartiNo”/);
    expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.suggestTemplate.mock.calls[0][0]).toMatchObject({
      scanId: 's1',
      name: 'GÜLEÇSOY BOYA',
      assignments: [{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }],
    });

    // Etiketi değiştir: değer temizlenir, başka kutuya dokunulana dek sonuç yok.
    await press(r.getByTestId('tanit-etiket-degistir'));
    expect(r.queryByTestId('tanit-okunan')).toBeNull();
    await press(r.getByTestId('tanit-kutu-6'));
    await waitFor(() => expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Okunan: P2618733/));

    await press(r.getByTestId('tanit-adim-bitir'));
    expect(r.getByTestId('tanit-soru')).toHaveTextContent(/ad verin/);
    expect(r.getByTestId('tanit-ozet')).toHaveTextContent(/Parti no: P2618733/);
    expect(r.getByTestId('tanit-ozet')).toHaveTextContent(/Müşteri: yok/);
    const calls = mockApi.suggestTemplate.mock.calls.length;
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    // Önizleme tazeydi → Kaydet yeniden önizlemeden doğrudan kaydeder.
    expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(calls);
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.createUserTemplate.mock.calls[0][0]).toMatchObject({ name: 'GÜLEÇSOY BOYA', template: SUGGEST.template });
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
  });

  it('pasif Kaydet\'in altında eksik tek satır yazılır; alan atanınca kalkar', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    expect(r.getByTestId('tanit-kaydet')).toBeDisabled();
    expect(r.getByTestId('tanit-kaydet-neden')).toHaveTextContent(/^Kaydetmek için: En az bir alan atayın/);
    await toPartiNo(r);
    await press(r.getByTestId('tanit-kutu-6'));
    expect(r.queryByTestId('tanit-kaydet-neden')).toBeNull();
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

describe('TeachModal — benzer şablon sorusu', () => {
  const SIMILAR = { ...SUGGEST, benzerSablonlar: [{ kod: 'u-gulecsoy', ad: 'Güleçsoy', skor: 0.9 }] };

  async function markAndSave(r: ReturnType<typeof renderWithPaper>) {
    await openGuided(r);
    await toPartiNo(r);
    await press(r.getByTestId('tanit-kutu-6'));
    await waitFor(() => expect(r.getByTestId('tanit-okunan')).toHaveTextContent(/Okunan: P2618733/));
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(await r.findByTestId('tanit-benzer')).toBeTruthy();
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
  }

  it('"Yeni tip olarak kaydet" → POST (soru tekrar sorulmaz)', async () => {
    mockApi.suggestTemplate.mockResolvedValue(SIMILAR);
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await markAndSave(r);
    expect(r.getByTestId('tanit-benzer-yeni')).toHaveTextContent(/Yeni tip olarak kaydet/);
    await press(r.getByTestId('tanit-benzer-yeni'));
    await flush();
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
  });

  it('"Aynı tip" seçildi ama şablon çekilemedi → kayıt yok, ekran takılmaz; "Yeni tip" ile kaydedilebilir', async () => {
    mockApi.suggestTemplate.mockResolvedValue(SIMILAR);
    mockApi.getUserTemplate.mockRejectedValue(Object.assign(new Error('Ağ hatası'), { status: undefined }));
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await markAndSave(r);
    await press(r.getByTestId('tanit-benzer-guncelle-u-gulecsoy'));
    await flush();
    expect(mockApi.getUserTemplate).toHaveBeenCalledWith('u-gulecsoy');
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
    expect(r.getByTestId('tanit-kutu-6')).toBeTruthy();
    expect(r.getByTestId('tanit-baslik')).not.toHaveTextContent(/güncelle/);
    await press(r.getByTestId('tanit-kaydet'));
    await press(await r.findByTestId('tanit-benzer-yeni'));
    await flush();
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
  });

  it('"Aynı tip" → şablon çekilir, işaretleme benimsenir, base ile önizlenip PUT expectedVersion 2', async () => {
    mockApi.suggestTemplate.mockResolvedValue(SIMILAR);
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await markAndSave(r);
    await press(r.getByTestId('tanit-benzer-guncelle-u-gulecsoy'));
    await waitFor(() => expect(mockApi.updateUserTemplate).toHaveBeenCalledTimes(1));
    expect(mockApi.getUserTemplate).toHaveBeenCalledWith('u-gulecsoy');
    const last = mockApi.suggestTemplate.mock.calls[mockApi.suggestTemplate.mock.calls.length - 1][0];
    expect(last.base).toMatchObject({ code: 'u-gulecsoy' });
    expect(last.identifiers).toEqual(expect.arrayContaining(['ESKİ KİMLİK', 'GÜLEÇSOY BOYA']));
    expect(last.assignments).toEqual([{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }]);
    const [code, put] = mockApi.updateUserTemplate.mock.calls[0];
    expect(code).toBe('u-gulecsoy');
    expect(put).toMatchObject({ expectedVersion: 2, template: SUGGEST.template, name: 'Güleçsoy' });
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
  });
});
