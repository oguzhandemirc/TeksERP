// "Gelen değerler" CİHAZ ayarı (2026-11-10, Gülkesim): gelen kg / en / kumaş / renk cihazda kapatılabilir; kapalı alan formda
// (tek form, parti kartı) çizilmez, gövdeye girmez ve `skipDeclared` ile sunucuya "belgeden de doldurma" denir. Varsayılan
// hepsi açık = bugünkü gövde bayt-aynı (eski sunucu strict 400 vermesin). Parti no ve metre kapatılamaz.
// Negatif sonda: `withoutHiddenIncoming` erken dönünce gövde vakaları; `shown('kg')` koşulu kaldırılınca form vakası kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { useDeviceSettingsStore } from '../../../../store/deviceSettingsStore';
import { parseHiddenIncoming, setIncomingShown, skipDeclaredOf } from '../../../../store/docIncomingFields';
import DocRowCard from './DocRowCard';
import PartyRows from './PartyRows';
import { FieldSelectorSheet } from './WoFieldSelector';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
import { buildCreateBody, initialRowForm, type RowForm } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';
import type { NotePartiesView } from '../../../../services/inboundDoc.service';

jest.mock('../../../../utils/storage', () => ({ storage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), deleteItem: jest.fn() } }));
jest.mock('../useReadResult', () => ({ useReadResult: () => ({ watch: null, recheck: jest.fn() }) }));
jest.mock('../useApprovalCard', () => ({ useApprovalDetail: () => ({ data: undefined, isError: false }), approvalDetailKey: (id: string) => ['onay', id] }));
jest.mock('../../../../services/inboundDoc.service', () => {
  const actual = jest.requireActual('../../../../services/inboundDoc.service');
  return { ...actual, inboundDocService: { ...actual.inboundDocService, noteParties: () => new Promise(() => undefined) } };
});
jest.mock('../../../../services/batch.service', () => ({ batchService: { getNumberPreview: async () => ({ success: true, data: { enabled: false } }) } }));
jest.mock('../../../../hooks/usePermission', () => ({ usePermissions: () => ({ has: () => true }) }));

const HIDDEN = { includeHiddenElements: true };
const detail = { id: 'n1', noteNo: 'GB-1', status: 'DRAFT', kursunMeters: '150', incomingKg: '60', batchNoCandidates: [], scans: [], formFields: { en: '160' } };
const party = (blockNo: number) => ({ blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 1, meters: 100, weightKg: null, warnings: [], suggestedKg: 20 });
const view: NotePartiesView = { parties: [party(1), party(2)], warnings: [], multi: true, defaultMode: 'SINGLE' };
const baseForm = (): RowForm => ({ ...initialRowForm(detail as never), ownerCustomerId: 'c1', meters: 150 });
const opts = (hiddenIncoming?: Parameters<typeof skipDeclaredOf>[0]) => ({ clientToken: 't', routeTemplateId: null, gramajPropertyId: null, ...(hiddenIncoming ? { hiddenIncoming } : {}) });

beforeEach(() => useDeviceSettingsStore.setState({ docHiddenIncoming: [] }));

describe('ayar (saf + cihaz deposu)', () => {
  it('⭐ varsayılan hepsi açık: kayıt yok/bozuk → boş liste; depo başlangıcı boş', () => {
    expect(parseHiddenIncoming(null)).toEqual([]);
    expect(parseHiddenIncoming('xx, partiNo,metre')).toEqual([]);
    expect(parseHiddenIncoming('color,kg')).toEqual(['kg', 'color']);
    expect(useDeviceSettingsStore.getState().docHiddenIncoming).toEqual([]);
  });
  it('aç/kapat sıra sabit; gövde anahtarları sunucu adlarıyla', async () => {
    expect(setIncomingShown(['color'], 'kg', false)).toEqual(['kg', 'color']);
    expect(setIncomingShown(['kg', 'color'], 'kg', true)).toEqual(['color']);
    expect(skipDeclaredOf(['width', 'item'])).toEqual(['incomingWidth', 'incomingItemText']);
    await useDeviceSettingsStore.getState().setDocIncomingShown('width', false);
    expect(useDeviceSettingsStore.getState().docHiddenIncoming).toEqual(['width']);
  });
});

describe('gövde', () => {
  const edited: Partial<RowForm> = { incomingKg: 70, incomingKgEdited: true, incomingWidth: 150, incomingWidthEdited: true, incomingItemText: 'Ham', incomingItemEdited: true, incomingColorText: 'EKRU', incomingColorEdited: true };
  it('⭐ hepsi açık: gövde bugünkü gibi, skipDeclared anahtarı YOK', () => {
    const f = { ...baseForm(), ...edited };
    expect(buildCreateBody(f, opts([]))).toEqual(buildCreateBody(f, opts()));
    expect(buildCreateBody(f, opts([]))).not.toHaveProperty('skipDeclared');
    expect(buildCreateBody(f, opts())).toMatchObject({ incomingKg: 70, incomingWidth: 150, incomingItemText: 'Ham', incomingColorText: 'EKRU' });
  });
  it('⭐ kapalı alan gövdeye girmez (elle düzeltilmiş olsa da) + skipDeclared beyanı; açık alan kalır', () => {
    const b = buildCreateBody({ ...baseForm(), ...edited }, opts(['kg', 'color']));
    expect(b).not.toHaveProperty('incomingKg');
    expect(b).not.toHaveProperty('incomingColorText');
    expect(b).toMatchObject({ incomingWidth: 150, incomingItemText: 'Ham', skipDeclared: ['incomingKg', 'incomingColorText'] });
    // Elle düzeltilmemiş (belgedeki) alan da kapalıysa beyan yine gider: sunucu belgeden doldurmasın.
    expect(buildCreateBody(baseForm(), opts(['width']))).toMatchObject({ skipDeclared: ['incomingWidth'] });
  });
  it('⭐ çok parti: parti başına kapalı alanlar düşer, parti no + metre kalır', () => {
    const multi = initialMultiParty(view)!;
    const m: MultiPartyDraft = { ...multi, rows: multi.rows.map((r) => ({ ...r, incomingKg: 25, kgEdited: true, incomingItemText: 'X', itemEdited: true })) };
    const b = buildCreateBody({ ...baseForm(), multi: m }, opts(['kg', 'item']));
    expect(b.skipDeclared).toEqual(['incomingKg', 'incomingItemText']);
    expect(b.parties).toEqual([{ blockNo: 1, batchNo: 'P1', meters: 100 }, { blockNo: 2, batchNo: 'P2', meters: 100 }]);
  });
});

function Card({ form }: { form: RowForm }) {
  const [f, setF] = useState(form);
  const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, form: f, gramajTouched: false, result: null };
  const wo = {
    setDetail: jest.fn(), setParties: jest.fn(), recent: [], mode: 'WITH_WORK_ORDER', saving: false, removeRow: jest.fn(), showGramaj: false,
    catalog: { propertyId: null, options: [] }, batchSource: 'SERIES', rereadRow: jest.fn(), applyTaught: jest.fn(),
    updateForm: (_: string, p: Partial<RowForm>) => setF((x) => ({ ...x, ...p })), setMulti: jest.fn(),
  } as unknown as WoRowsState;
  return <DocRowCard row={row} wo={wo} customers={[{ value: 'c1', label: 'Müşteri' }]} customersLoading={false} variant="single" />;
}

describe('form', () => {
  it('⭐ açıkken dört gelen kutusu + metre çizilir (bugünkü)', () => {
    const ui = renderWithPaper(<Card form={baseForm()} />);
    for (const id of ['belge-satir-kg-GB-1', 'belge-satir-en-GB-1', 'belge-gelen-kumas-GB-1', 'belge-gelen-renk-GB-1']) expect(ui.getByTestId(id)).toBeTruthy();
  });
  it('⭐ kapalı alanlar formda yok; metre kalır; hepsi kapalıysa beyan satırı da yok', () => {
    useDeviceSettingsStore.setState({ docHiddenIncoming: ['kg', 'color'] });
    const ui = renderWithPaper(<Card form={baseForm()} />);
    expect(ui.queryByTestId('belge-satir-kg-GB-1')).toBeNull();
    expect(ui.queryByTestId('belge-gelen-renk-GB-1')).toBeNull();
    expect(ui.getByTestId('belge-satir-en-GB-1')).toBeTruthy();
    expect(ui.getByTestId('belge-gelen-kumas-GB-1')).toBeTruthy();
    ui.unmount();
    useDeviceSettingsStore.setState({ docHiddenIncoming: ['kg', 'width', 'item', 'color'] });
    const all = renderWithPaper(<Card form={baseForm()} />);
    expect(all.queryByTestId('belge-satir-en-GB-1')).toBeNull();
    expect(all.queryByTestId('belge-gelen-beyan-GB-1')).toBeNull();
    expect(all.getByTestId('belge-satir-metre-GB-1')).toBeTruthy();
  });
  it('⭐ parti kartı: kapalı kg/en/kumaş yok, parti no + metre + renk var', () => {
    useDeviceSettingsStore.setState({ docHiddenIncoming: ['kg', 'width', 'item'] });
    const row: DocRow = { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail: detail as never, parties: view, gramajTouched: false, result: null, form: { ...baseForm(), multi: initialMultiParty(view) } };
    const ui = renderWithPaper(<PartyRows row={row} wo={{ setMulti: jest.fn(), batchSource: 'DOCUMENT' } as unknown as WoRowsState} locked={false} />);
    expect(ui.queryByTestId('belge-parti-kg-GB-1-1', HIDDEN)).toBeNull();
    expect(ui.queryByTestId('belge-parti-en-GB-1-1', HIDDEN)).toBeNull();
    expect(ui.queryByTestId('belge-gelen-kumas-GB-1-1', HIDDEN)).toBeNull();
    expect(ui.getByTestId('belge-gelen-renk-GB-1-1', HIDDEN)).toBeTruthy();
    expect(ui.getByTestId('belge-parti-no-GB-1-1', HIDDEN)).toBeTruthy();
    expect(ui.getByTestId('belge-parti-metre-GB-1-1', HIDDEN)).toBeTruthy();
  });
});

describe('⚙ ayar sayfası', () => {
  it('⭐ "Gelen değerler" bölümü: dört anahtar varsayılan açık; kapatınca cihaz deposuna yazılır', () => {
    const ui = renderWithPaper(<FieldSelectorSheet visible hidden={[]} onToggle={jest.fn()} onReset={jest.fn()} onDismiss={jest.fn()} pending={false} />);
    for (const k of ['kg', 'width', 'item', 'color']) expect(ui.getByTestId(`ie-gelen-${k}-anahtar`).props.value).toBe(true);
    expect(ui.queryByTestId('ie-gelen-partiNo')).toBeNull();
    fireEvent.press(ui.getByTestId('ie-gelen-width'));
    expect(useDeviceSettingsStore.getState().docHiddenIncoming).toEqual(['width']);
  });
});
