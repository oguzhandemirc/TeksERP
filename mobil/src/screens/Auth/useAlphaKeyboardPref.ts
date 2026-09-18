// =============================================================================
// GİRİŞ — "harfli klavye" seçimi (yalnız o giriş denemesi için; KALICI DEĞİL)
// =============================================================================
// Liste+şifre girişinde tabletin ekran-üstü SALT-RAKAM numpad'i alfanümerik parolayı yazamıyordu
// (K bulgusu 2026-09-18). Operatör bir "ABC" düğmesiyle sistem klavyesine geçer. Seçim CİHAZDA
// HATIRLANMAZ (1e kararı 2026-09-18): giriş ekranı PAYLAŞIMLI vardiya yüzeyidir ("adına dokun") →
// her giriş denemesi sayısal tuş takımıyla başlar; sonraki operatör önceki tercihi miras almaz.
// Ekran yeniden kurulunca (çıkış→giriş) sayısala döner. Auth mantığına dokunmaz; yalnız GİRİŞ YÜZEYİ.
// =============================================================================
import { useCallback, useState } from 'react';

export function useAlphaKeyboardPref() {
  const [alphaKeyboard, setAlphaKeyboard] = useState(false);
  const toggleAlphaKeyboard = useCallback(() => setAlphaKeyboard((prev) => !prev), []);
  return { alphaKeyboard, toggleAlphaKeyboard };
}
