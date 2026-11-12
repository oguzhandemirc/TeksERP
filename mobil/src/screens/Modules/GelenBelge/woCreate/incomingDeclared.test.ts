import { applyDeclaredText, declaredBodyPart, docDeclaredText, partyDeclaredText, shownDeclared } from './incomingDeclared';

const decl = { itemText: ' TÜL ', colorText: null, suggestedItem: null, suggestedColor: null };

describe('incomingDeclared', () => {
  it('belge değeri: incomingDeclared önce, yoksa şablon metni', () => {
    expect(docDeclaredText({ incomingDeclared: decl }, 'item')).toBe('TÜL');
    expect(docDeclaredText({ incomingDeclared: decl }, 'color')).toBeNull();
    expect(docDeclaredText({ formFields: { renkText: 'EKRU' } } as never, 'color')).toBe('EKRU');
    expect(docDeclaredText(null, 'item')).toBeNull();
  });
  it('parti: bölüm değeri, null ise belge geneli', () => {
    expect(partyDeclaredText({ incomingItemText: 'B' } as never, { incomingDeclared: decl }, 'item')).toBe('B');
    expect(partyDeclaredText({ incomingItemText: null } as never, { incomingDeclared: decl }, 'item')).toBe('TÜL');
  });
  it('yazılan metin: belgeyle aynı = düzeltme yok; boş + belgede var = beyan yok; yeni = düzeltme', () => {
    expect(applyDeclaredText('TÜL', 'TÜL')).toEqual({ text: null, edited: false });
    expect(applyDeclaredText('', 'TÜL')).toEqual({ text: null, edited: true });
    expect(applyDeclaredText('', null)).toEqual({ text: null, edited: false });
    expect(applyDeclaredText(' X ', 'TÜL')).toEqual({ text: 'X', edited: true });
  });
  it('⭐ gövde parçası yalnız düzeltildiyse', () => {
    expect(declaredBodyPart({ text: 'X', edited: false }, 'item')).toEqual({});
    expect(declaredBodyPart(undefined, 'color')).toEqual({});
    expect(declaredBodyPart({ text: 'X', edited: true }, 'item')).toEqual({ incomingItemText: 'X' });
    expect(declaredBodyPart({ text: null, edited: true }, 'color')).toEqual({ incomingColorText: null });
  });
  it('ekrandaki değer', () => {
    expect(shownDeclared({ text: 'X', edited: true }, 'D')).toBe('X');
    expect(shownDeclared({ text: 'X', edited: false }, 'D')).toBe('D');
  });
});
