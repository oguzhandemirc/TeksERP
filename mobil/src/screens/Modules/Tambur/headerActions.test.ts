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
});
