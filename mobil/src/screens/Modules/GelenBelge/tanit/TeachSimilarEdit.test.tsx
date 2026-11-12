// Tablet tanıtma — üç aşamada benzer şablon (kayıtta soru · ①'de "Onu düzenle") ve tanımı düzenle (kayıtlı alan "Önceki
// tanımdan", "Kaldır" → `base.drop`, kayıtlı kuralı fabrikaya döndürme → `rules.multiParty: null`). Akış: GuidedTeach.test.tsx.
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

describe('TeachModal — benzer şablon', () => {
  const SIMILAR = { ...SUGGEST, benzerSablonlar: [{ kod: 'u-gulecsoy', ad: 'Güleçsoy', skor: 0.9 }] };

  async function markAndSave(r: ReturnType<typeof renderWithPaper>) {
    await openGuided(r);
    await markPartiNo(r);
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(await r.findByTestId('tanit-benzer')).toBeTruthy();
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
  }

  it('"Yeni tip olarak kaydet" → POST (soru tekrar sorulmaz)', async () => {
    mockApi.suggestTemplate.mockResolvedValue(SIMILAR);
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await markAndSave(r);
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
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
    expect(r.getByTestId('tanit-baslik')).not.toHaveTextContent(/düzenle/);
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
    const last = lastSuggest();
    expect(last.base).toMatchObject({ code: 'u-gulecsoy' });
    expect(last.identifiers).toEqual(expect.arrayContaining(['ESKİ KİMLİK', 'GÜLEÇSOY BOYA']));
    expect(mockApi.updateUserTemplate.mock.calls[0][1]).toMatchObject({ expectedVersion: 2, template: SUGGEST.template, name: 'Güleçsoy' });
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
  });

  it('① "Benzeyen tip · Onu düzenle" o tipi benimser ama KAYDETMEZ', async () => {
    mockApi.suggestTemplate.mockResolvedValue(SIMILAR);
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openGuided(r);
    await markPartiNo(r);
    await press(r.getByTestId('tanit-asama-TANIMA'));
    expect(r.getByTestId('tanit-benzeyen')).toHaveTextContent(/Benzeyen tip: Güleçsoy/);
    await press(r.getByTestId('tanit-benzeyen-duzenle'));
    await waitFor(() => expect(r.getByTestId('tanit-baslik')).toHaveTextContent(/Tanımı düzenle — Güleçsoy/));
    await sleep(PREVIEW_DEBOUNCE_MS + 200);
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
    expect(lastSuggest().base).toMatchObject({ code: 'u-gulecsoy' });
  });
});

// Gülkesim 2026-11-04 cihaz: "Tanımı düzenle"de kayıtlı alanlar işaretsiz görünüyordu; 2026-11-09: kayıtlı alan kaldırılabilir.
describe('TeachModal — tanımı düzenle (kayıtlı alanlar)', () => {
  const OLD_T = {
    ...USER_T,
    name: 'kömürhan',
    template: {
      fields: [{ key: 'musteri' }, { key: 'partiNo', strategies: [{ kind: 'anchor', maxWords: 1 }] }, { key: 'toplamMetre' }, { key: 'yeniSunucuAlani' }],
      identifiers: { keywords: ['GÜLEÇSOY BOYA'] },
      rules: { multiParty: 'PER_PARTY' },
    },
  };
  const MERGED = {
    ...SUGGEST,
    template: { id: 'u-gulecsoy', fields: OLD_T.template.fields },
    explain: [],
    preview: { ...SUGGEST.preview, fields: { musteri: 'GÜLEÇSOY', partiNo: 'P2618733', toplamMetre: '1234' }, fieldRects: { partiNo: { x: 195, y: 295, width: 100, height: 30 } } },
  };

  async function openEdit() {
    mockApi.getUserTemplate.mockResolvedValue({ ...OLD_T, versions: [] });
    mockApi.suggestTemplate.mockResolvedValue(MERGED);
    const r = renderWithPaper(<TeachEntry detail={detail('t-u1')} localPages={LOCAL} />);
    await waitFor(() => expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Tanımı düzenle/));
    await openGuided(r);
    await waitFor(() => expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1));
    // Çağrının yapılması yetmez: dönen önizleme (kayıtlı alan kutuları) çizilene kadar bekle (CI runInBand'de yarışıyordu).
    await waitFor(() => expect(r.getByTestId('tanit-kutu-6')).toHaveProp('accessibilityLabel', 'Parti No (kayıtlı)'));
    return r;
  }

  it('⭐ ② den açılır; kayıtlı alanlar "Önceki tanımdan" + değer; yeni atamasız Kaydet → PUT (alan kaybı yok, kural korunur)', async () => {
    const r = await openEdit();
    expect(r.getByTestId('tanit-asama-2')).toBeTruthy();
    expect(mockApi.suggestTemplate.mock.calls[0][0]).toMatchObject({ assignments: [], base: { code: 'u-gulecsoy', keep: [] }, rules: { multiParty: 'PER_PARTY' } });
    expect(r.getByTestId('tanit-adim-partiNo')).toHaveProp('accessibilityLabel', 'Gönderen parti no: önceki tanımdan');
    expect(r.getByTestId('tanit-onceki-partiNo')).toHaveTextContent('Önceki tanımdan');
    expect(r.getByTestId('tanit-adim-en')).toHaveProp('accessibilityLabel', 'En: atanmadı');
    expect(r.getByTestId('tanit-kutu-6')).toHaveProp('accessibilityLabel', 'Parti No (kayıtlı)');
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.updateUserTemplate).toHaveBeenCalledWith('u-gulecsoy', { expectedVersion: 2, name: 'kömürhan', template: MERGED.template });
  });

  it('⭐ "Kaldır" → base.drop; "Geri al" → drop düşer; ③ fabrika ayarına dönüş → rules.multiParty null', async () => {
    const r = await openEdit();
    await press(r.getByTestId('tanit-kaldir-partiNo'));
    expect(r.getByTestId('tanit-adim-partiNo')).toHaveProp('accessibilityLabel', 'Gönderen parti no: kaldırılacak');
    await waitFor(() => expect(lastSuggest().base).toEqual({ code: 'u-gulecsoy', keep: [], drop: ['partiNo'] }));
    await press(r.getByTestId('tanit-geri-al-partiNo'));
    await waitFor(() => expect(lastSuggest().base).toEqual({ code: 'u-gulecsoy', keep: [] }));
    await press(r.getByTestId('tanit-kaldir-toplamMetre'));
    await press(r.getByTestId('tanit-ileri'));
    expect(r.getByTestId('tanit-cok-parti-PER_PARTY')).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
    await press(r.getByTestId('tanit-cok-parti-FABRIKA'));
    await waitFor(() => expect(lastSuggest().rules).toEqual({ multiParty: null }));
    expect(lastSuggest().base.drop).toEqual(['toplamMetre']);
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.updateUserTemplate).toHaveBeenCalledTimes(1);
  });
});
