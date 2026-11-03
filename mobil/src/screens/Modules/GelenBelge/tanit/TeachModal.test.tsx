// Tablet tanıtma akışı (sahte API): kutuya dokun → alan ata → önizle gövdesi → kaydet (yeni POST + clientToken | güncelle PUT expectedVersion);
// bayat önizleme kaydı kapatır; telefonda / izinsiz / eski sunucuda giriş yok.
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithPaper } from '../../../../test/render';
import { useAuthStore } from '../../../../store/authStore';
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import TeachEntry from './TeachEntry';

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
const mockDevice = { type: 'tablet' as 'tablet' | 'phone' };
jest.mock('../../../../hooks/useDeviceType', () => ({ useDeviceType: () => mockDevice.type }));

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
  mockDevice.type = 'tablet';
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

async function openNew(r: ReturnType<typeof renderWithPaper>) {
  await flush();
  fireEvent.press(await r.findByTestId('tanit-ac'));
  await flush();
  expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
}

describe('TeachEntry + TeachModal (tablet)', () => {
  it('⭐ tanınmadı → yeni tip: kutuya dokun → Parti No → önizle gövdesi (OCR çerçevesi, hazır kimlik) → kaydet POST + clientToken', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    expect(await r.findByTestId('tanit-taninmadi')).toBeTruthy();
    expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Yeni tip tanıt/);
    await openNew(r);
    expect(mockApi.scanWords).toHaveBeenCalledWith('s1');

    fireEvent.changeText(r.getByTestId('tanit-ad'), 'Güleçsoy');

    await flush();
    await press(r.getByTestId('tanit-kutu-6'));
    expect(r.getByTestId('tanit-secili')).toHaveTextContent(/P2618733/);
    await press(r.getByTestId('tanit-alan-partiNo'));
    expect(r.getByTestId('tanit-atanan-f-partiNo')).toHaveTextContent(/P2618733/);
    // Önizlemesiz kayıt yok.
    expect(r.getByTestId('tanit-kaydet')).toBeDisabled();

    await press(r.getByTestId('tanit-onizle'));
    await flush();
    expect(mockApi.suggestTemplate).toHaveBeenCalledWith({
      scanId: 's1',
      name: 'Güleçsoy',
      assignments: [{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }],
      identifiers: ['GÜLEÇSOY BOYA', 'ÇEKİ LİSTESİ'],
    });
    expect(r.getByTestId('tanit-onizleme-eslesme')).toHaveTextContent(/tanınıyor/);
    expect(r.getByTestId('tanit-onizleme-alanlar')).toHaveTextContent(/P2618733/);

    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.createUserTemplate).toHaveBeenCalledTimes(1);
    const body = mockApi.createUserTemplate.mock.calls[0][0];
    expect(body).toMatchObject({ name: 'Güleçsoy', template: SUGGEST.template });
    expect(typeof body.clientToken).toBe('string');
    expect(body.clientToken.length).toBeGreaterThan(8);
    expect(mockApi.updateUserTemplate).not.toHaveBeenCalled();
  });

  it('tekrar eden bölüm: başlangıç yazısı seçimden + bölüm başına alan gövdeye girer', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openNew(r);
    fireEvent.changeText(r.getByTestId('tanit-ad'), 'Güleçsoy');
    await flush();
    await press(r.getByTestId('tanit-kutu-6'));
    await press(r.getByTestId('tanit-alan-partiNo'));
    fireEvent(r.getByTestId('tanit-tekrar'), 'valueChange', true);
    await flush();
    expect(r.getByTestId('tanit-eksikler')).toHaveTextContent(/başlangıç yazısını/);
    await press(r.getByTestId('tanit-kutu-4'));
    await press(r.getByTestId('tanit-kutu-5'));
    await press(r.getByTestId('tanit-bolum-secimden'));
    await press(r.getByTestId('tanit-onizle'));
    await flush();
    expect(mockApi.suggestTemplate.mock.calls[0][0]).toMatchObject({
      assignments: [{ field: 'partiNo', section: true }],
      sectionStartLabel: 'Ham PartiNo:',
    });
  });

  it('işaretleme önizlemeden sonra değişirse önizleme bayat, kayıt kapalı', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openNew(r);
    fireEvent.changeText(r.getByTestId('tanit-ad'), 'Güleçsoy');
    await flush();
    await press(r.getByTestId('tanit-kutu-6'));
    await press(r.getByTestId('tanit-alan-partiNo'));
    await press(r.getByTestId('tanit-onizle'));
    await flush();
    expect(r.getByTestId('tanit-kaydet')).not.toBeDisabled();
    await press(r.getByTestId('tanit-kutu-7'));
    await press(r.getByTestId('tanit-sutun-m'));
    expect(r.getByTestId('tanit-onizleme-bayat')).toBeTruthy();
    expect(r.getByTestId('tanit-kaydet')).toBeDisabled();
  });

});

describe('TeachEntry + TeachModal — güncelle ve görünürlük', () => {
  it('kullanıcı şablonuyla okunmuş belge → "Şablonu güncelle": eski kimlik hazır seçili, önizleme base ile, PUT önizlenen şablonu aynen gönderir', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail('t-u1')} localPages={LOCAL} />);
    await flush();
    expect(r.queryByTestId('tanit-taninmadi')).toBeNull();
    await waitFor(() => expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Şablonu güncelle/));
    await openNew(r);
    expect(mockApi.getUserTemplate).toHaveBeenCalledWith('u-gulecsoy');
    expect(r.getByTestId('tanit-baslik')).toHaveTextContent(/sürüm 2 → 3/);
    expect(r.getByTestId('tanit-kimlik-0')).toHaveTextContent(/ESKİ KİMLİK/);

    await press(r.getByTestId('tanit-kutu-6'));
    await press(r.getByTestId('tanit-alan-partiNo'));
    await press(r.getByTestId('tanit-onizle'));
    await flush();
    expect(mockApi.suggestTemplate.mock.calls[0][0].identifiers[0]).toBe('ESKİ KİMLİK');
    expect(mockApi.suggestTemplate.mock.calls[0][0].base).toEqual({ code: 'u-gulecsoy', keep: [] });
    expect(r.getByTestId('tanit-eski-alanlar')).toHaveTextContent(/tarih/);
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    expect(mockApi.createUserTemplate).not.toHaveBeenCalled();
    expect(mockApi.updateUserTemplate).toHaveBeenCalledWith('u-gulecsoy', { expectedVersion: 2, name: 'Güleçsoy', template: SUGGEST.template });
  });

});

describe('TeachEntry + TeachModal — güncelle kipi (s1b inceleme)', () => {
  it('eski tablo/bölüm varsayılan korunur; kutu kaldırılınca önizleme gövdesinin keep listesinden düşer', async () => {
    mockApi.getUserTemplate.mockResolvedValue({ ...USER_T, template: { ...USER_T.template, tables: [{ key: 'toplar' }], sections: { startLabels: ['X'], fields: ['tarih'] } }, versions: [] });
    const r = renderWithPaper(<TeachEntry detail={detail('t-u1')} localPages={LOCAL} />);
    await waitFor(() => expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Şablonu güncelle/));
    await openNew(r);
    expect(r.getByTestId('tanit-eski-tables')).toBeTruthy();
    await press(r.getByTestId('tanit-eski-sections'));
    await press(r.getByTestId('tanit-kutu-6'));
    await press(r.getByTestId('tanit-alan-partiNo'));
    await press(r.getByTestId('tanit-onizle'));
    await flush();
    expect(mockApi.suggestTemplate.mock.calls[0][0].base).toEqual({ code: 'u-gulecsoy', keep: ['tables'] });
  });

  it('⭐ aynı tablette ikinci güncelleme yeni sürümle gider (kayıt şablon önbelleğini tazeler; s1b inceleme)', async () => {
    // Uygulamadaki gibi önbellek kapanışta hemen silinmez (varsayılan gcTime) — bayat sürüm bu yüzden görünürdü.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
    // Sunucu gibi: PUT sürümü artırır, sonraki GET yeni sürümü döner.
    mockApi.updateUserTemplate.mockImplementation(async (_code: string, b: { expectedVersion: number }) => {
      mockApi.getUserTemplate.mockResolvedValue({ ...USER_T, version: b.expectedVersion + 1, versions: [] });
      return { ...USER_T, version: b.expectedVersion + 1 };
    });
    const r = renderWithPaper(<QueryClientProvider client={qc}><TeachEntry detail={detail('t-u1')} localPages={LOCAL} /></QueryClientProvider>);
    const round = async () => {
      await waitFor(() => expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Şablonu güncelle/));
      await openNew(r);
      expect(r.getByTestId('tanit-baslik')).toHaveTextContent(/Şablonu güncelle/);
      await press(r.getByTestId('tanit-kutu-6'));
      await press(r.getByTestId('tanit-alan-partiNo'));
      await press(r.getByTestId('tanit-onizle'));
      await flush();
      await press(r.getByTestId('tanit-kaydet'));
      await flush();
      await waitFor(() => expect(r.queryByTestId('tanit-kutu-6')).toBeNull());
    };
    await round();
    await round();
    expect(mockApi.updateUserTemplate.mock.calls.map((c) => c[1].expectedVersion)).toEqual([2, 3]);
    qc.clear();
  });

});

describe('TeachEntry + TeachModal — giriş ve görünürlük', () => {
  it('tanınmadı → "Bu belge hangi tip?" listeden seç → o şablon bu belgeyle güncellenir', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await press(await r.findByTestId('tanit-listeden'));
    await press(await r.findByText('Güleçsoy'));
    expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
    expect(mockApi.getUserTemplate).toHaveBeenCalledWith('u-gulecsoy');
    expect(r.getByTestId('tanit-baslik')).toHaveTextContent(/Şablonu güncelle — Güleçsoy/);
  });

  it('telefonda, izinsizde ve eski sunucuda (tarama yok) giriş çizilmez', async () => {
    mockDevice.type = 'phone';
    const a = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await flush();
    expect(a.queryByTestId('tanit-giris')).toBeNull();
    a.unmount();

    mockDevice.type = 'tablet';
    setPerms(['gelen-belge:read', 'gelen-belge:write']);
    const b = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await flush();
    expect(b.queryByTestId('tanit-giris')).toBeNull();
    b.unmount();

    setPerms(['gelen-belge:read', 'gelen-belge:template']);
    const c = renderWithPaper(<TeachEntry detail={{ id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: null }} localPages={LOCAL} />);
    await flush();
    expect(c.queryByTestId('tanit-giris')).toBeNull();
    expect(mockApi.listUserTemplates).not.toHaveBeenCalled();
  });
});
