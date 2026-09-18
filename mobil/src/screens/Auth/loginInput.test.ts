// =============================================================================
// loginInput — sayısal vs harfli parola alanı temizleyicileri (K bulgusu 2026-09-18)
// =============================================================================
// NEGATİF SONDA: harfli parola sayısal temizleyiciden geçerse alfasayısal parola bozulur ve giriş
// reddedilir — gerçek cihazda "_yNh6z91473t" ABC klavyeyle yazıldı, `\D` süzmesi "91473"e indirdi,
// sunucu "Geçersiz kullanıcı adı veya şifre" verdi (2026-09-18 tablet provası).
// =============================================================================
import { sanitizeAlphaInput, sanitizeNumericInput } from './loginInput';

describe('sanitizeNumericInput — hızlı-PIN / sayısal parola', () => {
  it('yalnız rakam bırakır ve cap uygular', () => {
    expect(sanitizeNumericInput('12a34', 6)).toBe('1234');
    expect(sanitizeNumericInput('_yNh6z91473t', 32)).toBe('691473'); // harfleri düşürür (SAYISAL alan bilerek)
    expect(sanitizeNumericInput('123456789', 6)).toBe('123456');
    expect(sanitizeNumericInput('', 6)).toBe('');
  });
});

describe('sanitizeAlphaInput — harfli (ABC) parola', () => {
  it('⭐ alfasayısal parolayı OLDUĞU GİBİ korur (rakam SÜZMEZ), yalnız cap uygular', () => {
    expect(sanitizeAlphaInput('_yNh6z91473t', 32)).toBe('_yNh6z91473t');
    expect(sanitizeAlphaInput('Aa1!.-_@', 32)).toBe('Aa1!.-_@');
    expect(sanitizeAlphaInput('0123456789', 32)).toBe('0123456789'); // salt rakam da bozulmaz
  });
  it('cap uzunluğu keser', () => {
    expect(sanitizeAlphaInput('abcdefghij', 4)).toBe('abcd');
  });
});
