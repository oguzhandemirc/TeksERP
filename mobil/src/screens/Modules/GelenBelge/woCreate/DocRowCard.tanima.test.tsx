// T2 (belge tanıt 3 aşama, 2026-11-09): belge şeridinin üç aşaması (sunucunun `tanima` bloğundan) + "Bu sefer değiştir" kip
// sayfası + "Gelen kg" kutusu (hedef kg değil; yalnız elle değişince gövdeye girer).
// Negatif sonda: şerit `tanima` yokken de çizilirse "eski sunucu" vakası; ③ kaynak metni kullanıcı seçiminde "sizin seçiminiz"e
// dönmezse kip vakası; Gelen kg notu kaynak metnini düşürürse kg vakası kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
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
  return { ...actual, __esModule: true, default: (p: { visible: boolean; children: React.ReactNode }) => (p.visible ? <>{p.children}</> : null) };
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

describe('belge şeridi — üç aşama', () => {
  it('⭐ TANITILDI: ① ad + güven, ② alan sayısı (dokununca eşleme sayfası), ③ kurallar', () => {
    mockWatch = done({ tanitim: { durum: 'TANITILDI', sablonKodu: 'u-komurhan', sablonAdi: 'Kömürhan Çeki Listesi' }, tanima: TAUGHT });
    const ui = draw();
    expect(ui.getByTestId('ie-tanima-1')).toHaveTextContent(/Tanındı: Kömürhan Çeki Listesi · %94/);
    expect(ui.getByTestId('ie-tanima-2')).toHaveTextContent(/2 alan → iş emri/);
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/Toplam satırı: T\.Adet/);
    // Ad şeritte; üst satırdaki eski ad etiketi tekrarlanmaz.
    expect(ui.queryByTestId('tanit-sablon')).toBeNull();
    expect(ui.queryByTestId('ie-tanima-esleme')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-tanima-2'));
    expect(ui.getByTestId('ie-tanima-esleme-toplamMetre')).toHaveTextContent(/T\.Metre.*241.*Gelen metre/);
    expect(ui.getByTestId('ie-tanima-esleme')).toHaveTextContent(/Toplam satırı: T\.Adet \(şablon kuralı\)/);
  });
  it('⭐ TANITILMAMIS + fotoğraf var: "Tanınmadı" + Tanıt düğmesi; eşleme yok', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ tanitim: { durum: 'TANITILMAMIS' }, tanima: { template: null, durum: 'TANITILMAMIS', mapping: [], rules: [TAUGHT.rules[0]] } });
    const ui = draw();
    expect(ui.getByTestId('ie-tanima-1')).toHaveTextContent(/Tanınmadı/);
    expect(ui.getByTestId('ie-tanima-tanit')).toBeTruthy();
    expect(ui.queryByTestId('ie-tanima-2')).toBeNull();
    // Amber şerit yalnız fotoğrafsız açıklama için; burada Tanıt ①'de.
    expect(ui.queryByTestId('tanit-serit')).toBeNull();
  });
  it('⭐ SISTEM: "Hazır şablon" + üst satırda Yeniden tanıt ikonu kalır', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ tanitim: { durum: 'SISTEM', sablonKodu: 'GENEL', sablonAdi: 'Genel İrsaliye' }, tanima: { ...TAUGHT, durum: 'SISTEM', template: { ...TAUGHT.template!, name: 'Genel İrsaliye', score: null } } });
    const ui = draw();
    expect(ui.getByTestId('ie-tanima-1')).toHaveTextContent(/Hazır şablon: Genel İrsaliye/);
    expect(ui.getByTestId('tanit-serit-guncelle').props.accessibilityLabel).toBe('Yeniden tanıt');
  });
  it('eski sunucu (tanima yok) → şerit çizilmez, bugünkü ad etiketi', () => {
    mockWatch = done({ tanitim: { durum: 'TANITILDI', sablonKodu: 'u-x', sablonAdi: 'Güleçsoy' } });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.getByTestId('tanit-sablon')).toHaveTextContent(/Güleçsoy/);
  });
  it('⭐ çok parti: ③ "2 parti → 2 iş emri (şablon kuralı)"; "Bu sefer değiştir" → Tek İE "sizin seçiminiz", K1 seçimi görünür', () => {
    mockWatch = done({ tanima: TAUGHT });
    const setMulti = jest.fn();
    const ui = draw({ parties: { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'PER_PARTY', defaultModeSource: 'TEMPLATE' }, setMulti });
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/2 parti → 2 .*iş emri \(şablon kuralı\)/);
    // K1: varsayılan her parti ayrı → formda kip seçimi yok.
    expect(ui.queryByTestId('belge-parti-kip-GB-1-SINGLE')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-tanima-kip-degistir'));
    fireEvent.press(ui.getByTestId('ie-tanima-kip-SINGLE'));
    expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'SINGLE', modeTouched: true }));
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent('Bu belge için: Tek İE (sizin seçiminiz)');
    expect(ui.getByTestId('belge-parti-kip-GB-1-SINGLE')).toBeTruthy();
    // Varsayılana dönüş → kural metni geri gelir.
    fireEvent.press(ui.getByTestId('ie-tanima-kip-degistir'));
    fireEvent.press(ui.getByTestId('ie-tanima-kip-PER_PARTY'));
    expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'PER_PARTY', modeTouched: false }));
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/\(şablon kuralı\)/);
  });
});

describe('Gelen kg', () => {
  it('⭐ belgeden önerilen kg dolu gelir, kaynak notu; elle değişince "Elle girildi" ve forma işler', () => {
    const updateForm = jest.fn();
    const ui = draw({ form: { incomingKg: 180.5 }, detail: { incomingKg: 180.5, incomingKgSource: 'TOTAL' }, updateForm });
    expect(ui.getByTestId('belge-satir-kg-giris-GB-1').props.value).toBe('180,5');
    expect(ui.getByTestId('belge-satir-kg-not-GB-1')).toHaveTextContent('Belgeden · belgedeki toplamdan');
    fireEvent.changeText(ui.getByTestId('belge-satir-kg-giris-GB-1'), '175');
    expect(updateForm).toHaveBeenLastCalledWith({ incomingKg: 175, incomingKgEdited: true });
    expect(ui.getByTestId('belge-satir-kg-not-GB-1')).toHaveTextContent('Elle girildi');
  });
  it('belgede kg yoksa kutu boş + "Belgede kg yok"', () => {
    const ui = draw();
    expect(ui.getByTestId('belge-satir-kg-giris-GB-1').props.value).toBe('');
    expect(ui.getByTestId('belge-satir-kg-not-GB-1')).toHaveTextContent('Belgede kg yok');
  });
  it('not metni (saf): boşaltılan kutu belgedekinin yazılacağını söyler', () => {
    expect(incomingKgNote({ value: null, edited: true, suggested: 180, source: 'FIELD' })).toBe('Boş bırakılırsa belgedeki 180 kg yazılır');
    expect(incomingKgNote({ value: 180, edited: false, suggested: 180, source: 'LINE_SUM' })).toBe('Belgeden · satır toplamı');
  });
  it('⭐ gövde: öneri gitmez (sunucu yazar), elle değişen gider; çok partide üst düzey gitmez', () => {
    const f = initialRowForm({ ...detail, ownerCustomerId: 'c1', incomingKg: 180 } as never);
    expect(f.incomingKg).toBe(180);
    const opts = { clientToken: 't', routeTemplateId: null, gramajPropertyId: null };
    expect(buildCreateBody(f, opts)).not.toHaveProperty('incomingKg');
    expect(buildCreateBody({ ...f, incomingKg: 175, incomingKgEdited: true }, opts).incomingKg).toBe(175);
    expect(buildCreateBody({ ...f, incomingKg: null, incomingKgEdited: true }, opts)).not.toHaveProperty('incomingKg');
    const multi = initialMultiParty({ parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' });
    expect(buildCreateBody({ ...f, incomingKg: 175, incomingKgEdited: true, multi }, opts)).not.toHaveProperty('incomingKg');
  });
});
