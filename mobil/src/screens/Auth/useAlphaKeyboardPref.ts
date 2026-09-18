// =============================================================================
// GİRİŞ — "harfli klavye" tercihi (cihaz bazlı, kullanıcı bazlı DEĞİL)
// =============================================================================
// Liste+şifre girişinde tabletin ekran-üstü SALT-RAKAM numpad'i alfanümerik parolayı
// yazamıyordu (K bulgusu 2026-09-18: `keyboardType="number-pad"`). Operatör bir "ABC"
// düğmesiyle sistem klavyesine geçer; seçim CİHAZDA hatırlanır (AsyncStorage) — sonraki
// açılışta aynı klavye gelir. Kullanıcı bazlı değil: aynı tablette çalışan herkes için tek
// tercih (fabrika kurulumu tek profil). Auth mantığına dokunmaz; yalnız GİRİŞ YÜZEYİ.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ALPHA_KEYBOARD_KEY = 'login.alphaKeyboard';

export function useAlphaKeyboardPref() {
  const [alphaKeyboard, setAlphaKeyboard] = useState(false);

  useEffect(() => {
    let iptal = false;
    AsyncStorage.getItem(ALPHA_KEYBOARD_KEY)
      .then((v) => {
        if (!iptal && v === '1') setAlphaKeyboard(true);
      })
      .catch(() => undefined);
    return () => {
      iptal = true;
    };
  }, []);

  const toggleAlphaKeyboard = useCallback(() => {
    setAlphaKeyboard((prev) => {
      const next = !prev;
      // Best-effort kalıcılık: yazım hatası girişi engellemesin.
      void AsyncStorage.setItem(ALPHA_KEYBOARD_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  return { alphaKeyboard, toggleAlphaKeyboard };
}
