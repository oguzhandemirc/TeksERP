import { meterDetailView, meterListView, signedMeters, type MeterParty, type WorkOrderMeterSummary } from './meterView';

const sum = (o: Partial<WorkOrderMeterSummary>): WorkOrderMeterSummary => ({
  declaredM: 241, measuredMaxM: 500, billedM: 500, diffM: 259, diffPct: 107.47, withinTolerance: false, longerThanDeclared: true, ...o,
});
const party = (o: Partial<MeterParty>): MeterParty => ({
  partyKey: 'k1', batchNo: 'P-1', declaredM: 100, kursunOutM: 120, tamburInM: 119, tamburCutM: 118, measuredMaxM: 120, billedM: 120, diffM: 20, longerThanDeclared: true, ...o,
});

describe('meterListView — liste satırı', () => {
  it('beyandan uzun: Giren · Çıkan + turuncu fazla rozeti', () => {
    expect(meterListView(sum({}))).toEqual({ text: 'Giren 241 · Çıkan 500', badge: { text: '+259 m', tone: 'over' } });
  });
  it('tr-TR binlik ayracı', () => {
    expect(meterListView(sum({ declaredM: 1241, measuredMaxM: 2500.4, diffM: 1259 }))?.text).toBe('Giren 1.241 · Çıkan 2.500');
  });
  it('tolerans içi uzun → rozet yok (negatif sonda: longer=false iken turuncu çıkmaz)', () => {
    expect(meterListView(sum({ measuredMaxM: 242, diffM: 1, longerThanDeclared: false, withinTolerance: true }))?.badge).toBeNull();
  });
  it('eksik → gri −X m', () => {
    expect(meterListView(sum({ measuredMaxM: 230, diffM: -11, longerThanDeclared: false }))?.badge).toEqual({ text: '−11 m', tone: 'short' });
  });
  it('ölçüm yok → Çıkan —, rozet yok', () => {
    expect(meterListView(sum({ measuredMaxM: null, diffM: null, longerThanDeclared: false }))).toEqual({ text: 'Giren 241 · Çıkan —', badge: null });
  });
  it('özet yok / boş → null', () => {
    expect(meterListView(null)).toBeNull();
    expect(meterListView(undefined)).toBeNull();
    expect(meterListView(sum({ declaredM: null, measuredMaxM: null }))).toBeNull();
  });
});

describe('meterDetailView — ayrıntı kartı', () => {
  const totals = { declaredM: 241, measuredMaxM: 500, billedM: 500, diffM: 259 };
  it('tek parti: üç sayı + Faturaya, parti satırı yok', () => {
    const v = meterDetailView({ tolerancePct: 0.5, parties: [party({})], totals });
    expect(v).toMatchObject({ giren: '241 m', cikan: '500 m', fazla: '+259 m', fazlaTone: 'over', billed: 'Faturaya: 500 m', parties: [] });
  });
  it('çok parti: parti başına satır; tambur çıkanı yoksa girene düşer', () => {
    const v = meterDetailView({ tolerancePct: 0.5, parties: [party({}), party({ partyKey: 'k2', batchNo: null, tamburCutM: null, diffM: -5, longerThanDeclared: false })], totals });
    expect(v?.parties).toEqual([
      { key: 'k1', batch: 'P-1', declared: '100', kursun: '120', tambur: '118', diff: '+20 m', tone: 'over' },
      { key: 'k2', batch: '—', declared: '100', kursun: '120', tambur: '119', diff: '−5 m', tone: 'short' },
    ]);
  });
  it('hiçbir parti uzun değilse fazla turuncu değil', () => {
    const v = meterDetailView({ tolerancePct: 0.5, parties: [party({ longerThanDeclared: false })], totals: { ...totals, diffM: 1 } });
    expect(v?.fazlaTone).toBeNull();
  });
  it('parti yok / metre yok → null', () => {
    expect(meterDetailView(null)).toBeNull();
    expect(meterDetailView({ tolerancePct: 0.5, parties: [], totals })).toBeNull();
    expect(meterDetailView({ tolerancePct: 0.5, parties: [party({})], totals: { declaredM: null, measuredMaxM: null, billedM: null, diffM: null } })).toBeNull();
  });
  it('signedMeters işaretleri', () => {
    expect([signedMeters(3), signedMeters(-3), signedMeters(0.2), signedMeters(null)]).toEqual(['+3 m', '−3 m', '0 m', null]);
  });
});
