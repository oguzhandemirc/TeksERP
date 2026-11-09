// Tanıtmada Döndür (yalnız görüntü): kutu dönmüş konumda çizilir, dokunma aynı kelimeyi seçer, öneri/kayıt gövdesi 0° ile aynı;
// iki kipte de çalışır. Kurulum TeachModal.test.tsx ile aynı sahte API.
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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

async function openNew(r: ReturnType<typeof renderWithPaper>) {
  await flush();
  fireEvent.press(await r.findByTestId('tanit-ac'));
  await flush();
  expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
  // Varsayılan rehberli kip; bu dosya serbest kipi sınar.
  await press(r.getByTestId('tanit-gelismis'));
  expect(r.getByTestId('tanit-panel')).toBeTruthy();
}

describe('TeachModal — Döndür', () => {
  // Döndür yalnız görüntü: kutu dönmüş konumda çizilir, dokunma aynı kelimeyi seçer, öneri/kayıt gövdesi 0° ile birebir aynı.
  async function teachWithTurns(turns: number) {
    for (const f of [mockApi.suggestTemplate, mockApi.createUserTemplate]) f.mockClear();
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await openNew(r);
    fireEvent(r.getByTestId('tanit-foto-cerceve'), 'layout', { nativeEvent: { layout: { width: 1500, height: 1500 } } });
    await flush();
    for (let i = 0; i < turns; i++) await press(r.getByTestId('tanit-dondur'));
    const box = StyleSheet.flatten(r.getByTestId('tanit-kutu-6').props.style);
    const foto = StyleSheet.flatten(r.getByTestId('tanit-foto').props.style);
    fireEvent.changeText(r.getByTestId('tanit-ad'), 'Güleçsoy');
    await flush();
    await press(r.getByTestId('tanit-kutu-6'));
    expect(r.getByTestId('tanit-secili')).toHaveTextContent(/P2618733/);
    await press(r.getByTestId('tanit-alan-partiNo'));
    await press(r.getByTestId('tanit-onizle'));
    await flush();
    await press(r.getByTestId('tanit-kaydet'));
    await flush();
    const { clientToken: _t, ...saved } = mockApi.createUserTemplate.mock.calls[0][0];
    r.unmount();
    return { box, foto, suggest: mockApi.suggestTemplate.mock.calls[0][0], saved };
  }

  it('Döndür: kutular ve fotoğraf 90° döner, dokunma doğru kelimeyi seçer, şablon gövdesi döndürmeden bağımsız', async () => {
    const a = await teachWithTurns(0);
    const b = await teachWithTurns(1);
    // k = 1 (1500×1500 bölme): photoRect (1200,2300,90×20) → 90° saat yönü: x = 1500 − 2300 − 20, y = 1200, en/boy yer değiştirir.
    expect(a.box).toMatchObject({ left: 1200, top: 2300, width: 90, height: 20 });
    expect(b.box).toMatchObject({ left: -820, top: 1200, width: 20, height: 90 });
    expect(a.foto.transform).toEqual([{ rotate: '0deg' }]);
    expect(b.foto.transform).toEqual([{ rotate: '90deg' }]);
    expect(b.suggest).toEqual(a.suggest);
    expect(b.suggest.assignments).toEqual([{ field: 'partiNo', rect: { x: 200, y: 300, width: 90, height: 20 } }]);
    expect(b.saved).toEqual(a.saved);
  });

  it('Döndür rehberli kipte de var; dört basış başa döner', async () => {
    const r = renderWithPaper(<TeachEntry detail={detail(null)} localPages={LOCAL} />);
    await flush();
    fireEvent.press(await r.findByTestId('tanit-ac'));
    await flush();
    expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
    fireEvent(r.getByTestId('tanit-foto-cerceve'), 'layout', { nativeEvent: { layout: { width: 1500, height: 1500 } } });
    await flush();
    for (let i = 0; i < 4; i++) await press(r.getByTestId('tanit-dondur'));
    expect(StyleSheet.flatten(r.getByTestId('tanit-kutu-6').props.style)).toMatchObject({ left: 1200, top: 2300 });
    expect(StyleSheet.flatten(r.getByTestId('tanit-foto').props.style).transform).toEqual([{ rotate: '0deg' }]);
  });
});
