// K17 — istasyonda belgeden iş emri bulma: sunucu sonucu → ekran kararı (tek aç · çok seçtir · yok mesaj).
import { decideLookup, searchable, workOrderSubtitle } from './decide';
import type { StationLookupResult, StationLookupWorkOrder } from '../../services/stationDocLookup.service';

const wo = (n: string, extra: Partial<StationLookupWorkOrder> = {}): StationLookupWorkOrder => ({
  id: `id-${n}`, workOrderNumber: n, status: 'IN_PROGRESS', cardBarcode: n, batchNumbers: [`P-${n}`], documents: [{ noteNo: 'GB1', senderDocNo: '914279' }], ...extra,
});
const res = (workOrders: StationLookupWorkOrder[], outcome: StationLookupResult['outcome'], message = 'm'): StationLookupResult => ({ outcome, source: 'OCR', read: null, workOrders, message });

describe('decideLookup', () => {
  it('⭐ tek iş emri → doğrudan açılır', () => {
    const d = decideLookup(res([wo('IE1')], 'SINGLE'));
    expect(d).toEqual({ kind: 'open', workOrder: wo('IE1') });
  });
  it('⭐ çok iş emri → seçtirilir (sıra sunucudan)', () => {
    const d = decideLookup(res([wo('IE1'), wo('IE2')], 'MULTIPLE', '2 iş emri bulundu'));
    expect(d.kind).toBe('choose');
    expect(d.kind === 'choose' && d.workOrders.map((w) => w.workOrderNumber)).toEqual(['IE1', 'IE2']);
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
  it('arama en az 2 karakter', () => {
    expect(searchable(' 9 ')).toBe(false);
    expect(searchable('91')).toBe(true);
  });
});
