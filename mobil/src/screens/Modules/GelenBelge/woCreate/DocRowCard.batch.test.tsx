// Belgeden İE satırı — parti no (Gülkesim istek 2) ve kurşun gramajı (istek 3).
// Müşteri parti no düz metin alanıdır: belgeden geldiyse dolu + sarı vurgu, dokununca seçici AÇILMAZ, yazınca vurgu kalkar.
// Bizim parti no seri kipinde müşteri alanıyla aynı outlined salt okunur kutu "Otomatik · sıradaki: X" (önizleme yoksa
// "Otomatik"); belgeden kipinde aday seçicisi bugünkü gibi.
// Negatif sonda: BatchFields müşteri alanı kaldırılınca / vurgu her zaman kapalıyken / editCustomerBatchNo vurguyu
// düşürmeyince / seçili gramaj stili kaldırılınca ilgili vaka kırmızı.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { colors } from '../../../../theme';
import DocRowCard from './DocRowCard';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

jest.mock('../useReadResult', () => ({ useReadResult: () => ({ watch: null, recheck: jest.fn() }) }));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }) }));
const mockNumberState = jest.fn();
jest.mock('../../../../services/batch.service', () => ({ batchService: { getNumberPreview: (n: number) => mockNumberState(n) } }));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));

beforeEach(() => {
  mockNumberState.mockReset();
  mockNumberState.mockResolvedValue({ success: true, data: { enabled: false, lastCode: null, nextCode: null, min: 1, max: 99 } });
});

const baseForm: RowForm = {
  ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  customerBatchNo: '2008-58', customerBatchNoFromDoc: true, meters: 250, metersReview: false, gramajValueId: 'g1',
};
const detail = {
  id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: 'c1', kursunMeters: '250', customerBatchNo: '2008-58',
  batchNoCandidates: [{ kind: 'BATCH', key: 'partiNo', value: '2008-58' }, { kind: 'DOC', key: 'evrakNo', value: 'E-77' }],
};
const catalog = { propertyId: 'p1', options: [{ id: 'g1', name: '25 gr', isDefault: true }, { id: 'g2', name: '30 gr', isDefault: false }] };

function Harness({ batchSource, form = baseForm, cands }: { batchSource: 'SERIES' | 'DOCUMENT' | null; form?: RowForm; cands?: number }) {
  const [f, setF] = useState<RowForm>(form);
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: (cands === undefined ? detail : { ...detail, batchNoCandidates: detail.batchNoCandidates.slice(0, cands) }) as never, form: f, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: true, catalog, batchSource,
    updateForm: (_id: string, patch: Partial<RowForm>) => setF((x) => ({ ...x, ...patch })),
  } as unknown as WoRowsState;
  return <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} />;
}

type Node = { props: { style?: unknown }; parent: unknown };
const bg = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor;
/** Paper TextInput'un vurgu stili dış sarmalayıcıya iner: testID'li yerli girdinin atalarında arka plan aranır. */
function highlighted(ui: ReturnType<typeof renderWithPaper>, testID: string): boolean {
  let n: Node | null = ui.getByTestId(testID) as unknown as Node;
  while (n) {
    if (bg(n) === DOC_HIGHLIGHT_BG) return true;
    n = n.parent as Node | null;
  }
  return false;
}

/** Paper Chip testID'yi iç düğüme verir: kendisi + ilk 4 atasının düz stilleri. */
function ancestorStyles(ui: ReturnType<typeof renderWithPaper>, testID: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let n: Node | null = ui.getByTestId(testID) as unknown as Node;
  for (let i = 0; n && i < 5; i++, n = n.parent as Node | null) out.push((StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>);
  return out;
}

describe('DocRowCard — müşteri parti no ayrı, elle yazılabilir alan', () => {
  it('⭐ belgeden okunan değer dolu gelir ve sarı vurgulu', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    expect(ui.getByTestId('belge-satir-musteri-parti-GB-1').props.value).toBe('2008-58');
    expect(highlighted(ui, 'belge-satir-musteri-parti-GB-1')).toBe(true);
  });
  it('⭐ dokununca seçici açılmaz (düz metin girişi)', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    fireEvent(ui.getByTestId('belge-satir-musteri-parti-GB-1'), 'focus');
    fireEvent.press(ui.getByTestId('belge-satir-musteri-parti-GB-1'));
    expect(ui.queryByText(/aday/)).toBeNull();
    expect(ui.queryByText('Parti no seçin')).toBeNull();
  });
  it('⭐ düzenleyince vurgu kalkar, yazılan değer kalır', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    fireEvent.changeText(ui.getByTestId('belge-satir-musteri-parti-GB-1'), '2008-59');
    expect(ui.getByTestId('belge-satir-musteri-parti-GB-1').props.value).toBe('2008-59');
    expect(highlighted(ui, 'belge-satir-musteri-parti-GB-1')).toBe(false);
  });
  it('belgede yoksa boş ve vurgusuz; elle yazılabilir', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" form={{ ...baseForm, customerBatchNo: null, customerBatchNoFromDoc: false }} />);
    expect(ui.getByTestId('belge-satir-musteri-parti-GB-1').props.value).toBe('');
    expect(highlighted(ui, 'belge-satir-musteri-parti-GB-1')).toBe(false);
    fireEvent.changeText(ui.getByTestId('belge-satir-musteri-parti-GB-1'), 'EL-1');
    expect(ui.getByTestId('belge-satir-musteri-parti-GB-1').props.value).toBe('EL-1');
  });
  it('⭐ seri kipinde bizim parti no: outlined salt okunur "Otomatik · sıradaki: P05" (tek tahmin istenir)', async () => {
    mockNumberState.mockResolvedValue({ success: true, data: { enabled: true, lastCode: 'P04', nextCode: 'P05', nextCodes: ['P05'], min: 1, max: 99 } });
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    const box = ui.getByTestId('belge-satir-bizim-parti-GB-1');
    expect(box.props.editable).toBe(false);
    await waitFor(() => expect(ui.getByTestId('belge-satir-bizim-parti-GB-1').props.value).toBe('Otomatik · sıradaki: P05'));
    expect(mockNumberState).toHaveBeenCalledWith(1);
  });
  it('önizleme düşerse (çevrimdışı / izin) yalnız "Otomatik"', async () => {
    mockNumberState.mockRejectedValue(new Error('Network Error'));
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    await waitFor(() => expect(mockNumberState).toHaveBeenCalled());
    expect(ui.getByTestId('belge-satir-bizim-parti-GB-1').props.value).toBe('Otomatik');
  });
  it('belgeden kipinde bizim parti no aday seçicisi (bugünkü davranış)', () => {
    const ui = renderWithPaper(<Harness batchSource="DOCUMENT" />);
    expect(ui.queryByTestId('belge-satir-bizim-parti-GB-1')).toBeNull();
    expect(mockNumberState).not.toHaveBeenCalled();
    expect(ui.getByText('Bizim parti no seçin (2 aday)')).toBeTruthy();
  });
  it('belgeden kipinde tek/sıfır adayda "otomatik" yazmaz (numara kâğıttan gelir)', () => {
    expect(renderWithPaper(<Harness batchSource="DOCUMENT" cands={1} />).getByText('Bizim parti no: belgeden')).toBeTruthy();
    expect(renderWithPaper(<Harness batchSource="DOCUMENT" cands={0} />).getByText('Bizim parti no: belgede bulunamadı')).toBeTruthy();
  });
});

describe('DocRowCard — vurgu ve seçili gramaj', () => {
  it('⭐ okunan kurşun metresi sarı; elle değişince vurgu kalkar', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    expect(bg(ui.getByTestId('belgeden-metre-GB-1'))).toBe(DOC_HIGHLIGHT_BG);
    const ui2 = renderWithPaper(<Harness batchSource="SERIES" form={{ ...baseForm, meters: 300 }} />);
    expect(ui2.queryByTestId('belgeden-metre-GB-1')).toBeNull();
  });
  it('⭐ seçili gramaj marka zeminli; seçili olmayan değil', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    const on = ancestorStyles(ui, 'belge-satir-gramaj-GB-1-25 gr');
    const off = ancestorStyles(ui, 'belge-satir-gramaj-GB-1-30 gr');
    expect(on.some((x) => x.backgroundColor === colors.choice.onBg)).toBe(true);
    expect(off.some((x) => x.backgroundColor === colors.choice.onBg)).toBe(false);
  });
});

// Gece notu (2026-11-09) regresyonu: çok partide SINGLE = tek İE → TEK parti numarası (count=1, formun üstünde bir kez);
// PER_PARTY → parti sayısı kadar ardışık tahmin. Negatif sonda: SINGLE'da count = parti sayısı → ilk vaka kırmızı.
describe('DocRowCard — çok partide bizim parti no önizlemesi', () => {
  const party = (blockNo: number) => ({ blockNo, batchNo: `M${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 1, meters: 100, weightKg: null, warnings: [] });
  function MultiHarness({ mode }: { mode: 'SINGLE' | 'PER_PARTY' }) {
    const view = { parties: [party(1), party(2), party(3)], warnings: [], multi: true, defaultMode: mode };
    const multi = { mode, defaultMode: mode, rows: view.parties.map((p) => ({ blockNo: p.blockNo, batchNo: p.batchNo, meters: 100 })) };
    const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, form: { ...baseForm, multi }, parties: view as never, gramajTouched: false, result: null };
    const wo = { setDetail: jest.fn(), setParties: jest.fn(), setMulti: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false, catalog, batchSource: 'SERIES', updateForm: jest.fn() } as unknown as WoRowsState;
    return <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} />;
  }
  it('⭐ SINGLE: tek numara istenir ve bir kez gösterilir (parti başına alan yok)', async () => {
    mockNumberState.mockResolvedValue({ success: true, data: { enabled: true, lastCode: 'P04', nextCode: 'P05', nextCodes: ['P05'], min: 1, max: 99 } });
    const ui = renderWithPaper(<MultiHarness mode="SINGLE" />);
    await waitFor(() => expect(ui.getByTestId('belge-parti-bizim-tek-GB-1').props.value).toBe('Otomatik · sıradaki: P05'));
    expect(mockNumberState).toHaveBeenCalledWith(1);
    expect(mockNumberState).not.toHaveBeenCalledWith(3);
    expect(ui.queryByTestId('belge-parti-bizim-GB-1-1', { includeHiddenElements: true })).toBeNull();
  });
  it('⭐ PER_PARTY: parti sayısı kadar ardışık tahmin, parti başına', async () => {
    mockNumberState.mockResolvedValue({ success: true, data: { enabled: true, lastCode: 'P04', nextCode: 'P05', nextCodes: ['P05', 'P06', 'P07'], min: 1, max: 99 } });
    const ui = renderWithPaper(<MultiHarness mode="PER_PARTY" />);
    await waitFor(() => expect(ui.getByTestId('belge-parti-bizim-GB-1-3', { includeHiddenElements: true }).props.value).toBe('Otomatik · sıradaki: P07'));
    expect(mockNumberState).toHaveBeenCalledWith(3);
    expect(ui.queryByTestId('belge-parti-bizim-tek-GB-1')).toBeNull();
  });
});
