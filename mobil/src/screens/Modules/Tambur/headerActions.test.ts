import { tamburHeaderActions, TAMBUR_HEADER_COLLAPSE_BELOW_DP } from './headerActions';

const base = {
  manualMode: false,
  docLookupEnabled: true,
  canLinkOrders: true,
  canFieldFix: true,
  hasActiveJob: true,
};

describe('tamburHeaderActions', () => {
  it('SM-X210 yatay (1280 dp): seyrek yetkili aksiyonlar "Diğer"e katlanır', () => {
    const r = tamburHeaderActions({ ...base, width: 1280 });
    expect(r.inline).toEqual(['list', 'scan', 'doc', 'recent', 'recut']);
    expect(r.overflow).toEqual(['orderLink', 'fieldFix', 'manual', 'standalone']);
  });

  it('geniş ekranda hepsi satırda kalır (bugünkü davranış)', () => {
    const r = tamburHeaderActions({ ...base, width: TAMBUR_HEADER_COLLAPSE_BELOW_DP });
    expect(r.overflow).toEqual([]);
    expect(r.inline).toHaveLength(9);
  });

  it('açık manuel mod durum çipidir, menüye gizlenmez', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, manualMode: true });
    expect(r.inline).toEqual(['recent', 'manual']);
    expect(r.overflow).toEqual([]);
  });

  it('yetkisiz operatörde katlanacak tek öğe kalırsa menü açılmaz', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, canLinkOrders: false, canFieldFix: false });
    expect(r.overflow).toEqual([]);
    expect(r.inline).toContain('standalone');
  });

  it('hiçbir aksiyon iki kez çizilmez ve kaybolmaz', () => {
    for (const width of [800, 1280, 1600]) {
      const r = tamburHeaderActions({ ...base, width });
      const all = [...r.inline, ...r.overflow];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toHaveLength(9);
    }
  });

  it('etiket bilgisi (geniş ana kesim) her genişlikte "Diğer"de, satıra çıkmaz', () => {
    for (const width of [1280, 1600]) {
      const r = tamburHeaderActions({ ...base, width, labelInfo: true });
      expect(r.inline).not.toContain('labelInfo');
      expect(r.overflow[r.overflow.length - 1]).toBe('labelInfo');
    }
  });

  it('etiket bilgisi varken tek seyrek aksiyon da menüde toplanır (menü zaten var)', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, canLinkOrders: false, canFieldFix: false, labelInfo: true });
    expect(r.overflow).toEqual(['standalone', 'labelInfo']);
  });

  it('manuel modda etiket bilgisi eklenmez', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, manualMode: true, labelInfo: true });
    expect([...r.inline, ...r.overflow]).not.toContain('labelInfo');
  });

  it('tek açık işte sekmenin detay/yenile/kapat eylemleri "Diğer"e iner', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, labelInfo: true, singleJobTab: true });
    expect(r.overflow.slice(-4)).toEqual(['labelInfo', 'woDetail', 'refreshJob', 'closeJob']);
    expect(r.inline).not.toContain('closeJob');
  });

  it('açık iş yokken sekme eylemleri eklenmez', () => {
    const r = tamburHeaderActions({ ...base, width: 1280, hasActiveJob: false, singleJobTab: true });
    expect(r.overflow).not.toContain('closeJob');
  });

  it('iş yokken tam ekran boş durumda elle kart no "Diğer"de; iş açıkken yok', () => {
    const wide = tamburHeaderActions({ ...base, width: 1600, hasActiveJob: false, cardCodeEntry: true });
    expect(wide.overflow).toEqual(['cardCode']);
    expect(wide.inline).toContain('list');
    const narrow = tamburHeaderActions({ ...base, width: 1280, hasActiveJob: false, cardCodeEntry: true });
    expect(narrow.overflow).toContain('cardCode');
    expect(tamburHeaderActions({ ...base, width: 1600, hasActiveJob: true, cardCodeEntry: true }).overflow).not.toContain('cardCode');
  });
});
