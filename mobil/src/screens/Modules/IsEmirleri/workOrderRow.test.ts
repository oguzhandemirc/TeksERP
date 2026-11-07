import { activeFilterCount, batchText, buildListQuery, customerText, DEFAULT_FILTERS, emptyStateFor, fabricText, locationBadge, PAGE_SIZE, rollMeterText, typeBadgeText, type WorkOrderLocation } from './workOrderRow';
import { stationToneFor } from '../../../theme/stationTone';

const st = (over: Partial<WorkOrderLocation['istasyonlar'][number]> = {}) => ({
  istasyonId: 's1', ad: 'Kurşun', tur: 'PROCESS_QC', dis: false, topSayisi: 8, metre: 800, fasondaTop: 0, fasoncular: [], ...over,
});

describe('locationBadge — "şu an nerede" rozeti', () => {
  it('tek istasyon: ad + istasyon tonu + top sayısı', () => {
    const b = locationBadge({ sinif: 'TEK_ISTASYON', canliTop: 8, istasyonlar: [st()] }, 'IN_PROGRESS');
    expect(b).toEqual({ kind: 'station', text: 'Kurşun', extra: 0, tone: stationToneFor(false, 'PROCESS_QC'), detail: '8 top' });
  });

  it('fasonda: fasoncu adı rozette, istasyon adı ayrıntıda, fason tonu', () => {
    const b = locationBadge({ sinif: 'FASONDA', canliTop: 5, istasyonlar: [st({ ad: 'Boyahane', tur: 'SUBCONTRACTOR', dis: true, topSayisi: 5, fasondaTop: 5, fasoncular: ['Gül Boya'] })] }, 'IN_PROGRESS');
    expect(b.kind === 'station' && [b.text, b.detail, b.tone.key]).toEqual(['Gül Boya', 'Boyahane · 5 top', 'fason']);
  });

  it('bölünmüş: ilk istasyon + "+N"', () => {
    const b = locationBadge({ sinif: 'BOLUNMUS', canliTop: 12, istasyonlar: [st(), st({ istasyonId: 's2', ad: 'Tambur', tur: 'TAMBUR' }), st({ istasyonId: 's3', ad: 'Depo', tur: 'SHIPPING' })] }, 'IN_PROGRESS');
    expect(b.kind === 'station' && [b.text, b.extra]).toEqual(['Kurşun', 2]);
  });

  it('istasyonsuz: iptal / devredildi / başlamadı / tamamlandı / üretim bitti; konum yok → tire', () => {
    const empty = (sinif: WorkOrderLocation['sinif']): WorkOrderLocation => ({ sinif, canliTop: 0, istasyonlar: [] });
    expect(locationBadge(empty('BITTI'), 'CANCELLED')).toEqual({ kind: 'plain', text: 'İptal', detail: '' });
    expect(locationBadge(empty('BITTI'), 'SUPERSEDED').kind === 'plain' && locationBadge(empty('BITTI'), 'SUPERSEDED')).toMatchObject({ text: 'Devredildi' });
    expect(locationBadge(empty('BASLAMADI'), 'PLANNED')).toMatchObject({ text: 'Başlamadı' });
    expect(locationBadge(empty('BITTI'), 'COMPLETED')).toMatchObject({ text: 'Tamamlandı' });
    expect(locationBadge(empty('BITTI'), 'IN_PROGRESS')).toMatchObject({ text: 'Üretim bitti' });
    expect(locationBadge(undefined, 'PLANNED')).toMatchObject({ kind: 'plain', text: '—' });
  });
});

describe('hücre metinleri', () => {
  it('müşteri +N, kumaş · renk, parti +N, top · metre', () => {
    expect(customerText({ customers: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] })).toBe('A +1');
    expect(customerText({ customers: [] })).toBe('—');
    expect(fabricText({ targetItem: { name: 'Saten' }, targetColor: { name: 'Ekru' } })).toBe('Saten · Ekru');
    expect(fabricText({ targetItem: null, targetColor: null })).toBe('—');
    expect(batchText({ batches: [{ batchNumber: 'P01' }], _count: { batches: 3 } })).toBe('P01 +2');
    expect(batchText({ batches: [] })).toBe('—');
    expect(rollMeterText({ konum: { sinif: 'TEK_ISTASYON', canliTop: 4, istasyonlar: [] }, inputMeters: 1250.4 })).toBe(`4 top · ${(1250).toLocaleString('tr-TR')} m`);
  });
});

describe('buildListQuery — süzme sunucuda', () => {
  it('varsayılan: yalnız açık durumlar; arama/istasyon/tarih yok', () => {
    expect(buildListQuery(DEFAULT_FILTERS)).toEqual({ filters: { status: 'PLANNED,IN_PROGRESS' } });
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('kısa arama gönderilmez, kırpılır; Tümü durum filtresi koymaz; istasyon konumIstasyon olur', () => {
    expect(buildListQuery({ ...DEFAULT_FILTERS, search: ' a ' }).search).toBeUndefined();
    expect(buildListQuery({ ...DEFAULT_FILTERS, search: ' IE-12 ' }).search).toBe('IE-12');
    expect(buildListQuery({ ...DEFAULT_FILTERS, status: 'ALL' }).filters).toEqual({});
    expect(buildListQuery({ ...DEFAULT_FILTERS, stationId: 'st-1' }).filters).toEqual({ status: 'PLANNED,IN_PROGRESS', konumIstasyon: 'st-1' });
  });

  it('tarih aralığı fabrika günü sınırlarıyla createdAt üzerinden', () => {
    const q = buildListQuery({ ...DEFAULT_FILTERS, range: { from: new Date(2026, 10, 1), to: new Date(2026, 10, 3, 23, 59) } });
    expect(q.dateField).toBe('createdAt');
    expect(typeof q.dateFrom).toBe('string');
    expect(new Date(q.dateTo!).getTime()).toBeGreaterThan(new Date(q.dateFrom!).getTime() + 2 * 86_400_000);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, range: { from: new Date(), to: new Date() }, stationId: 'x' })).toBe(2);
  });

  it('sayfa boyu 30–50 arası', () => {
    expect(PAGE_SIZE).toBeGreaterThanOrEqual(30);
    expect(PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});

describe('emptyStateFor — boş liste başlığı + çıkış eylemi', () => {
  it('varsayılan "Açık" süzgeci: "henüz yok" DEMEZ, tüm durumları önerir', () => {
    const e = emptyStateFor(DEFAULT_FILTERS);
    expect(e.title).toBe('"Açık" durumunda terbiye iş emri yok');
    expect(e.action).toBe('showAllStatuses');
  });

  it('Tümü + süzgeçsiz: gerçekten hiç kayıt yok, eylem yok', () => {
    const e = emptyStateFor({ ...DEFAULT_FILTERS, status: 'ALL' });
    expect(e.title).toBe('Henüz terbiye iş emri yok');
    expect(e.action).toBeNull();
  });

  it('arama / istasyon / tarih daraltması: süzgeçleri temizle önerir', () => {
    expect(emptyStateFor({ ...DEFAULT_FILTERS, search: 'ab' }).action).toBe('clearFilters');
    expect(emptyStateFor({ ...DEFAULT_FILTERS, status: 'ALL', stationId: 's1' }).action).toBe('clearFilters');
    expect(emptyStateFor({ ...DEFAULT_FILTERS, range: { from: new Date(), to: new Date() } }).action).toBe('clearFilters');
  });

  it('tek harflik arama daraltma sayılmaz (sunucuya gitmez)', () => {
    expect(emptyStateFor({ ...DEFAULT_FILTERS, search: 'a' }).action).toBe('showAllStatuses');
  });
});

describe('typeBadgeText — tür rozeti', () => {
  it('yalnız Fason (müşteri malı) işaretlenir; kendi üretimi ve eski sunucu rozetsiz', () => {
    expect(typeBadgeText({ type: 'CUSTOMER_GOODS_SERVICE' })).toBe('Fason (müşteri malı)');
    expect(typeBadgeText({ type: 'ORDER_PRODUCTION' })).toBeNull();
    expect(typeBadgeText({ type: 'STOCK_PRODUCTION' })).toBeNull();
    expect(typeBadgeText({})).toBeNull();
  });
});
