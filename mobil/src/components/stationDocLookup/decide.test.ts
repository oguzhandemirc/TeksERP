// K17 — istasyonda belgeden iş emri bulma: sunucu sonucu → ekran kararı (tek aç · çok seçtir · yok mesaj).
import { decideLookup, partyLabel, rowDetail, rowWhere, partySelectorModel, searchable, unsureMessage, verifyBadges, verifyScoreText, verifyText, workOrderSubtitle } from './decide';
import type { StationLookupResult, StationLookupWorkOrder } from '../../services/stationDocLookup.service';

const wo = (n: string, extra: Partial<StationLookupWorkOrder> = {}): StationLookupWorkOrder => ({
  id: `id-${n}`, workOrderNumber: n, status: 'IN_PROGRESS', cardBarcode: n, batchNumbers: [`P-${n}`], documents: [{ noteNo: 'GB1', senderDocNo: '914279' }], ...extra,
});
const res = (workOrders: StationLookupWorkOrder[], outcome: StationLookupResult['outcome'], message = 'm', label: string | null = null): StationLookupResult => ({
  outcome, source: 'OCR', read: null, workOrders, message, ...(label ? { station: { screen: 'KURSUN_QC' as const, label } } : {}),
});
const at = (n: string, atStation: StationLookupWorkOrder['atStation']) => wo(n, { atStation, atStationText: atStation ? 'x' : null });
const names = (ws: StationLookupWorkOrder[]) => ws.map((w) => w.workOrderNumber);

describe('decideLookup', () => {
  it('⭐ tek iş emri → doğrudan açılır', () => {
    const d = decideLookup(res([wo('IE1')], 'SINGLE'));
    expect(d).toEqual({ kind: 'open', workOrder: wo('IE1'), siblings: [] });
  });
  it('⭐ çok iş emri → seçtirilir (sıra sunucudan)', () => {
    const d = decideLookup(res([wo('IE1'), wo('IE2')], 'MULTIPLE', '2 iş emri bulundu'));
    expect(d.kind).toBe('choose');
    expect(d.kind === 'choose' && d.workOrders.map((w) => w.workOrderNumber)).toEqual(['IE1', 'IE2']);
  });
  it('⭐ eski sunucu (atStation yok) → bugünkü liste + sunucu cümlesi', () => {
    const d = decideLookup(res([wo('IE1'), wo('IE2')], 'MULTIPLE', 'sunucu'));
    expect(d).toEqual({ kind: 'choose', workOrders: [wo('IE1'), wo('IE2')], message: 'sunucu' });
  });
  it('⭐ çokta TEK burada → o açılır + kardeşler (şerit)', () => {
    const all = [at('IE1', 'NOT_YET'), at('IE2', 'HERE'), at('IE3', 'PASSED')];
    const d = decideLookup(res(all, 'MULTIPLE', 'm', 'Kurşun 1'));
    expect(d.kind === 'open' && d.workOrder.workOrderNumber).toBe('IE2');
    expect(d.kind === 'open' && names(d.siblings)).toEqual(['IE1', 'IE2', 'IE3']);
  });
  it('⭐ rotasız "burada başlatılabilir" (STARTABLE_HERE) burada sayılır → tekse doğrudan açılır', () => {
    const d = decideLookup(res([at('IE1', 'NOT_ON_ROUTE'), at('IE2', 'STARTABLE_HERE')], 'MULTIPLE'));
    expect(d.kind === 'open' && d.workOrder.workOrderNumber).toBe('IE2');
  });
  it('⭐ ikisi burada (biri rotasız) → seçtir, burada olanlar üstte', () => {
    const d = decideLookup(res([at('IE1', 'NOT_YET'), at('IE2', 'HERE'), at('IE3', 'STARTABLE_HERE')], 'MULTIPLE', 'm', 'Kurşun 1'));
    expect(d.kind).toBe('choose');
    expect(d.kind === 'choose' && names(d.workOrders)).toEqual(['IE2', 'IE3', 'IE1']);
    expect(d.kind === 'choose' && d.message).toBe('Bu belgede 3 parti var; 2 tanesi bu istasyonda (Kurşun 1) açılabilir. Açılacak olanı seçin.');
  });
  it('⭐ hiçbiri burada → seçtir + açıklayıcı cümle', () => {
    const d = decideLookup(res([at('IE1', 'NOT_YET'), at('IE2', 'NOT_ON_ROUTE')], 'MULTIPLE', 'm', 'Kurşun 1'));
    expect(d).toEqual({ kind: 'choose', workOrders: [at('IE1', 'NOT_YET'), at('IE2', 'NOT_ON_ROUTE')], message: 'Bu belgede 2 parti var; hiçbiri bu istasyonda (Kurşun 1) beklemiyor. Nerede olduklarına bakıp yine de açabilirsiniz.' });
  });
  it('⭐ iş emri yok / belge yok / okunamadı → sunucunun cümlesi', () => {
    for (const o of ['NO_WORK_ORDER', 'NO_DOCUMENT', 'NO_DOC_NO', 'UNREADABLE'] as const) {
      expect(decideLookup(res([], o, 'Bu belgeye ait terbiye iş emri yok.'))).toEqual({ kind: 'empty', message: 'Bu belgeye ait terbiye iş emri yok.' });
    }
  });
});

describe('yardımcılar', () => {
  it('alt metin: parti no + fiş no (yoksa GB no)', () => {
    expect(workOrderSubtitle(wo('IE1'))).toBe('P-IE1 · Belge 914279');
    expect(workOrderSubtitle(wo('IE2', { batchNumbers: [], documents: [{ noteNo: 'GB9', senderDocNo: null }] }))).toBe('Belge GB9');
  });
  it('satır: parti no büyük yazı, ayrıntı, nerede', () => {
    const w = wo('IE1', { processText: 'YIKAMA', rollCount: 3, meters: 250.5, documents: [{ noteNo: 'GB1', senderDocNo: null, customerOrderNo: 'MS-1' }], atStationText: 'Rotasız · burada başlatılabilir', locationText: 'Henüz başlamadı' });
    expect(partyLabel(w)).toBe('P-IE1');
    expect(partyLabel(wo('IE2', { batchNumbers: [] }))).toBe('IE2');
    expect(rowDetail(w)).toBe('YIKAMA · 3 top · 250,5 m · Müşteri İE MS-1 · IE1');
    expect(rowWhere(w)).toBe('Rotasız · burada başlatılabilir · Henüz başlamadı');
  });
  it('satır: tek parça İE "Tek parça · gelen metre" der; top top gelende ve eski sunucuda bugünkü metin', () => {
    const single = wo('IE1011260004', { rollCount: 0, meters: 0, arrival: { form: 'SINGLE_PIECE', meters: 241 }, documents: [{ noteNo: 'GB1', senderDocNo: null }] });
    expect(rowDetail(single)).toBe('Tek parça · 241 m · IE1011260004');
    expect(rowDetail({ ...single, arrival: { form: 'SINGLE_PIECE', meters: 240.5 } })).toBe('Tek parça · 240,5 m · IE1011260004');
    expect(rowDetail({ ...single, rollCount: 4, meters: 407, arrival: { form: 'ROLLS', meters: 407 } })).toBe('4 top · 407 m · IE1011260004');
    expect(rowDetail({ ...single, arrival: undefined })).toBe('0 top · 0 m · IE1011260004');
  });
  it('arama en az 2 karakter', () => {
    expect(searchable(' 9 ')).toBe(false);
    expect(searchable('91')).toBe(true);
  });
});

describe('doğrulama (2026-11-06)', () => {
  const ver = (score: number | null, passed: boolean, targetKey = 'n1') => ({
    score, passed, strongEvidence: score !== null, threshold: 80, targetKey,
    components: [
      { key: 'ROLL_NOS', label: 'Top no', weight: 40, ratio: 3 / 16, matched: false, detail: '3/16' },
      { key: 'OWNER', label: 'Müşteri', weight: 5, ratio: 1, matched: true, detail: 'tuttu' },
    ],
  });
  it('⭐ hiçbir aday eşiği geçmedi → TEK aday bile kendiliğinden AÇILMAZ (emin değilim + puan)', () => {
    const r = { ...res([], 'UNVERIFIED', 'sunucu'), unverifiedWorkOrders: [wo('IE1', { verification: ver(62, false) })], verification: { threshold: 80, bestScore: 62 } };
    const d = decideLookup(r);
    expect(d.kind).toBe('unsure');
    expect(d.kind === 'unsure' && d.message).toBe('Belge tam eşleşmedi (%62) — doğru işi seçin.');
    expect(d.kind === 'unsure' && names(d.workOrders)).toEqual(['IE1']);
  });
  it('⭐ top listesi okunamadı (puan yok) → nedeni söylenir', () => {
    expect(unsureMessage(null)).toBe('Belge doğrulanamadı — doğru işi seçin.');
    expect(unsureMessage(100, false)).toBe(unsureMessage(null));
  });
  it('⭐ eşiği geçen tek aday → açılır (bugünkü yol)', () => {
    const d = decideLookup(res([wo('IE1', { verification: ver(95, true) })], 'SINGLE'));
    expect(d.kind).toBe('open');
  });
  it('⭐ iki FARKLI belge eşiği geçti → burada olsa bile seçtirilir', () => {
    const d = decideLookup(res([at('IE1', 'HERE'), at('IE2', 'NOT_YET')].map((w, i) => ({ ...w, verification: ver(90, true, `n${i}`) })), 'MULTIPLE', 'sunucu'));
    expect(d).toEqual(expect.objectContaining({ kind: 'choose', message: 'sunucu' }));
  });
  it('⭐ aynı belgenin partileri (aynı hedef) → burada olan tek İE açılır', () => {
    const d = decideLookup(res([at('IE1', 'HERE'), at('IE2', 'NOT_YET')].map((w) => ({ ...w, verification: ver(90, true, 'n1') })), 'MULTIPLE'));
    expect(d.kind === 'open' && d.workOrder.workOrderNumber).toBe('IE1');
  });
  it('ne tuttu / ne tutmadı metni', () => {
    expect(verifyText(wo('IE1', { verification: ver(62, false) }))).toBe('%62 · Top no ✗ 3/16 · Müşteri ✓');
    expect(verifyText(wo('IE1'))).toBe('');
  });
});

describe('doğrulama rozetleri (gece UX turu)', () => {
  const comp = (key: string, label: string, ratio: number, detail: string) => ({ key, label, weight: 1, ratio, matched: ratio >= 0.999, detail });
  const v = (components: ReturnType<typeof comp>[], score: number | null = 62) =>
    wo('IE9', { verification: { score, passed: false, strongEvidence: true, threshold: 80, targetKey: 't', components } });
  it('⭐ tuttu / kısmi / tutmadı ayrılır; kısmi eşleşme ✗ sayılmaz; "tuttu" ayrıntısı yazılmaz', () => {
    const b = verifyBadges(v([comp('OWNER', 'Müşteri', 1, 'tuttu'), comp('ROLL_NOS', 'Top no', 3 / 16, '3/16'), comp('BATCH_NO', 'Parti no', 0.75, 'benzer'), comp('ORDER_NO', 'Sipariş no', 0, 'okunan 56967')]));
    expect(b.map((x) => [x.label, x.tone, x.detail])).toEqual([
      ['Müşteri', 'ok', null],
      ['Top no', 'partial', '3/16'],
      ['Parti no', 'partial', 'benzer'],
      ['Sipariş no', 'miss', 'okunan 56967'],
    ]);
  });
  it('⭐ puan metni: eşikli · puansız · doğrulamasız', () => {
    expect(verifyScoreText(v([], 62))).toBe('%62 · eşik %80');
    expect(verifyScoreText(v([], null))).toBe('Puan yok');
    expect(verifyScoreText(wo('IE1'))).toBeNull();
    expect(verifyBadges(wo('IE1'))).toEqual([]);
  });
});

describe('partySelectorModel — kompakt parti seçici', () => {
  const sibs = [wo('IE1'), wo('IE2'), wo('IE3'), wo('IE4')].map((w) => ({ ...w, cardBarcode: `K-${w.workOrderNumber}` }));
  it('⭐ 2–3 parti segment; seçili = belgeden açılan kart', () => {
    const m = partySelectorModel(sibs.slice(0, 2), 'K-IE2');
    expect(m?.mode).toBe('segment');
    expect(m?.opened.workOrderNumber).toBe('IE2');
    expect(m?.options.map((o) => [o.label, o.selected])).toEqual([['P-IE1', false], ['P-IE2', true]]);
    expect(partySelectorModel(sibs.slice(0, 3), 'K-IE1')?.mode).toBe('segment');
  });
  it('⭐ 3ten fazla parti PickerModal (picker)', () => {
    expect(partySelectorModel(sibs, 'K-IE4')?.mode).toBe('picker');
  });
  it('tek parti / aktif kart eşleşmez / kart yok → çizilmez', () => {
    expect(partySelectorModel(sibs.slice(0, 1), 'K-IE1')).toBeNull();
    expect(partySelectorModel(sibs, 'K-BASKA')).toBeNull();
    expect(partySelectorModel(sibs, null)).toBeNull();
  });
});
