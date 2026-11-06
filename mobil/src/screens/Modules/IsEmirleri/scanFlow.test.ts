import type { ProductionRoute } from '../../../services/route.service';
import type { ReadSummary } from '../../../services/inboundDoc.service';
import { SCAN_ROUTE_ID } from '../GelenBelge/woCreate/woFromDoc';
import { customerGoodsTiles, defaultType, previewTiles, resolveType, scanWoType, tileLayout, typeGroups } from './scanFlow';

const r = (id: string, name: string, over: Partial<ProductionRoute> = {}): ProductionRoute => ({ id, name, steps: [], ...over }) as ProductionRoute;
const all = [r('b', 'Boya'), r('a', 'Apre'), r('p', 'Pasif', { isActive: false }), r('k', 'Kısayol', { isWorkOrderShortcut: true, shortcutOrder: 1 })];
const shortcuts = [r('k', 'Kısayol', { isWorkOrderShortcut: true, shortcutOrder: 1 })];

describe('İş emri türü grupları', () => {
  it('Okutmayla: özel grup rotasız + kısayollar; hazır rotalar = kalan aktifler (ad sırası); varsayılan rotasız', () => {
    const g = typeGroups(all, shortcuts, true);
    expect(g.special.map((x) => x.id)).toEqual([SCAN_ROUTE_ID, 'k']);
    expect(g.ready.map((x) => x.id)).toEqual(['a', 'b']);
    expect(defaultType(g, true)?.id).toBe(SCAN_ROUTE_ID);
  });

  it('Sıralı: rotasız SUNULMAZ (sunucu 400 verir); varsayılan ilk hazır rota', () => {
    const g = typeGroups(all, shortcuts, false);
    expect(g.special.map((x) => x.id)).toEqual(['k']);
    expect(defaultType(g, false)?.id).toBe('a');
  });

  it('Sıralı + hazır rota yok → ilk kısayol; hiçbiri yok → null (Okut pasif)', () => {
    expect(defaultType(typeGroups([], shortcuts, false), false)?.id).toBe('k');
    expect(defaultType(typeGroups([], [], false), false)).toBeNull();
  });

  it('seçili tür listede yoksa (kip değişti / rota pasif) varsayılana döner', () => {
    const g = typeGroups(all, shortcuts, false);
    expect(resolveType('b', g, false)?.id).toBe('b');
    expect(resolveType(SCAN_ROUTE_ID, g, false)?.id).toBe('a');
    expect(resolveType('p', g, false)?.id).toBe('a');
  });
});

const base: ReadSummary = { noteId: 'n', noteNo: 'GB-1', noteStatus: 'DRAFT', state: 'READ', reason: null, pages: { total: 1, waiting: 0, read: 1, failed: 0 }, lineCount: 3, reviewCount: 0, totals: { declared: false, ok: null, mismatches: [] }, warnings: [] };

describe('önizleme karoları', () => {
  it('şablon alanları: bulunan yeşil (değerli), bulunamayan kırmızı "Bulunamadı"', () => {
    const t = previewTiles({ ...base, templateFields: [{ key: 'fisNo', label: 'Fiş No', value: '12', required: true }, { key: 'tarih', label: 'Tarih', value: null, required: false }] });
    expect(t).toEqual([
      { key: 'fisNo', label: 'Fiş No', value: '12', state: 'found' },
      { key: 'tarih', label: 'Tarih', value: 'Bulunamadı', state: 'missing' },
    ]);
  });

  it('şablon yoksa yedek karolar; bulunamayan gri (kırmızı DEĞİL — şablonda işaretli değil)', () => {
    const t = previewTiles({ ...base, customerBatchNo: 'P-7', kursunMeters: '1250.5', ownerSuggestion: { customerId: 'c', name: 'Gül Tekstil', matchedText: 'gul' } });
    expect(t.find((x) => x.key === 'musteri')).toMatchObject({ value: 'Gül Tekstil', state: 'found' });
    expect(t.find((x) => x.key === 'parti')).toMatchObject({ value: 'P-7', state: 'found' });
    expect(t.find((x) => x.key === 'metre')?.value).toBe((1250.5).toLocaleString('tr-TR'));
    expect(t.find((x) => x.key === 'renk')).toMatchObject({ value: '—', state: 'unknown' });
    expect(t.some((x) => x.state === 'missing')).toBe(false);
  });
});

describe('kaydırmasız karo yerleşimi', () => {
  it('yatay tablet 4 sütun, dikey telefon 2 sütun; karo ≥72dp, değer yazısı 16–28', () => {
    const tab = tileLayout(8, 732, 420);
    expect([tab.columns, tab.hidden]).toEqual([4, 0]);
    const tel = tileLayout(6, 340, 520);
    expect([tel.columns, tel.hidden]).toEqual([2, 0]);
    for (const L of [tab, tel]) {
      expect(L.tileHeight).toBeGreaterThanOrEqual(72);
      expect(L.valueSize).toBeGreaterThanOrEqual(16);
      expect(L.valueSize).toBeLessThanOrEqual(28);
    }
  });

  it('her yerleşim verilen yüksekliğe sığar (kaydırma yok); sığmayan "+N alan" karosuna düşer', () => {
    for (const [n, w, h] of [[4, 732, 420], [12, 732, 420], [30, 732, 300], [9, 340, 520], [25, 340, 300]] as const) {
      const L = tileLayout(n, w, h);
      expect(L.rows * L.tileHeight + 12 * (L.rows - 1)).toBeLessThanOrEqual(h);
      expect(L.shown + L.hidden).toBe(n);
      expect(L.shown + (L.hidden > 0 ? 1 : 0)).toBeLessThanOrEqual(L.columns * L.rows);
    }
  });
});

describe('Fason okutma', () => {
  const base = { noteNo: 'N1', lineCount: 2, reviewCount: 0 } as unknown as Parameters<typeof customerGoodsTiles>[0];
  it('düğme → tür: Fason düğmesi CUSTOMER_GOODS_SERVICE, İE oluştur bugünkü türetme', () => {
    expect(scanWoType('CUSTOMER_GOODS')).toBe('CUSTOMER_GOODS_SERVICE');
    expect(scanWoType('STANDARD')).toBeNull();
  });
  it('müşteri karosu başta; eşleşmemiş belge metni müşteri sayılmaz', () => {
    const miss = customerGoodsTiles({ ...base, ownerUnmatched: { text: 'ACME' } } as typeof base);
    expect(miss[0]).toMatchObject({ key: 'musteri', state: 'missing' });
    expect(miss.filter((t) => t.key === 'musteri')).toHaveLength(1);
    const hit = customerGoodsTiles({ ...base, ownerSuggestion: { customerId: 'c1', name: 'Gül Tekstil', matchedText: 'GUL' } } as unknown as typeof base);
    expect(hit[0]).toMatchObject({ key: 'musteri', value: 'Gül Tekstil', state: 'found' });
  });
});
