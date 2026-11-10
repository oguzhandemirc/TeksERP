import { layoutStationActions, overflowHasBadge, type StationAction } from './stationActionLayout';

const a = (id: string, priority: number, extra: Partial<StationAction> = {}): StationAction => ({
  id,
  label: id,
  icon: 'x',
  priority,
  visible: true,
  onPress: () => {},
  ...extra,
});

// Tambur el terminali sırası (bildirim sırası ≠ öncelik).
const tambur = [a('openJobs', 1), a('list', 4), a('scan', 3), a('doc', 2), a('standalone', 7), a('manual', 6)];
const ids = (xs: StationAction[]) => xs.map((x) => x.id);

describe('layoutStationActions', () => {
  it('dar (480 dp): öncelikli 3 çubukta, bildirim sırasıyla; gerisi taşar', () => {
    const r = layoutStationActions(tambur, 480);
    expect(r.narrow).toBe(true);
    expect(ids(r.inline)).toEqual(['openJobs', 'scan', 'doc']);
    expect(ids(r.overflow)).toEqual(['list', 'standalone', 'manual']);
  });

  it('dar: çubuk ve menü ayrık, birlikte tüm görünürleri kapsar', () => {
    const r = layoutStationActions(tambur, 480);
    expect(ids(r.inline).filter((x) => ids(r.overflow).includes(x))).toEqual([]);
    expect(r.inline.length + r.overflow.length).toBe(tambur.length);
  });

  it('geniş (≥600): bugünkü düzen — hepsi satırda, menü yok', () => {
    const r = layoutStationActions(tambur, 800);
    expect(r.narrow).toBe(false);
    expect(ids(r.inline)).toEqual(ids(tambur));
    expect(r.overflow).toEqual([]);
  });

  it('görünmez aksiyon ne çubukta ne menüde', () => {
    const xs = tambur.map((x) => (x.id === 'doc' || x.id === 'manual' ? { ...x, visible: false } : x));
    for (const w of [480, 800]) {
      const r = layoutStationActions(xs, w);
      expect([...ids(r.inline), ...ids(r.overflow)]).not.toContain('doc');
      expect([...ids(r.inline), ...ids(r.overflow)]).not.toContain('manual');
    }
    // Belge kapalıyken Açık Kartlar çubuğa yükselir.
    const noDoc = tambur.map((x) => (x.id === 'doc' ? { ...x, visible: false } : x));
    expect(ids(layoutStationActions(noDoc, 480).inline)).toEqual(['openJobs', 'list', 'scan']);
  });

  it('dar ama en fazla 4 aksiyon: katlanmaz ("Diğer" tek aksiyonla takas olmaz)', () => {
    const r = layoutStationActions(tambur.slice(0, 4), 480);
    expect(r.inline).toHaveLength(4);
    expect(r.overflow).toEqual([]);
  });

  it('rozet: yalnız taşan aksiyonda varsa "Diğer" noktası', () => {
    expect(overflowHasBadge([a('x', 1, { badge: 2 })])).toBe(true);
    expect(overflowHasBadge([a('x', 1, { badge: 0 }), a('y', 2)])).toBe(false);
  });
});
