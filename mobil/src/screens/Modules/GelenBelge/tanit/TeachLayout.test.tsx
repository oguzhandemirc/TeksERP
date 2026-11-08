// "Tanımı düzenle" yeniden tasarımı — dört pencere boyunda (telefon dik/yatay, tablet yatay/dik) doğru düzen; alan listesinde
// kayıtlı alan ✓ + belgeden okunan değer + fosforlu vurgu, atanmamış alan "Ata"; Kaydet çubuğu kaydırmanın dışında.
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { useAuthStore } from '../../../../store/authStore';
import type { ScanWord, ScanWords } from '../../../../types/inboundDocTeach';
import { DocHighlight, DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import TeachEntry from './TeachEntry';
import { teachLayout } from './teachLayout';

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

const mockWindow = { width: 1280, height: 800 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 2, fontScale: 1 }),
}));

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
const OLD_T = {
  id: 't-u1', code: 'u-gulecsoy', name: 'kömürhan', version: 2, isActive: true, updatedAt: '2026-11-01T00:00:00Z',
  template: { fields: [{ key: 'musteri' }, { key: 'partiNo', strategies: [{ kind: 'anchor', maxWords: 1 }] }, { key: 'toplamMetre' }], identifiers: { keywords: ['GÜLEÇSOY BOYA'] } },
};
const MERGED = {
  template: { id: 'u-gulecsoy', fields: OLD_T.template.fields },
  explain: [],
  errors: [],
  preview: { matched: true, score: 1, lineCount: 4, warnings: [], fields: { musteri: 'GÜLEÇSOY', partiNo: 'P2618733', toplamMetre: '1234' }, fieldRects: { partiNo: { x: 195, y: 295, width: 100, height: 30 } } },
};
const DETAIL = {
  id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: null, templateId: 't-u1',
  scans: [{ id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' }],
};
const LOCAL = [{ sha256: 'aa', uri: 'file:///1.jpg' }];
const flush = () => act(async () => {});

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.scanWords.mockResolvedValue(SCAN);
  mockApi.suggestTemplate.mockResolvedValue(MERGED);
  mockApi.listUserTemplates.mockResolvedValue([OLD_T]);
  mockApi.getUserTemplate.mockResolvedValue({ ...OLD_T, versions: [] });
  act(() => useAuthStore.setState({ user: { permissions: ['gelen-belge:read', 'gelen-belge:template'] } as never }));
});
afterEach(() => act(() => useAuthStore.setState({ user: null })));

describe('teachLayout (saf)', () => {
  it.each([
    [390, 844, 'stack'],
    [844, 390, 'stack'],
    [1280, 800, 'side'],
    [800, 1280, 'stack'],
  ] as const)('%i×%i → %s', (width, height, mode) => {
    const l = teachLayout(width, height);
    expect(l.mode).toBe(mode);
    if (l.mode === 'side') expect(l.imageWidth).toBeLessThan(width);
    else expect(l.imageHeight).toBeLessThan(height / 2);
  });
});

describe('Tanımı düzenle — dört boyutta düzen + kayıtlı alanlar', () => {
  it.each([
    [390, 844, 'tanit-duzen-ust'],
    [844, 390, 'tanit-duzen-ust'],
    [1280, 800, 'tanit-duzen-yan'],
    [800, 1280, 'tanit-duzen-ust'],
  ] as const)('%i×%i → %s; kayıtlı alan ✓ + değer + sarı vurgu, atanmamış "Ata", Kaydet görünür', async (width, height, layoutId) => {
    Object.assign(mockWindow, { width, height });
    const r = renderWithPaper(<TeachEntry detail={DETAIL} localPages={LOCAL} />);
    await flush();
    await waitFor(() => expect(r.getByTestId('tanit-ac')).toHaveTextContent(/Tanımı düzenle/));
    fireEvent.press(r.getByTestId('tanit-ac'));
    await flush();
    expect(await r.findByTestId('tanit-kutu-6')).toBeTruthy();
    await waitFor(() => expect(mockApi.suggestTemplate).toHaveBeenCalledTimes(1));
    await flush();

    expect(r.getByTestId(layoutId)).toBeTruthy();
    expect(r.queryByTestId(layoutId === 'tanit-duzen-yan' ? 'tanit-duzen-ust' : 'tanit-duzen-yan')).toBeNull();
    expect(r.getByTestId('tanit-surum')).toHaveTextContent('v2 → 3');

    // Kayıtlı alan: ✓ (kayıtlı) + okunan değer, fosforlu kalem vurgusu içinde.
    const row = r.getByTestId('tanit-adim-partiNo');
    expect(row).toHaveProp('accessibilityLabel', 'Parti no: kayıtlı');
    expect(r.getByTestId('tanit-deger-partiNo')).toHaveTextContent('P2618733');
    const hl = r.UNSAFE_getAllByType(DocHighlight).find((n) => within(n).queryByTestId('tanit-deger-partiNo'));
    expect(hl?.props.active).toBe(true);
    expect(StyleSheet.flatten((hl!.children[0] as { props: { style: StyleProp<ViewStyle> } }).props.style)).toMatchObject({ backgroundColor: DOC_HIGHLIGHT_BG });
    expect(within(row).getByTestId('tanit-deger-partiNo')).toBeTruthy();
    expect(r.getByTestId('tanit-deger-toplamMetre')).toHaveTextContent('1234');

    // Atanmamış alan: değer yok, "Ata".
    const en = r.getByTestId('tanit-adim-en');
    expect(en).toHaveProp('accessibilityLabel', 'En: atanmadı');
    expect(within(en).queryByTestId('tanit-deger-en')).toBeNull();
    expect(within(en).getByText('Ata')).toBeTruthy();

    // Kaydet çubuğu kaydırılan panelin dışında, ilk adımda da etkin.
    const bar = r.getByTestId('tanit-kaydet-cubugu');
    expect(within(bar).getByTestId('tanit-kaydet')).not.toBeDisabled();
    expect(within(bar).getByTestId('tanit-kaydet')).toHaveTextContent(/Tanımı kaydet/);
  });
});
