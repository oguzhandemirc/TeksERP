// DocRowCard kipleri (İE oluştur yeniden tasarım Dilim 2): toplu görünüm (`list`) kart + "Listeden çıkar" + madde listesi;
// tek form (`single`) şeritsiz — belge tek satır (no + durum ikonu, Yeniden okut / iptal ikonları, şablon düğmesi aynı satırda);
// alan durumu seçicinin çerçevesinde. Alt çubuk isteği (`openRequest`) müşteri seçicisini / metre sayfasını açar.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { colors } from '../../../../theme';
import type { ReadWatch } from '../readResult';
import { clearLocalPages, rememberLocalPages } from '../tanit/localPages';
import DocRowCard, { type DocRowOpenRequest } from './DocRowCard';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

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

function draw(opts: { variant?: 'list' | 'single'; form?: Partial<RowForm>; onReread?: () => void; req?: DocRowOpenRequest | null } = {}) {
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, form: { ...baseForm, ...opts.form }, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false, catalog: { propertyId: null, options: [] },
    batchSource: 'SERIES', updateForm: jest.fn(), rereadRow: jest.fn(), applyTaught: jest.fn(),
  } as unknown as WoRowsState;
  const el = (req?: DocRowOpenRequest | null) => (
    <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} variant={opts.variant} onReread={opts.onReread} openRequest={req} />
  );
  const ui = renderWithPaper(el(opts.req));
  return { ui, rerender: (req: DocRowOpenRequest | null) => ui.rerender(el(req)) };
}
const borderColor = (ui: ReturnType<typeof renderWithPaper>, testID: string) =>
  (StyleSheet.flatten(ui.getByTestId(testID).props.style) as { borderColor?: string }).borderColor;

beforeEach(() => {
  mockWatch = done();
  clearLocalPages();
});

describe('DocRowCard — list / single', () => {
  it('⭐ list (toplu): "Listeden çıkar" ve eksik maddeleri var', () => {
    const { ui } = draw();
    expect(ui.getByTestId('belge-satir-cikar-GB-1')).toBeTruthy();
    expect(ui.getByText('• Müşteriyi seçin.')).toBeTruthy();
    expect(ui.getByTestId('belge-serit-musteri-GB-1-durum')).toHaveTextContent(/Seçin$/);
  });

  it('⭐ single (tek form): çıkar, madde ve şerit yok; belge satırı ✓ (yazısız), "satır çıkmadı" metni yok; Yeniden okut çağrılır', () => {
    const onReread = jest.fn();
    const { ui } = draw({ variant: 'single', onReread });
    expect(ui.queryByTestId('belge-satir-cikar-GB-1')).toBeNull();
    expect(ui.queryByText('Listeden çıkar')).toBeNull();
    expect(ui.queryByText(/Müşteriyi seçin\./)).toBeNull();
    expect(ui.queryByText(/satır çıkmadı/)).toBeNull();
    expect(ui.queryByTestId('ie-serit-musteri')).toBeNull();
    expect(ui.queryByTestId('ie-serit-parti')).toBeNull();
    expect(ui.getByTestId('ie-serit-belge')).toHaveTextContent(/GB-1/);
    expect(ui.queryByTestId('ie-serit-belge-durum')).toBeNull();
    expect(borderColor(ui, 'belge-satir-musteri-GB-1')).toBe(colors.danger);
    expect(ui.getByTestId('ie-belge-taslak-iptal')).toBeTruthy();
    fireEvent.press(ui.getByTestId('ie-belge-yeniden-okut'));
    expect(onReread).toHaveBeenCalledTimes(1);
  });

  it('⭐ TANITILDI: "Tanımı düzenle" belge satırında, şablon adıyla aynı satır', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ durum: 'TANITILDI', sablonKodu: 'u-g', sablonAdi: 'Güleçsoy' });
    const { ui } = draw({ variant: 'single', onReread: jest.fn() });
    const sub = within(ui.getByTestId('ie-serit-belge'));
    expect(sub.getByTestId('tanit-serit-guncelle')).toBeTruthy();
    expect(sub.getByTestId('tanit-sablon')).toHaveTextContent(/Güleçsoy/);
    expect(sub.getByTestId('tanit-sablon')).not.toHaveTextContent(/Şablon/);
  });

  it('⭐ müşteri seçili → düz çerçeve + ad; belgede geçen ad sorusu bekliyorsa sarı çerçeve + soru çipi', () => {
    const a = draw({ variant: 'single', form: { ownerCustomerId: 'c1' } }).ui;
    expect(a.getByTestId('belge-satir-musteri-GB-1')).toHaveTextContent(/Gülkesim/);
    expect(borderColor(a, 'belge-satir-musteri-GB-1')).toBe(colors.borderStrong);
    const ask = { customerId: 'c1', name: 'Gülkesim', matchedText: 'GULKESIM' };
    const { ui } = draw({ variant: 'single', form: { ownerAsk: ask } as Partial<RowForm> });
    expect(borderColor(ui, 'belge-satir-musteri-GB-1')).toBe(colors.warning);
    expect(ui.getByTestId('belge-satir-sahip-sor-GB-1')).toBeTruthy();
  });

  it('⭐ metre: yok → "Yok — dokunun" (kırmızı, tek satır); doğrulama bekliyor → "Doğru" + kısa ipucu (şerit yok)', () => {
    const a = draw({ variant: 'single', form: { meters: null } }).ui;
    expect(a.getByTestId('belge-satir-metre-kutu-GB-1-deger')).toHaveTextContent(/^Yok — dokunun$/);
    const b = draw({ variant: 'single', form: { metersReview: true } }).ui;
    expect(b.getByTestId('belge-satir-dogrula-GB-1')).toHaveTextContent(/Doğru$/);
    expect(b.getByText('Metreyi belgeyle karşılaştırın.')).toBeTruthy();
  });

  it('⭐ openRequest: ilk çizimde açmaz; seq artınca müşteri seçicisi / metre sayfası açılır', () => {
    const { ui, rerender } = draw({ variant: 'single', req: { kind: 'owner', seq: 1 } });
    expect(ui.queryByTestId('secici-Belgenin sahibi')).toBeNull();
    rerender({ kind: 'owner', seq: 2 });
    expect(ui.getByTestId('secici-Belgenin sahibi')).toBeTruthy();
    rerender({ kind: 'meter', seq: 3 });
    expect(ui.getByTestId('belge-satir-metre-giris')).toBeTruthy();
  });
});
