// Dar ekran (el terminali ~384dp) tek İE formu: belge satırında en çok iki ikon, fazlası "⋯" menüsünde; gelen kumaş/renk
// kutusu küçülmeden 2 satıra sarar; alt çubukta ipucu düğmenin üstünde tam metin, düğme tam genişlik. Tablet (800dp) değişmez.
// Negatif sonda: `isCompactWidth` hep false → bu dosyanın dar vakaları kırmızı.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ReadWatch } from '../readResult';
import { clearLocalPages, rememberLocalPages } from '../tanit/localPages';
import DocRowCard, { type DocRowOpenRequest } from './DocRowCard';
import CreateBar from './CreateBar';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

let mockDims = { width: 384, height: 640, scale: 1, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
// AppMenu çapayı measureInWindow ile ölçer (jest'te geri çağrı yok): açıkken öğeleri düz çiz.
jest.mock('../../../../components/AppMenu', () => {
  const { Text } = jest.requireActual('react-native');
  function Menu(p: { visible: boolean; anchor: React.ReactNode; children: React.ReactNode }) {
    return <>{p.anchor}{p.visible ? p.children : null}</>;
  }
  function MenuItem(p: { title: string; onPress: () => void; testID?: string }) {
    return <Text testID={p.testID} onPress={p.onPress}>{p.title}</Text>;
  }
  Menu.Item = MenuItem;
  return { __esModule: true, default: Menu };
});
let mockWatch: ReadWatch | null = null;
jest.mock('../useReadResult', () => ({ useReadResult: () => ({ watch: mockWatch, recheck: jest.fn() }) }));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }), approvalDetailKey: (id: string) => ['onay', id] }));
// Parti özeti sorgusu ağa çıkmasın (tam koşumda gecikmeli hata başka testin ortasında patlıyordu); sonuç beklemede kalır.
jest.mock('../../../../services/inboundDoc.service', () => {
  const actual = jest.requireActual('../../../../services/inboundDoc.service');
  return { ...actual, inboundDocService: { ...actual.inboundDocService, noteParties: () => new Promise(() => undefined) } };
});
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));
jest.mock('../../../../components/ModuleSheet', () => {
  const actual = jest.requireActual('../../../../components/ModuleSheet');
  return { ...actual, __esModule: true, default: (p: { visible: boolean; children: React.ReactNode }) => (p.visible ? <>{p.children}</> : null) };
});
jest.mock('../../../../components/PickerModal', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { visible: boolean; title: string }) => (p.visible ? <Text testID={`secici-${p.title}`}>{p.title}</Text> : null) };
});

const READ_NO_LINES = {
  noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ', reason: 'Sayfa okundu ama satır çıkmadı; panelden yeniden okutun.',
  pages: { total: 1, waiting: 0, read: 1, failed: 0 }, lineCount: 0, reviewCount: 0,
};
const done = (tanitim?: unknown): ReadWatch => ({ phase: 'done', summary: { ...READ_NO_LINES, tanitim } } as unknown as ReadWatch);

const baseForm: RowForm = {
  ownerCustomerId: null, ownerSuggested: null, ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  customerBatchNo: '2008-58', customerBatchNoFromDoc: true, meters: 250, metersReview: false, gramajValueId: null,
};
const detail = {
  id: 'n1', noteNo: 'GB-1', status: 'DRAFT', kursunMeters: '250', batchNoCandidates: [],
  scans: [{ id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' }],
};

function draw(opts: { variant?: 'list' | 'single'; form?: Partial<RowForm>; onReread?: () => void; onPreview?: () => void; req?: DocRowOpenRequest | null } = {}) {
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, form: { ...baseForm, ...opts.form }, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false, catalog: { propertyId: null, options: [] },
    batchSource: 'SERIES', updateForm: jest.fn(), rereadRow: jest.fn(), applyTaught: jest.fn(),
  } as unknown as WoRowsState;
  const el = (req?: DocRowOpenRequest | null) => (
    <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} variant={opts.variant} onReread={opts.onReread} onPreview={opts.onPreview} openRequest={req} />
  );
  const ui = renderWithPaper(el(opts.req));
  return { ui, rerender: (req: DocRowOpenRequest | null) => ui.rerender(el(req)) };
}


beforeEach(() => {
  mockWatch = done();
  mockDims = { width: 384, height: 640, scale: 1, fontScale: 1 };
  clearLocalPages();
});

describe('DocHeadBand — dar ekran ⋯ menüsü', () => {
  it('⭐ 3+ eylemde yalnız Yeniden okut ikon, önizle/şablon/iptal ⋯ menüsünde; menüden önizle çağrılır', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ durum: 'TANITILDI', sablonKodu: 'u-g', sablonAdi: 'Güleçsoy' });
    const onPreview = jest.fn();
    const { ui } = draw({ variant: 'single', onReread: jest.fn(), onPreview });
    const band = within(ui.getByTestId('ie-serit-belge'));
    expect(band.getByTestId('ie-belge-yeniden-okut')).toBeTruthy();
    expect(band.getByTestId('ie-belge-menu')).toBeTruthy();
    expect(ui.queryByTestId('ie-belge-onizle')).toBeNull();
    expect(ui.queryByTestId('tanit-serit-guncelle')).toBeNull();
    expect(ui.queryByTestId('ie-belge-taslak-iptal')).toBeNull();
    expect(ui.queryByTestId('tanit-sablon')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-belge-menu'));
    expect(ui.getByTestId('tanit-serit-guncelle')).toBeTruthy();
    expect(ui.getByTestId('ie-belge-taslak-iptal')).toBeTruthy();
    fireEvent.press(ui.getByTestId('ie-belge-onizle'));
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('iki eylemde menü yok, ikisi de ikon', () => {
    const { ui } = draw({ variant: 'single', onReread: jest.fn() });
    expect(ui.getByTestId('ie-belge-yeniden-okut')).toBeTruthy();
    expect(ui.getByTestId('ie-belge-taslak-iptal')).toBeTruthy();
    expect(ui.queryByTestId('ie-belge-menu')).toBeNull();
  });

  it('tablette (800dp) dört ikon yan yana, menü yok', () => {
    mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ durum: 'TANITILDI', sablonKodu: 'u-g', sablonAdi: 'Güleçsoy' });
    const { ui } = draw({ variant: 'single', onReread: jest.fn(), onPreview: jest.fn() });
    expect(ui.queryByTestId('ie-belge-menu')).toBeNull();
    for (const id of ['ie-belge-yeniden-okut', 'ie-belge-onizle', 'tanit-serit-guncelle', 'ie-belge-taslak-iptal']) expect(ui.getByTestId(id)).toBeTruthy();
  });
});

const props = (n: { numberOfLines?: number; adjustsFontSizeToFit?: boolean }) => ({ lines: n.numberOfLines, fit: !!n.adjustsFontSizeToFit });

describe('Gelen kumaş/renk — dar ekranda sarar', () => {
  it('⭐ dar: küçülmez, en çok 2 satır, satırı tek başına kaplar', () => {
    const { ui } = draw({ variant: 'single' });
    const v = ui.getByTestId('belge-gelen-kumas-GB-1-deger');
    expect(props(v.props)).toEqual({ lines: 2, fit: false });
    expect(StyleSheet.flatten(ui.getByTestId('belge-gelen-kumas-GB-1').props.style).flexBasis).toBe('100%');
  });
  it('tablet: bugünkü tek satır + küçülme', () => {
    mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
    const { ui } = draw({ variant: 'single' });
    expect(props(ui.getByTestId('belge-gelen-kumas-GB-1-deger').props)).toEqual({ lines: 1, fit: true });
  });
});

describe('CreateBar — dar ekran', () => {
  const saver = { saving: false, mode: 'WITH_WORK_ORDER' as const, saveAll: jest.fn(), counts: { ready: 1 } };
  const bar = () => renderWithPaper(<CreateBar wo={saver} done={false} block={null} missing={[]} onMissing={jest.fn()} onNew={jest.fn()} pad={12} />);
  it('⭐ dikey: ipucu üstte tam metin (satır sınırı yok), düğme tam genişlik', () => {
    const ui = bar();
    expect(StyleSheet.flatten(ui.getByTestId('ie-form-alt-dar').props.style).flexDirection).toBe('column');
    expect(ui.getByTestId('ie-form-ipucu').props.numberOfLines).toBeUndefined();
    expect(ui.getByTestId('ie-form-ipucu')).toHaveTextContent('Hazır — kontrol edip oluşturun');
  });
  it('tablet: yan yana, ipucu en çok 2 satır', () => {
    mockDims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
    const ui = bar();
    expect(ui.queryByTestId('ie-form-alt-dar')).toBeNull();
    expect(ui.getByTestId('ie-form-ipucu').props.numberOfLines).toBe(2);
  });
});
