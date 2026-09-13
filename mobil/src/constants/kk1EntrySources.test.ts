import { KK1_LIST_ENTRY_SOURCES, KK1_LIST_ENTRY_SOURCE_CSV, rollEntrySourceLabels } from './kk1EntrySources';

describe('kk1EntrySources — KK1 liste kapsamı ve etiketler', () => {
  it('⭐ WEAVING kapsamda: tezgahtan inen top KK1 listelerinde görünür (01 ölçtü: eksikti)', () => {
    expect(KK1_LIST_ENTRY_SOURCES).toContain('WEAVING');
    expect(KK1_LIST_ENTRY_SOURCE_CSV.split(',')).toContain('WEAVING');
  });

  it('bugünkü kapsam korunur: ham giriş · panel elle giriş · yarı mamul (sıra dahil)', () => {
    expect(KK1_LIST_ENTRY_SOURCE_CSV).toBe('SUPPLIER_RECEIPT,MANUAL_ENTRY,SEMI_FINISHED,WEAVING');
  });

  it('kapsamdaki her kaynağın Türkçe etiketi var; WEAVING → "Dokuma"', () => {
    for (const s of KK1_LIST_ENTRY_SOURCES) expect(rollEntrySourceLabels[s].length).toBeGreaterThan(2);
    expect(rollEntrySourceLabels.WEAVING).toBe('Dokuma');
  });

  it('etiket haritası boş/ham değer taşımaz (her değer okunur Türkçe)', () => {
    for (const [k, v] of Object.entries(rollEntrySourceLabels)) {
      expect(v).not.toBe(k);
      expect(v.trim().length).toBeGreaterThan(2);
    }
  });
});
