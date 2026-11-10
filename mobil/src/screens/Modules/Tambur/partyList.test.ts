// Parti listesi: gruplama, ≤1 partide gizli / ≥2 görünür, geçişte taslak belleği (geri dönünce son hal).
import { draftKey, partyCards, showJobTabs, showPartyList, switchDraft } from './partyList';

const roll = (rollId: string, batchId: string | null, qty: number, batchNumber: string | null = batchId ? `P-${batchId}` : null) => ({
  rollId, batchId, batchNumber, branchOrdinal: 1, currentQty: qty,
});

describe('partyCards', () => {
  it('toplar partiye göre gruplanır, metre toplanır, seçili top kendi partisini vurgular', () => {
    const cards = partyCards([roll('r1', 'b1', 100), roll('r2', 'b2', 70), roll('r3', 'b1', 30)], 'r3');
    expect(cards).toEqual([
      { key: 'b1', label: 'P-b1', meters: 130, rollId: 'r3', selected: true },
      { key: 'b2', label: 'P-b2', meters: 70, rollId: 'r2', selected: false },
    ]);
  });
  it('partisiz toplar tek "Partisiz" kartında', () => {
    expect(partyCards([roll('r1', null, 5), roll('r2', null, 6)], null)).toEqual([
      { key: 'none', label: 'Partisiz', meters: 11, rollId: 'r1', selected: false },
    ]);
  });
});

describe('showPartyList / showJobTabs', () => {
  it('≤1 parti → kart gizli; ≥2 → görünür', () => {
    expect(showPartyList([])).toBe(false);
    expect(showPartyList(partyCards([roll('r1', 'b1', 1)], 'r1'))).toBe(false);
    expect(showPartyList(partyCards([roll('r1', 'b1', 1), roll('r2', 'b2', 1)], 'r1'))).toBe(true);
  });
  it('iş sekmeleri yalnız birden çok açık işte', () => {
    expect(showJobTabs(1)).toBe(false);
    expect(showJobTabs(2)).toBe(true);
  });
});

describe('switchDraft — parti geçişinde state korunur', () => {
  it('A → B → A: A\'nın son hali geri gelir, B ilk girişte boş başlar', () => {
    const mem = new Map<string, { len: string; kg: string }>();
    const a = draftKey('card', 'rA');
    const b = draftKey('card', 'rB');
    expect(switchDraft(mem, null, a, { len: '', kg: '' })).toBeNull();
    // A'da metre/kg girildi, B'ye geçildi → B için saklı taslak yok (varsayılan).
    expect(switchDraft(mem, a, b, { len: '50', kg: '1,4' })).toBeNull();
    // B'de başka değer girildi, A'ya dönüldü → A aynen.
    expect(switchDraft(mem, b, a, { len: '20', kg: '' })).toEqual({ len: '50', kg: '1,4' });
    // Yeniden B → B'nin son hali.
    expect(switchDraft(mem, a, b, { len: '50', kg: '1,4' })).toEqual({ len: '20', kg: '' });
  });
  it('aynı anahtar (geçiş yok) → null: bugünkü sıfırlama yolu', () => {
    const mem = new Map<string, number>();
    expect(switchDraft(mem, 'k', 'k', 1)).toBeNull();
    expect(mem.size).toBe(0);
  });
  it('anahtar kart+top; eksikse null', () => {
    expect(draftKey('c', 'r')).toBe('c:r');
    expect(draftKey(null, 'r')).toBeNull();
  });
});
