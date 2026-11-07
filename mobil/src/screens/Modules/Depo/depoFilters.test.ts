import { depoRollsFilters, type ModeFilter } from './depoFilters';

// Mülkiyet ALL iken setler T3 öncesiyle BAYT-AYNI (eski istek); backend bekçisi `test_mulkiyet_kapsami`
// §9 `TABLET_DEPO_TABS` bu setlerin aynasıdır — burada değişen set orada da değişir.
const BEFORE_T3: Record<Exclude<ModeFilter, 'SWATCH'>, Record<string, string | string[]>> = {
  ALL: { includeFire: 'true', statusIn: ['WAREHOUSE', 'A1_STOCK', 'STOCK'] },
  WAREHOUSE: { includeFire: 'true', shipmentScope: 'free', status: 'WAREHOUSE' },
  IN_SACK: { includeFire: 'true', rollScope: 'IN_SACK', status: 'ALL' },
  STOCK: { includeFire: 'true', shipmentScope: 'free', rollScope: 'RAW_STOCK_PURE', status: 'ALL' },
  SEMI_FINISHED: { includeFire: 'true', shipmentScope: 'free', rollScope: 'SEMI_FINISHED', status: 'ALL' },
  KARTELALIK: { includeFire: 'true', shipmentScope: 'free', statusIn: ['WAREHOUSE', 'A1_STOCK', 'STOCK'], markedForKartela: 'true' },
};

describe('Depo süzgeç seti (liste + şerit tek kaynak)', () => {
  it.each(Object.keys(BEFORE_T3) as (keyof typeof BEFORE_T3)[])('%s: mülkiyet ALL → T3 öncesiyle aynı, parametre yok', (mode) => {
    const f = depoRollsFilters(mode, 'ALL');
    expect(f).toEqual(BEFORE_T3[mode]);
    expect('mulkiyet' in f).toBe(false);
  });

  it.each(Object.keys(BEFORE_T3) as (keyof typeof BEFORE_T3)[])('%s: Bizim/Emanet yalnız mulkiyet ekler, sekme setine dokunmaz', (mode) => {
    expect(depoRollsFilters(mode, 'OWN')).toEqual({ ...BEFORE_T3[mode], mulkiyet: 'OWN' });
    expect(depoRollsFilters(mode, 'CONSIGNED')).toEqual({ ...BEFORE_T3[mode], mulkiyet: 'CONSIGNED' });
  });
});
