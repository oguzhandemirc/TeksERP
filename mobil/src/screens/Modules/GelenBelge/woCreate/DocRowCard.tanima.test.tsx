// Belge şeridi (2026-11-09 sadeleşme): yalnız iş gerektiren satırlar (tanınmadı + Tanıt · çok parti kipi + "Değiştir" düğmesi;
// 2026-11-10: kip değiştirmenin TEK yolu şerit — parti altında kip düğmesi yok, parantezli kaynak yazısı yok, her kurulumda çizilir)
// + beyan kutuları "Gelen kg" / "Gelen en" (İE hedefi değil; sarı = belgeden; yalnız elle değişince gövdeye girer).
// Negatif sonda: tanınmış tek partili belgede şerit çizilirse ilk vaka; parti kip düğmeleri / kaynak yazısı geri gelirse ya da
// tanıma modeli yokken şerit düşerse çok parti vakaları; kg vurgusu kaldırılırsa kg vakası; gelen en elle
// değişmeden gövdeye girerse en gövde vakası kırmızı.
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { Button } from 'react-native-paper';
import { DOC_HIGHLIGHT_BG } from '../../../../components/DocHighlight';
import { renderWithPaper } from '../../../../test/render';
import type { ReadWatch } from '../readResult';
import { clearLocalPages, rememberLocalPages } from '../tanit/localPages';
import { clearTeachPrompts } from '../tanit/TeachPrompt';
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
  clearTeachPrompts();
  mockWatch = null;
});

describe('belge şeridi — yalnız iş gerektiren satırlar', () => {
  it('⭐ TANITILDI tek parti: şerit hiç çizilmez (ad, alan sayısı, kural satırı yok; boş alan kalmaz)', () => {
    mockWatch = done({ tanitim: { durum: 'TANITILDI', sablonKodu: 'u-komurhan', sablonAdi: 'Kömürhan Çeki Listesi' }, tanima: TAUGHT });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.queryByText(/Tanındı/)).toBeNull();
    expect(ui.queryByText(/alan → iş emri/)).toBeNull();
    expect(ui.queryByText(/Toplam satırı/)).toBeNull();
    expect(ui.queryByTestId('tanit-sablon')).toBeNull();
  });
  it('⭐ TANITILMAMIS + fotoğraf var: formda sarı şerit yok; ortada soru; Vazgeç kapatır, aynı okumada geri gelmez; başlıkta Tanıt kalır', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ tanitim: { durum: 'TANITILMAMIS' }, tanima: { template: null, durum: 'TANITILMAMIS', mapping: [], rules: [TAUGHT.rules[0]] } });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.queryByText(/Bu belge tanınmadı/)).toBeNull();
    expect(ui.queryByTestId('tanit-serit')).toBeNull();
    expect(ui.getByTestId('tanit-sor-metin')).toHaveTextContent(/Bir kez tanıtın/);
    expect(ui.getByTestId('tanit-sor-tanit')).toBeTruthy();
    expect(ui.getByTestId('belge-tanit')).toBeTruthy();
    fireEvent.press(ui.getByTestId('tanit-sor-vazgec'));
    expect(ui.queryByTestId('tanit-sor-metin')).toBeNull();
    ui.unmount();
    const again = draw();
    expect(again.queryByTestId('tanit-sor-metin')).toBeNull();
    expect(again.getByTestId('belge-tanit')).toBeTruthy();
  });
  it('TANITILMAMIS + fotoğraf yok: şerit yok, panel yolunu anlatan amber şerit', () => {
    mockWatch = done({ tanitim: { durum: 'TANITILMAMIS' }, tanima: { template: null, durum: 'TANITILMAMIS', mapping: [], rules: [] } });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.getByTestId('tanit-serit')).toHaveTextContent(/panelde/);
  });
  it('⭐ SISTEM: şerit yok; üst satırda Yeniden tanıt ikonu kalır', () => {
    rememberLocalPages([{ sha256: 'aa', uri: 'file:///1.jpg' }]);
    mockWatch = done({ tanitim: { durum: 'SISTEM', sablonKodu: 'GENEL', sablonAdi: 'Genel İrsaliye' }, tanima: { ...TAUGHT, durum: 'SISTEM', template: { ...TAUGHT.template!, name: 'Genel İrsaliye', score: null } } });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.getByTestId('tanit-serit-guncelle').props.accessibilityLabel).toBe('Yeniden tanıt');
  });
  it('eski sunucu (tanima yok) → şerit çizilmez, bugünkü ad etiketi', () => {
    mockWatch = done({ tanitim: { durum: 'TANITILDI', sablonKodu: 'u-x', sablonAdi: 'Güleçsoy' } });
    const ui = draw();
    expect(ui.queryByTestId('ie-tanima-GB-1')).toBeNull();
    expect(ui.getByTestId('tanit-sablon')).toHaveTextContent(/Güleçsoy/);
  });
  it('⭐ çok parti: kip satırı parantezsiz "2 parti → 2 iş emri"; parti altında kip düğmesi yok; "Değiştir" düğmesi → Tek İE, varsayılana dönüş', () => {
    mockWatch = done({ tanima: TAUGHT });
    const setMulti = jest.fn();
    const ui = draw({ parties: { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'PER_PARTY', defaultModeSource: 'TEMPLATE' }, setMulti });
    expect(ui.queryByTestId('ie-tanima-1')).toBeNull();
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^2 parti → 2 .*iş emri$/);
    expectNoModeDup(ui);
    pickMode(ui, 'SINGLE');
    expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'SINGLE', modeTouched: true }));
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^Bu belge için: Tek İE$/);
    expectNoModeDup(ui);
    pickMode(ui, 'PER_PARTY');
    expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'PER_PARTY', modeTouched: false }));
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^2 parti → 2 .*iş emri$/);
  });
});

describe('çok parti kipi — tek yol şeritteki Değiştir düğmesi', () => {
  it('⭐ Değiştir gerçek düğme (≥56dp); kip sayfası seçenekleri parantezsiz ("Tek iş emri"), varsayılan işaretli', () => {
    mockWatch = done({ tanima: TAUGHT });
    const ui = draw({ parties: { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE', defaultModeSource: 'TEMPLATE' } });
    const btn = ui.getByTestId('ie-tanima-kip-degistir');
    expect(btn).toHaveTextContent(/Değiştir$/);
    expect(btn.props.accessibilityRole).toBe('button');
    const paper = ui.UNSAFE_getAllByType(Button).find((b) => b.props.testID === 'ie-tanima-kip-degistir')!;
    expect(['contained-tonal', 'outlined', 'contained']).toContain(paper.props.mode);
    expect(StyleSheet.flatten(paper.props.contentStyle)).toMatchObject({ minHeight: 56 });
    fireEvent.press(btn);
    expect(ui.getByTestId('ie-tanima-kip-SINGLE')).toHaveTextContent(/Tek .*iş emriVarsayılan$/);
    expect(ui.getByTestId('ie-tanima-kip-PER_PARTY')).toHaveTextContent(/Her parti ayrı .*iş emri$/);
    expect(ui.queryByText(/\(/)).toBeNull();
  });
  it('⭐ Tek İE varsayılanlı kurulum (fabrika): şerit + Değiştir çizilir, kipi değiştirir; parti altında düğme yok', () => {
    mockWatch = done({ tanima: TAUGHT });
    const setMulti = jest.fn();
    const ui = draw({ parties: { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE', defaultModeSource: 'FACTORY' }, setMulti });
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^2 parti → 1 .*iş emri$/);
    expectNoModeDup(ui);
    pickMode(ui, 'PER_PARTY');
    expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'PER_PARTY', modeTouched: true }));
    expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^Bu belge için: Her parti ayrı İE$/);
  });
  it('⭐ tanıma modeli yok (eski sunucu / okuma bitmedi) + çok parti: kip satırı + Değiştir yine çizilir (kip seçimi kaybolmaz)', () => {
    for (const w of [done({ tanitim: { durum: 'TANITILDI', sablonKodu: 'u-x', sablonAdi: 'Güleçsoy' } }), null]) {
      mockWatch = w;
      const setMulti = jest.fn();
      const ui = draw({ parties: { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' }, setMulti });
      expect(ui.getByTestId('ie-tanima-kural')).toHaveTextContent(/^2 parti → 1 .*iş emri$/);
      pickMode(ui, 'PER_PARTY');
      expect(setMulti).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'PER_PARTY' }));
      ui.unmount();
    }
  });
});

type Ui = ReturnType<typeof draw>;
/** Kip değiştirmenin tek yolu şerit: parti kartında kip düğmesi ve şeritte parantezli kaynak yazısı yok. */
function expectNoModeDup(ui: Ui) {
  expect(ui.queryByTestId('belge-parti-kip-GB-1-SINGLE')).toBeNull();
  expect(ui.queryByTestId('belge-parti-kip-GB-1-PER_PARTY')).toBeNull();
  expect(ui.queryByText(/sizin seçiminiz|şablon kuralı|fabrika ayarı|partiler ayrı top/)).toBeNull();
}
function pickMode(ui: Ui, k: 'SINGLE' | 'PER_PARTY') {
  fireEvent.press(ui.getByTestId('ie-tanima-kip-degistir'));
  fireEvent.press(ui.getByTestId(`ie-tanima-kip-${k}`));
}

const bg = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) as { backgroundColor?: unknown } | undefined)?.backgroundColor;

describe('Gelen kg', () => {
  it('⭐ belgeden önerilen kg sarı beyan kutusunda (kaynak yazısı yok); dokununca düzeltme, elle değişince sarı kalkar ve forma işler', () => {
    const updateForm = jest.fn();
    const ui = draw({ form: { incomingKg: 180.5 }, detail: { incomingKg: 180.5, incomingKgSource: 'TOTAL' }, updateForm });
    expect(ui.getByTestId('belge-satir-kg-GB-1-deger')).toHaveTextContent('180,5 kg');
    expect(bg(ui.getByTestId('belge-satir-kg-GB-1'))).toBe(DOC_HIGHLIGHT_BG);
    expect(ui.queryByText(/Belgeden ·/)).toBeNull();
    fireEvent.press(ui.getByTestId('belge-satir-kg-GB-1'));
    expect(ui.getByText('Belgede: 180,5 kg (belgedeki toplamdan)')).toBeTruthy();
    fireEvent.changeText(ui.getByTestId('belge-satir-kg-duzelt-GB-1-giris'), '175');
    fireEvent.press(ui.getByTestId('belge-satir-kg-duzelt-GB-1-kaydet'));
    expect(updateForm).toHaveBeenLastCalledWith({ incomingKg: 175, incomingKgEdited: true });
    expect(ui.getByTestId('belge-satir-kg-GB-1-deger')).toHaveTextContent('175 kg');
    expect(bg(ui.getByTestId('belge-satir-kg-GB-1'))).not.toBe(DOC_HIGHLIGHT_BG);
    // Boş kaydetmek belgedekine döner (sarı geri gelir).
    fireEvent.press(ui.getByTestId('belge-satir-kg-GB-1'));
    fireEvent.changeText(ui.getByTestId('belge-satir-kg-duzelt-GB-1-giris'), '');
    fireEvent.press(ui.getByTestId('belge-satir-kg-duzelt-GB-1-kaydet'));
    expect(updateForm).toHaveBeenLastCalledWith({ incomingKg: 180.5, incomingKgEdited: false });
    expect(bg(ui.getByTestId('belge-satir-kg-GB-1'))).toBe(DOC_HIGHLIGHT_BG);
  });
  it('belgede kg yoksa kutu "Belgede yok", sarı değil', () => {
    const ui = draw();
    expect(ui.getByTestId('belge-satir-kg-GB-1-deger')).toHaveTextContent('Belgede yok');
    expect(bg(ui.getByTestId('belge-satir-kg-GB-1'))).not.toBe(DOC_HIGHLIGHT_BG);
  });
  it('sayfa alt başlığı (saf)', () => {
    expect(incomingKgNote({ suggested: 180, source: 'FIELD' })).toBe('Belgede: 180 kg (belgedeki kg alanından)');
    expect(incomingKgNote({ suggested: null, source: null })).toBe('Belgede kg yok');
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

describe('Gelen en (belgenin beyanı)', () => {
  it('⭐ şablon `en` sarı beyan kutusunda; elle düzeltince sarı kalkar, gövdeye girer', () => {
    const updateForm = jest.fn();
    const ui = draw({ detail: { formFields: { en: '152' } }, updateForm });
    expect(ui.getByTestId('belge-satir-en-GB-1-deger')).toHaveTextContent('152 cm');
    expect(bg(ui.getByTestId('belge-satir-en-GB-1'))).toBe(DOC_HIGHLIGHT_BG);
    fireEvent.press(ui.getByTestId('belge-satir-en-GB-1'));
    fireEvent.changeText(ui.getByTestId('belge-satir-en-duzelt-GB-1-giris'), '148,5');
    fireEvent.press(ui.getByTestId('belge-satir-en-duzelt-GB-1-kaydet'));
    expect(updateForm).toHaveBeenLastCalledWith({ incomingWidth: 148.5, incomingWidthEdited: true });
    expect(ui.getByTestId('belge-satir-en-GB-1-deger')).toHaveTextContent('148,5 cm');
    expect(bg(ui.getByTestId('belge-satir-en-GB-1'))).not.toBe(DOC_HIGHLIGHT_BG);
  });
  it('belgede en yoksa "Belgede yok"', () => {
    expect(draw().getByTestId('belge-satir-en-GB-1-deger')).toHaveTextContent('Belgede yok');
  });
  it('⭐ gövde: belgedeki en gitmez (sunucu yazar); elle düzeltilen gider; partide parti başına', () => {
    const f = initialRowForm({ ...detail, ownerCustomerId: 'c1', formFields: { en: '152' } } as never);
    const opts = { clientToken: 't', routeTemplateId: null, gramajPropertyId: null };
    expect(buildCreateBody(f, opts)).not.toHaveProperty('incomingWidth');
    expect(buildCreateBody({ ...f, incomingWidth: 148, incomingWidthEdited: true }, opts).incomingWidth).toBe(148);
    const multi = initialMultiParty({ parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' })!;
    const body = buildCreateBody({ ...f, incomingWidth: 148, incomingWidthEdited: true, multi: { ...multi, rows: [{ ...multi.rows[0]!, incomingWidth: 150, widthEdited: true }, multi.rows[1]!] } }, opts);
    expect(body).not.toHaveProperty('incomingWidth');
    expect(body.parties?.[0]?.incomingWidth).toBe(150);
    expect(body.parties?.[1]).not.toHaveProperty('incomingWidth');
  });
});
