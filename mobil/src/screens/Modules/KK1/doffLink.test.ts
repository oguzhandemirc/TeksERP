import { EMPTY_DOFF_LINK, doffLinkPayload, doffRowLabel, isDoffLinkVisible, validateDoffLink } from './doffLink';

describe('doffLink — KK1 dokuma bağı (saf)', () => {
  it('⭐ bayrak KAPALI → iki soru çizilmez ve payload bugünküyle birebir (alan yok)', () => {
    expect(isDoffLinkVisible(false, false, 'TABLET_DOFF')).toBe(false);
    expect(doffLinkPayload({ weaving: true, doffEventId: 'd1' }, false, false, 'TABLET_DOFF')).toEqual({});
    expect('doffEventId' in doffLinkPayload({ weaving: true, doffEventId: 'd1' }, false, false, 'TABLET_DOFF')).toBe(false);
  });

  it('yarı mamul modunda sorular gizli; bağ verilemez', () => {
    expect(isDoffLinkVisible(true, true, 'TABLET_DOFF')).toBe(false);
    expect(doffLinkPayload({ weaving: true, doffEventId: 'd1' }, true, true, 'TABLET_DOFF')).toEqual({});
  });

  it('⭐ dokuma AÇIK: "dokuma değil" → alan yok; "dokuma, seçim yok" → null (doff\'suz top kovası); seçim → id', () => {
    expect(doffLinkPayload(EMPTY_DOFF_LINK, true, false, 'TABLET_DOFF')).toEqual({});
    expect(doffLinkPayload({ weaving: true, doffEventId: null }, true, false, 'TABLET_DOFF')).toEqual({ doffEventId: null });
    expect(doffLinkPayload({ weaving: true, doffEventId: 'd1' }, true, false, 'TABLET_DOFF')).toEqual({ doffEventId: 'd1' });
  });

  it('doğrulama: yalnız görünürken ve yarı mamul + bağ çakışmasında kırmızı', () => {
    expect(validateDoffLink({ weaving: true, doffEventId: 'd1' }, true, false, 'TABLET_DOFF').ok).toBe(true);
    expect(validateDoffLink({ weaving: true, doffEventId: 'd1' }, false, true, 'TABLET_DOFF').ok).toBe(true);
  });

  it('⭐ S3a: rollBirth KK1_* → soru GİZLİ ve payload BOŞ (yerini tezgah etiketi alır); TABLET_DOFF bugünkü', () => {
    for (const mode of ['KK1_LABEL_OR_ORDER', 'KK1_LABEL_ONLY'] as const) {
      expect(isDoffLinkVisible(true, false, mode)).toBe(false);
      expect(doffLinkPayload({ weaving: true, doffEventId: 'd1' }, true, false, mode)).toEqual({});
      expect(validateDoffLink({ weaving: true, doffEventId: 'd1' }, true, false, mode).ok).toBe(true);
    }
    expect(isDoffLinkVisible(true, false, 'TABLET_DOFF')).toBe(true);
  });

  it('satır etiketi kod · saat · parça · hat (· makine)', () => {
    const l = doffRowLabel({ code: 'DF1409260001', doffedAt: '2026-09-14T09:05:00.000Z', pieceCount: 2, productionLineNo: 1, machine: { code: 'T3', name: 'Tezgah 3' } });
    expect(l).toMatch(/^DF1409260001 · \d{2}:\d{2} · 2 parça · hat 1 · T3$/);
    expect(doffRowLabel({ code: 'X', doffedAt: 'bozuk', pieceCount: 1, productionLineNo: 2 })).toBe('X · — · 1 parça · hat 2');
    expect(doffRowLabel({ code: 'X', doffedAt: 'bozuk', pieceCount: 1, productionLineNo: 2, machine: null })).toBe('X · — · 1 parça · hat 2');
  });
});
