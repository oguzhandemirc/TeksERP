// Çok parti sekmeleri (2026-11-09): sekme başlığı/durumu (⚠ eksik · ✓ tamam · ● bakılmadı), kilit YALNIZ ⚠'den, "Tümü"
// tablosundan sekmeye geçiş, tek partide sekme yok; belge önizlemesinde parti bölmesi + fotoğraf odağı.
// Negatif sonda: `partyTabs` bakılmamış partiyi de 'error' sayarsa ya da `partyLock` her sekmeyi döndürürse kilit vakaları kırmızı.
import React from 'react';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { InboundNoteDetail, InboundNoteLine, NotePartiesView } from '../../../../services/inboundDoc.service';
import { initialMultiParty, multiPartyIssues, type MultiPartyDraft } from './partyDraft';
import { initialRowForm } from './woFromDoc';
import PartyRows from './PartyRows';
import { partyLock, partyLockText, partyTabs, partyTabTitle, showPartyTabs } from './partyTabs';
import { resetPartyTabStore, selectPartyTab, usePartyTabState } from './partyTabStore';
import { focusGeometry, partyFocus, partyLines } from './partyReview';
import { usePartyScanReview } from './PartyScanSide';
import PagePreviewModal from '../PagePreviewModal';
import type { DocRow, WoRowsState } from './useWoRows';

jest.mock('../../../../components/NumpadInput', () => {
  const RN = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { value: string; onChangeText: (t: string) => void; testID?: string }) => <RN.TextInput value={p.value} onChangeText={p.onChangeText} testID={p.testID} /> };
});

const mockNumberState = jest.fn();
jest.mock('../../../../services/batch.service', () => ({ batchService: { getNumberPreview: (n: number) => mockNumberState(n) } }));

const party = (blockNo: number, x: Record<string, unknown> = {}) => ({
  blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: 3, declaredMeters: null, lineCount: 3, meters: 100 * blockNo, weightKg: null, warnings: [] as string[], ...x,
});
const viewOf = (parties = [party(1), party(2), party(3, { batchNo: null, meters: 0, warnings: ['Parti 3. parti: belgede 3 TOP yazıyor, 2 satır var.'] })]): NotePartiesView =>
  ({ parties, warnings: [], multi: true, defaultMode: 'PER_PARTY' });
const line = (id: string, [blockNo, lineNo, y]: [number, number, number], x: Partial<InboundNoteLine> = {}): InboundNoteLine => ({
  id, lineNo, blockNo, lineKind: 'TOP', senderRollNo: `T${lineNo}`, meters: '50', weightKg: null, scanId: 's1',
  sourceRects: { meters: { x: 100, y, width: 200, height: 20 } }, ...x,
});
const lines = [line('a', [1, 1, 100]), line('b', [1, 2, 130]), line('c', [2, 3, 400]), line('d', [2, 4, 430]), line('e', [3, 5, 700]), line('sum', [1, 9, 900], { summary: true })];
const detail = {
  id: 'n1', noteNo: 'GB-1', ownerCustomerId: 'c1', kursunMeters: '300', kursunMetersReview: false,
  scans: [{ id: 's1', pageNo: 1, sha256: 'h1', status: 'READ', mimeType: 'image/jpeg', rectFrameWidth: 1000, rectFrameHeight: 1400 }], lines,
} as InboundNoteDetail;
const rowOf = (view: NotePartiesView = viewOf()): DocRow => {
  const multi = initialMultiParty(view)!;
  return { noteId: 'n1', noteNo: 'GB-1', runKey: 1, detail, gramajTouched: false, parties: view, result: null, form: { ...initialRowForm(detail), multi } };
};
const multiOf = (): MultiPartyDraft => rowOf().form!.multi!;
const wo = () => ({ setMulti: jest.fn() }) as unknown as WoRowsState;

beforeEach(() => {
  resetPartyTabStore();
  mockNumberState.mockReset();
  mockNumberState.mockResolvedValue({ success: true, data: { enabled: false, lastCode: null, nextCode: null, min: 1, max: 99 } });
});

describe('sekme durumu (saf)', () => {
  it('⭐ başlık: parti no, yoksa "Parti N"', () => {
    expect(partyTabTitle({ blockNo: 2, batchNo: ' P2 ' })).toBe('P2');
    expect(partyTabTitle({ blockNo: 3, batchNo: '' })).toBe('Parti 3');
  });
  it('⭐ eksik ⚠, bakılan ✓, bakılmamış ●; açılmış parti ✓', () => {
    const m = multiOf();
    expect(partyTabs(m, new Set()).map((t) => t.status)).toEqual(['unseen', 'unseen', 'error']);
    expect(partyTabs(m, new Set([1])).map((t) => t.status)).toEqual(['ok', 'unseen', 'error']);
    expect(partyTabs(m, new Set(), (b) => (b === 3 ? { kind: 'OPENED', workOrderNo: 'IE-3' } : null))[2]!.status).toBe('ok');
  });
  it('⭐ kilit YALNIZ ⚠: bakılmamış ama eksiksiz parti kilitlemez; neden + parti yazılır', () => {
    const tabs = partyTabs(multiOf(), new Set());
    expect(partyLock(tabs).map((t) => t.blockNo)).toEqual([3]);
    expect(partyLockText(partyLock(tabs))).toBe('Parti 3 · Gelen metre eksik');
    const full = { ...multiOf(), rows: multiOf().rows.map((r) => ({ ...r, meters: 10 })) };
    expect(partyLock(partyTabs(full, new Set()))).toEqual([]);
    expect(multiPartyIssues(multiOf())).toEqual(['Parti metresi eksik: Parti 3.']);
  });
  it('tek partide sekme yok', () => {
    expect(showPartyTabs({ mode: 'SINGLE', rows: [{ blockNo: 1, batchNo: '', meters: 1 }] })).toBe(false);
    expect(showPartyTabs(null)).toBe(false);
    expect(showPartyTabs(multiOf())).toBe(true);
  });
  it('store: parti sekmesi açılınca bakıldı; "Tümü" saymaz', () => {
    const h = renderHook(() => usePartyTabState('n1'));
    act(() => selectPartyTab('n1', 'all'));
    expect(h.result.current[0].visited.size).toBe(0);
    act(() => h.result.current[1](2));
    expect(h.result.current[0]).toEqual({ active: 2, visited: new Set([2]) });
  });
});

describe('PartyRows sekmeleri (tablet)', () => {
  const shown = (ui: ReturnType<typeof renderWithPaper>, b: number) => ui.getByTestId(`belge-parti-GB-1-${b}`, { includeHiddenElements: true });
  it('⭐ ilk sekme "Tümü": tablo görünür, parti panoları gizli; satıra dokununca o partinin sekmesi', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf()} wo={wo()} locked={false} />);
    expect(ui.getByTestId('belge-parti-tablo-GB-1')).toBeVisible();
    [1, 2, 3].forEach((b) => expect(shown(ui, b)).not.toBeVisible());
    expect(ui.getByTestId('belge-parti-sekme-GB-1-2-durum')).toHaveTextContent('●');
    fireEvent.press(ui.getByTestId('belge-parti-tablo-GB-1-2'));
    expect(shown(ui, 2)).toBeVisible();
    expect(shown(ui, 1)).not.toBeVisible();
    expect(ui.queryByTestId('belge-parti-tablo-GB-1')).toBeNull();
    expect(ui.getByTestId('belge-parti-sekme-GB-1-2-durum')).toHaveTextContent('✓');
    fireEvent.press(ui.getByTestId('belge-parti-sekme-GB-1-tumu'));
    expect(ui.getByTestId('belge-parti-tablo-GB-1-2-durum')).toHaveTextContent('✓ Tamam');
  });
  it('⭐ kilit notu ⚠ partiyi ve nedenini söyler; dokununca o sekme açılır', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf()} wo={wo()} locked={false} />);
    expect(ui.getByTestId('belge-parti-sekme-GB-1-3-durum')).toHaveTextContent('⚠');
    expect(ui.getByTestId('belge-parti-sekme-GB-1-3')).toHaveTextContent(/Parti 3/);
    expect(ui.getByTestId('belge-parti-kilit-GB-1')).toHaveTextContent(/Parti 3 · Gelen metre eksik/);
    fireEvent.press(ui.getByTestId('belge-parti-kilit-GB-1'));
    expect(shown(ui, 3)).toBeVisible();
    expect(ui.getByTestId('belge-parti-eksik-GB-1-3')).toHaveTextContent(/Gelen metre eksik/);
  });
  it('⭐ hatasız partilerde kilit notu yok (bakılmamış olsalar da)', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf(viewOf([party(1), party(2)]))} wo={wo()} locked={false} />);
    expect(ui.queryByTestId('belge-parti-kilit-GB-1')).toBeNull();
  });
  it('⭐ tek partide sekme çizilmez, pano görünür (bugünkü görünüm)', () => {
    const row = rowOf(viewOf([party(1), party(2)]));
    const one = { ...row, form: { ...row.form!, multi: { ...row.form!.multi!, rows: row.form!.multi!.rows.slice(0, 1) } } };
    const ui = renderWithPaper(<PartyRows row={one} wo={wo()} locked={false} />);
    expect(ui.queryByTestId('belge-parti-sekme-GB-1')).toBeNull();
    expect(ui.queryByTestId('belge-parti-tablo-GB-1')).toBeNull();
    expect(shown(ui, 1)).toBeVisible();
  });
});

describe('belge önizlemesi: parti bölmesi + fotoğraf odağı', () => {
  it('⭐ partinin satırları (özet satırı hariç) + sayfa + kutu birleşimi; tarama/sayfa yoksa null', () => {
    expect(partyLines(lines, 1).map((l) => l.id)).toEqual(['a', 'b']);
    const f = partyFocus(partyLines(lines, 2), detail.scans, [{ sha256: 'x' }, { sha256: 'h1' }])!;
    expect(f).toEqual({ pageIndex: 1, rect: { x: 100, y: 400, width: 200, height: 50 }, frame: { w: 1000, h: 1400 } });
    expect(partyFocus(partyLines(lines, 2), detail.scans, [{ sha256: 'x' }])).toBeNull();
    expect(partyFocus([line('z', [1, 1, 1], { scanId: null })], detail.scans, [{ sha256: 'h1' }])).toBeNull();
  });
  it('⭐ kutu ortalanır; çerçeveyi taşan kutu (başka görüntü) vurgulanmaz', () => {
    const g = focusGeometry({ x: 100, y: 400, width: 200, height: 50 }, { w: 1000, h: 1400 }, { w: 500, h: 700 })!;
    expect(g.box.x).toBeCloseTo(50);
    expect(g.scale).toBeGreaterThan(1);
    expect(g.box.x + g.box.width / 2 - 250 + g.tx / g.scale).toBeCloseTo(0);
    expect(focusGeometry({ x: 900, y: 0, width: 300, height: 10 }, { w: 1000, h: 1400 }, { w: 500, h: 700 })).toBeNull();
  });
  const Harness = ({ row, onPage, index = 0 }: { row: DocRow; onPage: (i: number) => void; index?: number }) => {
    const r = usePartyScanReview(row, [{ sha256: 'h1' }], onPage);
    return <PagePreviewModal pages={[{ sha256: 'h1', uri: 'file:///h1.jpg' }]} index={index} uploaded={new Set(['h1'])} onIndex={jest.fn()} onDismiss={jest.fn()} side={r?.side} focus={r?.focus} testID="onizleme" />;
  };
  // Portal içeriği mikrotaskta güncellenir (SimplePortal ertelemesi).
  const flush = () => act(async () => {});
  it('⭐ sekmeye basınca partinin alanları + top satırları + beyan uyuşmazlığı; foto sayfası seçilir ve kutu vurgulanır', async () => {
    const onPage = jest.fn();
    const ui = renderWithPaper(<Harness row={rowOf()} onPage={onPage} />);
    await flush();
    expect(ui.getByTestId('belge-onizleme-parti-GB-1-tablo')).toBeTruthy();
    expect(ui.queryByTestId('belge-tara-onizleme-vurgu')).toBeNull();
    fireEvent.press(ui.getByTestId('belge-onizleme-parti-GB-1-sekme-3'));
    expect(onPage).toHaveBeenCalledWith(0);
    await flush();
    expect(ui.getByTestId('belge-onizleme-parti-GB-1-3-uyari')).toHaveTextContent(/3 TOP yazıyor, 2 satır var/);
    expect(ui.getByTestId('belge-onizleme-parti-GB-1-3-toplar')).toHaveTextContent(/T5/);
    fireEvent(ui.getByTestId('belge-tara-onizleme-gorsel').parent!.parent!, 'layout', { nativeEvent: { layout: { width: 500, height: 700 } } });
    await flush();
    expect(ui.getByTestId('belge-tara-onizleme-vurgu')).toBeTruthy();
    // Aynı sekme durumu İE formuyla ortak: önizlemede bakılan parti formda ✓, bakılmayan ●.
    fireEvent.press(ui.getByTestId('belge-onizleme-parti-GB-1-sekme-2'));
    await flush();
    const form = renderWithPaper(<PartyRows row={rowOf()} wo={wo()} locked={false} />);
    expect(form.getByTestId('belge-parti-sekme-GB-1-2-durum')).toHaveTextContent('✓');
    expect(form.getByTestId('belge-parti-sekme-GB-1-1-durum')).toHaveTextContent('●');
  });
  it('tek partili belgede önizleme yalnız fotoğraf (bölme yok)', async () => {
    const row = rowOf(viewOf([party(1), party(2)]));
    const one = { ...row, form: { ...row.form!, multi: null } };
    const ui = renderWithPaper(<Harness row={one} onPage={jest.fn()} />);
    await flush();
    expect(ui.queryByTestId('onizleme-yan')).toBeNull();
    expect(ui.getByTestId('belge-tara-onizleme-gorsel')).toBeTruthy();
  });
});

describe('PartyRows — bizim parti no tahmini (seri kipi)', () => {
  it('⭐ her parti sekmesinde ardışık tahmin; açılmış parti sayılmaz', async () => {
    mockNumberState.mockResolvedValue({ success: true, data: { enabled: true, lastCode: 'P04', nextCode: 'P05', nextCodes: ['P05', 'P06'], min: 1, max: 99 } });
    const row = { ...rowOf(), result: { kind: 'OPENED', workOrders: [{ id: 'w1', workOrderNo: 'IE-1', blockNos: [1] }], failed: [{ blockNo: 2, message: 'x' }] } } as unknown as DocRow;
    const ui = renderWithPaper(<PartyRows row={row} wo={{ ...wo(), batchSource: 'SERIES' } as unknown as WoRowsState} locked={false} />);
    const val = (b: number) => ui.getByTestId(`belge-parti-bizim-GB-1-${b}`, { includeHiddenElements: true }).props.value;
    await waitFor(() => expect(val(2)).toBe('Otomatik · sıradaki: P05'));
    expect(val(3)).toBe('Otomatik · sıradaki: P06');
    expect(ui.queryByTestId('belge-parti-bizim-GB-1-1', { includeHiddenElements: true })).toBeNull();
    expect(mockNumberState).toHaveBeenCalledWith(2);
  });
  it('belgeden kipinde alan yok, önizleme istenmez', () => {
    const ui = renderWithPaper(<PartyRows row={rowOf()} wo={{ ...wo(), batchSource: 'DOCUMENT' } as unknown as WoRowsState} locked={false} />);
    expect(ui.queryByTestId('belge-parti-bizim-GB-1-1', { includeHiddenElements: true })).toBeNull();
    expect(mockNumberState).not.toHaveBeenCalled();
  });
});
