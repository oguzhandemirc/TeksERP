// =============================================================================
// useAutoLogout — token süresi dolunca otomatik çıkış (ayar açıksa)
// =============================================================================
// JWT `exp` decode edilir (imza doğrulanmaz — saf karar). Ayar açıkken exp
// anında bir timer + AppState 'active' kontrolüyle logout tetiklenir. Süresi
// DOLMUŞ token flush EDİLEMEZ (backend 401 döner) → 401 yolu gibi sadece yerel
// temizlik (reset + clearAuth), flush YOK.
// =============================================================================

import { useEffect } from 'react';
import { AppState } from 'react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { useLockStore } from '../store/lockStore';
import { useAutoLogoutOnExpiry } from './useFeatureFlags';
import { decodeJwtExpMs, shouldAutoLogout } from '../utils/jwtExpiry';

let inFlight = false;
async function runExpiryLogout(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    // Kilit açıksa kaldır (login ekranına dönülecek), oturum state'ini sıfırla,
    // token'ı sil. Süresi dolmuş token → sunucuya flush ATMA (dead token).
    useLockStore.getState().unlock();
    useSessionStore.getState().reset();
    await useAuthStore.getState().clearAuth();
    Toast.show({
      type: 'info',
      text1: 'Oturum süresi doldu',
      text2: 'Güvenlik için çıkış yapıldı — lütfen tekrar giriş yapın.',
      visibilityTime: 6000,
    });
  } finally {
    inFlight = false;
  }
}

export function useAutoLogout(): void {
  const token = useAuthStore((s) => s.token);
  const enabled = useAutoLogoutOnExpiry();

  useEffect(() => {
    if (!enabled || !token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      if (shouldAutoLogout(token, Date.now(), true)) void runExpiryLogout();
    };

    const expMs = decodeJwtExpMs(token);
    if (expMs != null) {
      // exp'e kadar bekle (+500ms sunucu-saat toleransı). JWT süreleri saatler
      // mertebesinde → setTimeout sınırının (24.8 gün) çok altında.
      const delay = Math.max(0, expMs - Date.now()) + 500;
      timer = setTimeout(check, delay);
    }
    // Uygulama arka plandayken timer askıya alınabilir → öne gelince tekrar bak.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    // Mount anında zaten dolmuş olabilir (persisted eski token).
    check();

    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [token, enabled]);
}
