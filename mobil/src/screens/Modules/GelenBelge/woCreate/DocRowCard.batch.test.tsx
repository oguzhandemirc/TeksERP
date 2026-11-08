// Belgeden İE satırı — parti no (Gülkesim istek 2) ve kurşun gramajı (istek 3).
// Müşteri parti no düz metin alanıdır: belgeden geldiyse dolu + sarı vurgu, dokununca seçici AÇILMAZ, yazınca vurgu kalkar.
// Bizim parti no seri kipinde "Bizim parti: otomatik" (salt okunur); belgeden kipinde aday seçicisi bugünkü gibi.
// Negatif sonda: BatchFields müşteri alanı kaldırılınca / vurgu her zaman kapalıyken / editCustomerBatchNo vurguyu
// düşürmeyince / seçili gramaj stili kaldırılınca ilgili vaka kırmızı.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { colors } from '../../../../theme';
import DocRowCard from './DocRowCard';
import type { DocRow, WoRowsState } from './useWoRows';
import type { RowForm } from './woFromDoc';

jest.mock('../useReadResult', () => ({ useReadResult: () => ({ watch: null, recheck: jest.fn() }) }));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }) }));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));

const baseForm: RowForm = {
  ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  customerBatchNo: '2008-58', customerBatchNoFromDoc: true, meters: 250, metersReview: false, gramajValueId: 'g1',
};
const detail = {
  id: 'n1', noteNo: 'GB-1', status: 'DRAFT', ownerCustomerId: 'c1', kursunMeters: '250', customerBatchNo: '2008-58',
  batchNoCandidates: [{ kind: 'BATCH', key: 'partiNo', value: '2008-58' }, { kind: 'DOC', key: 'evrakNo', value: 'E-77' }],
};
const catalog = { propertyId: 'p1', options: [{ id: 'g1', name: '25 gr', isDefault: true }, { id: 'g2', name: '30 gr', isDefault: false }] };

function Harness({ batchSource, form = baseForm }: { batchSource: 'SERIES' | 'DOCUMENT' | null; form?: RowForm }) {
  const [f, setF] = useState<RowForm>(form);
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, form: f, gramajTouched: false, result: null };
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
  it('⭐ seri kipinde bizim parti no "Bizim parti: otomatik" (salt okunur)', () => {
    const ui = renderWithPaper(<Harness batchSource="SERIES" />);
    expect(ui.getByTestId('belge-satir-bizim-parti-GB-1')).toBeTruthy();
    expect(ui.getByText('Bizim parti: otomatik')).toBeTruthy();
  });
  it('belgeden kipinde bizim parti no aday seçicisi (bugünkü davranış)', () => {
    const ui = renderWithPaper(<Harness batchSource="DOCUMENT" />);
    expect(ui.queryByTestId('belge-satir-bizim-parti-GB-1')).toBeNull();
    expect(ui.getByText('Bizim parti no seçin (2 aday)')).toBeTruthy();
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
