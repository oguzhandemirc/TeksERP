// "Gelen kumaş" / "Gelen renk" beyan kutuları: sarı = belgeden, dokununca düzeltme, boşsa "Belgede yok"; yalnız elle
// değişince gövdeye girer (tek parti: üst düzey, çok parti: parti başına).
// Negatif sonda: düzeltilmeden beyan gövdeye girerse gövde vakası, belgedeki sarı vurgu kalkarsa sarı vakası kırmızı.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { renderWithPaper } from '../../../../test/render';
import type { ReadWatch } from '../readResult';
import { clearLocalPages, rememberLocalPages } from '../tanit/localPages';
import DocRowCard from './DocRowCard';
import { incomingKgNote } from './DocRowKg';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
import { buildCreateBody, initialRowForm, type RowForm } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';
import type { NotePartiesView, Tanima } from '../../../../services/inboundDoc.service';

let mockWatch: ReadWatch | null = null;
jest.mock('../useReadResult', () => ({ useReadResult: () => ({ watch: mockWatch, recheck: jest.fn() }) }));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }), approvalDetailKey: (id: string) => ['onay', id] }));
jest.mock('../../../../services/inboundDoc.service', () => {
  const actual = jest.requireActual('../../../../services/inboundDoc.service');
  return { ...actual, inboundDocService: { ...actual.inboundDocService, noteParties: () => new Promise(() => undefined) } };
});
jest.mock('../../../../services/batch.service', () => ({ batchService: { getNumberPreview: async () => ({ success: true, data: { enabled: false } }) } }));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));
jest.mock('../../../../components/ModuleSheet', () => {
  const actual = jest.requireActual('../../../../components/ModuleSheet');
  const { Text } = jest.requireActual('react-native');
  return { ...actual, __esModule: true, default: (p: { visible: boolean; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) => (p.visible ? <>{p.subtitle ? <Text>{p.subtitle}</Text> : null}{p.children}{p.footer}</> : null) };
});

const SUMMARY = { noteId: 'n1', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ', reason: null, pages: { total: 1, waiting: 0, read: 1, failed: 0 }, lineCount: 3, reviewCount: 0, totals: { declared: false, ok: null, mismatches: [] }, warnings: [] };
const done = (x: Record<string, unknown>): ReadWatch => ({ phase: 'done', summary: { ...SUMMARY, ...x } } as unknown as ReadWatch);

const rule = (key: string, text: string, source = 'TEMPLATE') => ({ key, value: 'x', source, text, sourceText: source === 'TEMPLATE' ? 'şablon kuralı' : 'fabrika ayarı' });
const TAUGHT: Tanima = {
  template: { code: 'u-komurhan', name: 'Kömürhan Çeki Listesi', version: 2, score: 0.9375 },
  durum: 'TANITILDI',
  mapping: [
    { field: 'partiNo', label: 'PARTİ NO', value: '2008-58', woTarget: 'customerBatchNo', woLabel: 'Gönderen parti no', group: 'KIMLIK' },
    { field: 'toplamMetre', label: 'T.Metre', value: '241', woTarget: 'kursunMeters', woLabel: 'Gelen metre', group: 'GELEN' },
  ],
  rules: [rule('multiParty', 'Birden çok parti gelirse: tek iş emri', 'FACTORY'), rule('totalsRow', 'Toplam satırı: T.Adet')] as Tanima['rules'],
};

const baseForm: RowForm = {
  ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  customerBatchNo: null, meters: 241, metersReview: false, gramajValueId: null,
};
const detail = { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', kursunMeters: '241', batchNoCandidates: [], scans: [{ id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' }] };
const party = (blockNo: number) => ({ blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 1, meters: 100, weightKg: null, warnings: [] });

interface Opts { form?: Partial<RowForm>; detail?: Record<string, unknown>; parties?: NotePartiesView; setMulti?: jest.Mock; updateForm?: jest.Mock }

function Harness({ o }: { o: Opts }) {
  const [form, setForm] = useState<RowForm>({ ...baseForm, multi: o.parties ? initialMultiParty(o.parties) : null, ...o.form });
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: { ...detail, ...o.detail } as never, form, parties: o.parties, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false,
    catalog: { propertyId: null, options: [] }, batchSource: 'SERIES', rereadRow: jest.fn(), applyTaught: jest.fn(),
    updateForm: (_: string, p: Partial<RowForm>) => { o.updateForm?.(p); setForm((f) => ({ ...f, ...p })); },
    setMulti: (_: string, m: MultiPartyDraft) => { o.setMulti?.(m); setForm((f) => ({ ...f, multi: m })); },
  } as unknown as WoRowsState;
  return <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} variant="single" />;
}
const draw = (o: Opts = {}) => renderWithPaper(<Harness o={o} />);

beforeEach(() => {
  clearLocalPages();
  mockWatch = null;
});


const bg = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor;
const DECL = { itemText: 'TÜL PERDE', colorText: 'EKRU', suggestedItem: null, suggestedColor: null };
const OPTS = { clientToken: 't', routeTemplateId: null, gramajPropertyId: null };

describe('Gelen kumaş / gelen renk (belgenin beyanı)', () => {
  it('⭐ belge beyanı sarı kutuda; elle düzeltince sarı kalkar ve form güncellenir', () => {
    const updateForm = jest.fn();
    const ui = draw({ detail: { incomingDeclared: DECL }, updateForm });
    expect(ui.getByTestId('belge-gelen-kumas-GB-1-deger')).toHaveTextContent('TÜL PERDE');
    expect(ui.getByTestId('belge-gelen-renk-GB-1-deger')).toHaveTextContent('EKRU');
    expect(bg(ui.getByTestId('belge-gelen-kumas-GB-1'))).toBe(DOC_HIGHLIGHT_BG);
    fireEvent.press(ui.getByTestId('belge-gelen-kumas-GB-1'));
    fireEvent.changeText(ui.getByTestId('belge-gelen-kumas-GB-1-duzelt-giris'), 'DANTEL');
    fireEvent.press(ui.getByTestId('belge-gelen-kumas-GB-1-duzelt-kaydet'));
    expect(updateForm).toHaveBeenLastCalledWith({ incomingItemText: 'DANTEL', incomingItemEdited: true });
    expect(ui.getByTestId('belge-gelen-kumas-GB-1-deger')).toHaveTextContent('DANTEL');
    expect(bg(ui.getByTestId('belge-gelen-kumas-GB-1'))).not.toBe(DOC_HIGHLIGHT_BG);
  });
  it('belgede yoksa "Belgede yok"; eski sunucuda şablon desen/renk metni gösterilir', () => {
    const ui = draw();
    expect(ui.getByTestId('belge-gelen-kumas-GB-1-deger')).toHaveTextContent('Belgede yok');
    const old = draw({ detail: { formFields: { desenText: 'ESKİ DESEN' } } });
    expect(old.getAllByTestId('belge-gelen-kumas-GB-1-deger').some((n) => /ESKİ DESEN/.test(String(n.props.children)))).toBe(true);
  });
  it('⭐ gövde: belgedeki beyan gitmez; elle değişen gider; elle silinen null gider', () => {
    const f = initialRowForm({ ...detail, ownerCustomerId: 'c1', incomingDeclared: DECL } as never);
    const b0 = buildCreateBody(f, OPTS);
    expect(b0).not.toHaveProperty('incomingItemText');
    expect(b0).not.toHaveProperty('incomingColorText');
    const b1 = buildCreateBody({ ...f, incomingItemText: 'DANTEL', incomingItemEdited: true, incomingColorText: null, incomingColorEdited: true }, OPTS);
    expect(b1.incomingItemText).toBe('DANTEL');
    expect(b1.incomingColorText).toBeNull();
  });
  it('⭐ çok parti: beyan parti başına gider, üst düzey gitmez', () => {
    const f = initialRowForm({ ...detail, ownerCustomerId: 'c1' } as never);
    const multi = initialMultiParty({ parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' })!;
    const body = buildCreateBody({ ...f, incomingItemText: 'X', incomingItemEdited: true, multi: { ...multi, rows: [{ ...multi.rows[0]!, incomingColorText: 'MAVİ', colorEdited: true }, multi.rows[1]!] } }, OPTS);
    expect(body).not.toHaveProperty('incomingItemText');
    expect(body.parties?.[0]?.incomingColorText).toBe('MAVİ');
    expect(body.parties?.[1]).not.toHaveProperty('incomingColorText');
  });
  it('çok partide parti kutusu bölüm beyanını, yoksa belge geneli beyanı gösterir', () => {
    const parties: NotePartiesView = { parties: [{ ...party(1), incomingItemText: 'BÖLÜM KUMAŞ' }, party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' } as never;
    const ui = draw({ parties, detail: { incomingDeclared: DECL } });
    expect(ui.getByTestId('belge-gelen-kumas-GB-1-1-deger', { includeHiddenElements: true })).toHaveTextContent('BÖLÜM KUMAŞ');
    expect(ui.getByTestId('belge-gelen-kumas-GB-1-2-deger', { includeHiddenElements: true })).toHaveTextContent('TÜL PERDE');
  });
});
