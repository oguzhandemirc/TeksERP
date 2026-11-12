// Tek İE formu okuma uyarıları (2026-11-09): belge başlığı altındaki sarı şerit yerine başlık çubuğunda sarı ünlem + ortada
// modal (BÜYÜK HARFLİ kısa başlık: değer). İlk okumada bir kez kendiliğinden açılır; kapatılınca aynı okumada açılmaz;
// tanınmamış belge sorusu varken bekler, o kapanınca açılır. Negatif sonda: otomatik açılış kaldırılırsa / tekrar açılırsa /
// şerit geri gelirse / tanıt sorusuyla üst üste açılırsa ilgili vaka kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { ReadWatch } from '../readResult';
import { clearLocalPages, rememberLocalPages } from '../tanit/localPages';
import { clearTeachPrompts } from '../tanit/TeachPrompt';
import DocRowCard from './DocRowCard';
import type { MultiPartyDraft } from './partyDraft';
import { clearReadWarnings, ReadWarningsHeaderIcon } from './ReadWarningsIcon';
import { useReadWarningStore } from './readWarningStore';
import type { RowForm } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';
import type { NotePartiesView } from '../../../../services/inboundDoc.service';
import { initialMultiParty } from './partyDraft';

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

const baseForm: RowForm = {
  ownerCustomerId: 'c1', ownerSuggested: null, ownerAsk: null, ourBatchNo: null, ourBatchNoKey: null,
  customerBatchNo: null, meters: 241, metersReview: false, gramajValueId: null,
};
const detail = { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', kursunMeters: '241', batchNoCandidates: [], scans: [{ id: 's1', pageNo: 1, sha256: 'aa', status: 'READ', mimeType: 'image/jpeg' }] };

interface Opts { form?: Partial<RowForm>; detail?: Record<string, unknown>; parties?: NotePartiesView; setMulti?: jest.Mock; updateForm?: jest.Mock; runKey?: number }

function Harness({ o }: { o: Opts }) {
  const [form, setForm] = useState<RowForm>({ ...baseForm, multi: o.parties ? initialMultiParty(o.parties) : null, ...o.form });
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: o.runKey ?? 1, detail: { ...detail, ...o.detail } as never, form, parties: o.parties, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false,
    catalog: { propertyId: null, options: [] }, batchSource: 'SERIES', rereadRow: jest.fn(), applyTaught: jest.fn(),
    updateForm: (_: string, p: Partial<RowForm>) => { o.updateForm?.(p); setForm((f) => ({ ...f, ...p })); },
    setMulti: (_: string, m: MultiPartyDraft) => { o.setMulti?.(m); setForm((f) => ({ ...f, multi: m })); },
  } as unknown as WoRowsState;
  // Başlık çubuğu ikonu (ScreenChrome profileExtras) + form: ikisi aynı depodan.
  return (
    <>
      <ReadWarningsHeaderIcon />
      <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Gülkesim' }]} customersLoading={false} variant="single" />
    </>
  );
}
const draw = (o: Opts = {}) => renderWithPaper(<Harness o={o} />);

const METER = { code: 'METER_VALUES_DIFFER', title: 'Belgede iki farklı metre', detail: 'Belgede iki farklı metre: 238 / 241 — kaynak metreyi belgeyle karşılaştırın' };
const RATIO = { code: 'KG_METER_RATIO', title: 'x', detail: '734 kg / 241 m, en 150 cm → 203 g/m² (makul 15–1500) — metre ya da kg yanlış okunmuş olabilir' };

beforeEach(() => {
  clearLocalPages();
  clearTeachPrompts();
  clearReadWarnings();
  useReadWarningStore.getState().clear();
  mockWatch = null;
});

describe('okuma uyarıları — başlıkta ünlem + modal', () => {
  it('⭐ uyarı varken ikon görünür, ilk okumada modal kendiliğinden açılır; şerit metni formda yok; başlık BÜYÜK HARFLİ kısa', () => {
    mockWatch = done({ notices: [METER, RATIO] });
    const ui = draw();
    expect(ui.getByTestId('ie-uyari-ikon')).toBeTruthy();
    expect(ui.getByTestId('ie-uyari-sayi')).toHaveTextContent('2');
    expect(ui.getByTestId('ie-uyari-modal')).toBeTruthy();
    expect(ui.getByTestId('ie-uyari-capraz-METER_VALUES_DIFFER')).toHaveTextContent('İKİ FARKLI METRE TESPİT EDİLDİ: 238 / 241');
    expect(ui.getByTestId('ie-uyari-capraz-KG_METER_RATIO')).toHaveTextContent('GRAMAJ ARALIK DIŞI: 203 g/m² (makul 15–1500)');
    expect(ui.queryByText(/kaynak metreyi/)).toBeNull();
    expect(ui.queryByTestId('belge-ileti-capraz-METER_VALUES_DIFFER-GB-1')).toBeNull();
  });

  it('⭐ kapatılınca aynı okumada kendiliğinden açılmaz; ikona dokununca açılır; yeni okuma yeniden açar', () => {
    mockWatch = done({ notices: [METER] });
    const ui = draw();
    fireEvent.press(ui.getByTestId('ie-uyari-tamam'));
    expect(ui.queryByTestId('ie-uyari-modal')).toBeNull();
    ui.unmount();
    const again = draw();
    expect(again.getByTestId('ie-uyari-ikon')).toBeTruthy();
    expect(again.queryByTestId('ie-uyari-modal')).toBeNull();
    fireEvent.press(again.getByTestId('ie-uyari-ikon'));
    expect(again.getByTestId('ie-uyari-modal')).toBeTruthy();
    again.unmount();
    expect(draw({ runKey: 2 }).getByTestId('ie-uyari-modal')).toBeTruthy();
  });

  it('uyarı yoksa ikon yok', () => {
    mockWatch = done({});
    expect(draw().queryByTestId('ie-uyari-ikon')).toBeNull();
  });

  it('⭐ tanınmamış belge sorusu önce; o kapanınca uyarı modalı açılır (üst üste değil)', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ notices: [METER], tanitim: { durum: 'TANITILMAMIS' }, tanima: { template: null, durum: 'TANITILMAMIS', mapping: [], rules: [] } });
    const ui = draw();
    expect(ui.getByTestId('tanit-sor-metin')).toBeTruthy();
    expect(ui.queryByTestId('ie-uyari-modal')).toBeNull();
    fireEvent.press(ui.getByTestId('tanit-sor-vazgec'));
    expect(ui.getByTestId('ie-uyari-modal')).toBeTruthy();
  });
});
