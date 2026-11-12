import { SEARCH_CLOSED, activeSearchTerm, collapsibleSearchReducer as r } from './collapsibleSearch';

describe('collapsibleSearch', () => {
  it('başlangıç kapalı ve boş', () => {
    expect(SEARCH_CLOSED).toEqual({ open: false, text: '' });
    expect(activeSearchTerm(SEARCH_CLOSED)).toBe('');
  });
  it('toggle açar, ikinci toggle kapatır ve metni temizler', () => {
    const opened = r(SEARCH_CLOSED, { type: 'toggle' });
    expect(opened).toEqual({ open: true, text: '' });
    const typed = r(opened, { type: 'text', text: 'SVK-12' });
    expect(activeSearchTerm(typed)).toBe('SVK-12');
    const closed = r(typed, { type: 'toggle' });
    expect(closed).toEqual({ open: false, text: '' });
    expect(activeSearchTerm(closed)).toBe('');
  });
  it('yeniden açınca eski metin geri gelmez', () => {
    const s = r(r(r(SEARCH_CLOSED, { type: 'toggle' }), { type: 'text', text: 'abc' }), { type: 'toggle' });
    expect(r(s, { type: 'toggle' }).text).toBe('');
  });
  it('kapalıyken gelen metin yok sayılır', () => {
    expect(r(SEARCH_CLOSED, { type: 'text', text: 'geç kalan' })).toBe(SEARCH_CLOSED);
  });
  it('close açıkken kapatıp temizler, kapalıyken aynı nesneyi döner', () => {
    expect(r({ open: true, text: 'x' }, { type: 'close' })).toEqual(SEARCH_CLOSED);
    expect(r(SEARCH_CLOSED, { type: 'close' })).toBe(SEARCH_CLOSED);
  });
  it('terim kırpılır; yalnız boşluk → boş', () => {
    expect(activeSearchTerm({ open: true, text: '  ab  ' })).toBe('ab');
    expect(activeSearchTerm({ open: true, text: '   ' })).toBe('');
  });
});
