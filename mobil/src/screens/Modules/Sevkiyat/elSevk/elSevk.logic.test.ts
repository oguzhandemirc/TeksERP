// El terminali sevkiyatı v2 — saf modüller: liste sorgusu, satır metni, özet, seçim, okutma sonucu, toplu etiket.
import { DEFAULT_LIST_FILTER, activeFilterCount, listQueryKey, listQueryParams } from './listQuery';
import { rowChip, rowDate, rowKg, rowLoadLine, rowMeters, rowSackCount, rowTarget } from './listRow';
import { dispatchSummary, loadSummaryLine, parseKgInput, sackKgDisplay, sackMeta, summaryMetrics } from './summary';
import { reconcileSelection, targetLabel, toggleSelection } from './selection';
import { interpretOutcome, interpretScanError } from './scanOutcome';
import { labelButtonText, labelTargets, mergeLabelHtml } from './bulkLabel';
import { loadState, roll, sack } from '../../../../test/handheldStateFixture';

describe('listQuery', () => {
  it('varsayılan: yalnız cursor + tarih yeni→eski; süzgeç anahtarı yok', () => {
    expect(listQueryParams(DEFAULT_LIST_FILTER, '')).toEqual({ mode: 'cursor', limit: '30', sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('durum, cari, arama, cursor ve sıralamalar', () => {
    const f = { ...DEFAULT_LIST_FILTER, status: 'PLANNED' as const, customer: { id: 'c1', name: 'HH' }, sort: 'customer' as const };
    expect(listQueryParams(f, '  SVK-7 ', 'cur1')).toEqual({
      mode: 'cursor', limit: '30', sortBy: 'customerName', sortOrder: 'asc', status: 'PLANNED', customerId: 'c1', search: 'SVK-7', cursor: 'cur1',
    });
    expect(listQueryParams({ ...DEFAULT_LIST_FILTER, sort: 'oldest' }, '').sortOrder).toBe('asc');
  });

  it('tarih aralığı dateField ile fabrika günü sınırlarına çevrilir', () => {
    const p = listQueryParams({ ...DEFAULT_LIST_FILTER, range: { from: new Date(2026, 10, 1), to: new Date(2026, 10, 3) } }, '');
    expect(p.dateField).toBe('createdAt');
    expect(p.dateFrom).toMatch(/^2026-10-31T|^2026-11-01T/);
    expect(new Date(p.dateTo!).getTime()).toBeGreaterThan(new Date(p.dateFrom!).getTime());
  });

  it('rozet sayısı sıralamayı saymaz; anahtar süzgeçle değişir', () => {
    expect(activeFilterCount({ ...DEFAULT_LIST_FILTER, sort: 'customer' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_LIST_FILTER, status: 'DISPATCHED', customer: { id: 'c', name: 'x' } })).toBe(2);
    expect(listQueryKey(DEFAULT_LIST_FILTER, 'a')).not.toEqual(listQueryKey(DEFAULT_LIST_FILTER, 'b'));
  });
});

describe('listRow', () => {
  const base = { kind: 'SHIPMENT' as const, status: 'PLANNED' as const, createdAt: '2026-11-11T08:00:00.000Z', dispatchedAt: null };
  it('çip: açık, açık·boş (K4), sevk edildi', () => {
    expect(rowChip({ status: 'PLANNED', _count: { sacks: 1, rolls: 3 } }).label).toBe('Açık');
    expect(rowChip({ status: 'PLANNED', _count: { sacks: 0, rolls: 0 } })).toEqual({ label: 'Açık · boş', tone: 'empty' });
    expect(rowChip({ status: 'DISPATCHED', _count: { sacks: 1, rolls: 3 } }).tone).toBe('done');
  });

  it('çuval sayısı dökme/araba birimini düşer; yük satırı', () => {
    const r = { _count: { sacks: 3, rolls: 11, bulks: 1, carts: 0 } };
    expect(rowSackCount(r)).toBe(2);
    expect(rowLoadLine(r)).toBe('2 çuval · 11 top');
    expect(rowLoadLine({ _count: { sacks: 1, rolls: 4, bulks: 1 } })).toBe('4 top');
  });

  it('metre/kg tr-TR; kg yoksa null', () => {
    expect(rowMeters({ totalMeters: 1234.5 })).toBe('1.234,5 m');
    expect(rowKg({ totalKg: 0 })).toBeNull();
    expect(rowKg({ totalKg: 56.25 })).toBe('56,3 kg');
  });

  it('tarih: sevk edilmişte sevk anı', () => {
    expect(rowDate({ ...base, status: 'DISPATCHED', dispatchedAt: '2026-11-11T09:30:00.000Z' })).not.toBe(rowDate(base));
  });

  it('hedef: açık → okut, sevk edildi → salt-okunur, doğrudan sevk → yok', () => {
    expect(rowTarget({ kind: 'SHIPMENT', status: 'PLANNED' })).toBe('scan');
    expect(rowTarget({ kind: 'SHIPMENT', status: 'DISPATCHED' })).toBe('readonly');
    expect(rowTarget({ kind: 'DIRECT', status: 'DISPATCHED' })).toBe('none');
  });
});

describe('summary', () => {
  it('özet şeridi dört ölçü; kg yoksa —', () => {
    const m = summaryMetrics(loadState({ sacks: [sack('1', [roll('a')])], loose: [roll('b')] }).summary);
    expect(m.map((x) => `${x.value} ${x.unit}`)).toEqual(['1 çuval', '2 top', '100 m', '20 kg']);
    expect(summaryMetrics(loadState().summary)[3]!.value).toBe('—');
  });

  it('çuval kg: elle girilen önce, yoksa toplam (gri), yoksa hiç', () => {
    expect(sackKgDisplay({ weightKg: 12.5, rollKgSum: 20 })).toEqual({ kind: 'manual', text: '12,5 kg' });
    expect(sackKgDisplay({ weightKg: null, rollKgSum: 20 })).toEqual({ kind: 'sum', text: '20 kg' });
    expect(sackKgDisplay({ weightKg: null, rollKgSum: null }).kind).toBe('none');
    expect(sackMeta(sack('1', []))).toBe('Boş');
    expect(sackMeta(sack('1', [roll('a'), roll('b')]))).toBe('2 top · 100 m');
  });

  it('sevk özeti boş çuvalları ayırır; yük satırı irsaliye biçiminde', () => {
    const d = dispatchSummary(loadState({ sacks: [sack('1', [roll('a'), roll('b')]), sack('2', [])], loose: [roll('c'), roll('d'), roll('e')] }));
    expect(d.sacks).toHaveLength(1);
    expect(d.emptySackNos).toEqual(['ÇV-2']);
    expect(loadSummaryLine(d)).toBe('1 çuval (2 top) + 3 top dökme');
    expect(loadSummaryLine({ sacks: [], looseRollCount: 2 })).toBe('2 top dökme');
  });

  it('kg girişi: >0, ≤9999,999, en çok 3 ondalık', () => {
    expect(parseKgInput('12.5')).toBe(12.5);
    expect(parseKgInput('12,5')).toBe(12.5);
    expect(parseKgInput('0')).toBeNull();
    expect(parseKgInput('')).toBeNull();
    expect(parseKgInput('10000')).toBeNull();
    expect(parseKgInput('1.2345')).toBeNull();
  });
});

describe('selection', () => {
  it('dokunuş seçer, ikinci dokunuş kaldırır, başka çuval seçimi taşır', () => {
    expect(toggleSelection(null, 'a')).toBe('a');
    expect(toggleSelection('a', 'a')).toBeNull();
    expect(toggleSelection('a', 'b')).toBe('b');
  });

  it('sunucuda düşen çuval seçimden kalkar; hedef etiketi', () => {
    const s = loadState({ sacks: [sack('1', [])] });
    expect(reconcileSelection('1', s)).toBe('1');
    expect(reconcileSelection('9', s)).toBeNull();
    expect(targetLabel(s, '1')).toBe('ÇV-1');
    expect(targetLabel(s, null)).toBe('Çuvalsız');
  });
});

describe('scanOutcome', () => {
  const to = { sackId: 's2', label: 'ÇV-2' };
  const from = { sackId: null, label: 'Çuvalsız' };
  it('added/transferred/removed → kabul sesi + şerit', () => {
    expect(interpretOutcome({ kind: 'added', rollId: 'r', barcode: 'T1', to })).toMatchObject({ signal: 'accept', highlight: 's2', prompt: null });
    const t = interpretOutcome({ kind: 'transferred', rollId: 'r', barcode: 'T1', from, to });
    expect(t.banner?.text).toBe('T1: Çuvalsız → ÇV-2');
    expect(interpretOutcome({ kind: 'removed', rollId: 'r', barcode: 'T1', from, unitDissolved: true }).signal).toBe('accept');
  });

  it('onay soruları sinyal vermez ve yeniden gönderim bayrağını taşır', () => {
    const r = interpretOutcome({ kind: 'needsRemoveConfirm', rollId: 'r', barcode: 'T1', from: to });
    expect(r.signal).toBeNull();
    expect(r.prompt).toMatchObject({ title: 'Çıkarmak istiyor musunuz?', tone: 'danger', resend: { confirmRemove: true }, barcode: 'T1' });
    const n = interpretOutcome({ kind: 'needsNotReadyConfirm', rollId: 'r', barcode: 'T1', reason: 'ROLL_NOT_READY', stageLabel: 'Ham (işlenmemiş)' });
    expect(n.signal).toBeNull();
    expect(n.prompt?.body).toContain('Yine de eklensin mi?');
    expect(n.prompt?.resend).toEqual({ confirmNotReady: true });
  });

  it('K7 çuval kodu → seçim; ret → sunucu metni (boşsa yedek)', () => {
    expect(interpretOutcome({ kind: 'sackSelected', sackId: 's2', sackNo: 'ÇV-2' }).select).toBe('s2');
    const rej = interpretOutcome({ kind: 'rejected', reason: 'OWNER_MISMATCH', message: 'Başka carinin malı: X', barcode: 'T1' });
    expect(rej).toMatchObject({ signal: 'reject', banner: { tone: 'error', text: 'Başka carinin malı: X' } });
    expect(interpretOutcome({ kind: 'rejected', reason: 'ROLL_NOT_PHYSICAL', message: '', barcode: 'T1' }).banner?.text).toBe('Top şu an sevk edilemez');
  });

  it('HTTP hataları: hedef çuval yok → seçim kalkar; yarış → tazele', () => {
    const e = (code: string) => Object.assign(new Error('m'), { status: 409, details: { code } });
    expect(interpretScanError(e('TARGET_SACK_GONE'))).toMatchObject({ clearSelection: true, refetch: true });
    expect(interpretScanError(e('ROLL_TAKEN'))).toMatchObject({ clearSelection: false, refetch: true });
    expect(interpretScanError(new Error('')).banner.text).toBe('Okutulamadı');
  });
});

describe('bulkLabel', () => {
  it('yalnız dolu çuvallar, sıra numarasıyla', () => {
    const s = loadState({ sacks: [sack('b', [roll('1')], { seq: 2 }), sack('a', [roll('2')], { seq: 1 }), sack('c', [], { seq: 3 })] });
    expect(labelTargets(s).map((t) => t.label)).toEqual(['ÇV-a', 'ÇV-b']);
    expect(labelTargets(undefined)).toEqual([]);
  });

  it('düğme metni', () => {
    expect(labelButtonText({ running: true, done: 3, total: 5, failed: 0 })).toBe('Etiket 3/5');
    expect(labelButtonText({ running: false, done: 5, total: 5, failed: 2 })).toBe('Kalanları bas (2)');
    expect(labelButtonText({ running: false, done: 0, total: 0, failed: 0 })).toBe('Çuval etiketleri');
  });

  it('HTML birleşimi: tek başlık, sayfa sonu araya', () => {
    const h = (b: string) => `<html><head><style>x{}</style></head><body><p>${b}</p></body></html>`;
    const m = mergeLabelHtml([h('1'), h('2')]);
    expect(m.match(/<style>/g)).toHaveLength(1);
    expect(m).toContain('<p>1</p>');
    expect(m).toContain('<p>2</p>');
    expect(m.match(/page-break-after/g)).toHaveLength(1);
    expect(mergeLabelHtml([h('1')])).toBe(h('1'));
    expect(mergeLabelHtml([])).toBe('');
  });
});
