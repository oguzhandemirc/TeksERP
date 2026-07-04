// =============================================================================
// IdleLockGate — kök seviye oturum bekçisi (idle kilit + geri sayım + auto-logout)
// =============================================================================
// App.tsx'te PaperProvider'DAN SONRA (Toast slotu) kendi PaperProvider'ı içinde
// mount edilir → kilit/uyarı, Paper Portal modallarının bile ÜSTÜnde çizilir.
// - useAutoLogout: token süresi dolunca çıkış (ayar açıksa).
// - useIdleLock:   hareketsizlikte uyarı → kilit (ayar açıksa).
// Kullanıcı yoksa hiçbir overlay yok (login ekranı zaten görünür).
// =============================================================================

import React, { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useLockStore } from '../../store/lockStore';
import { useAutoLogout } from '../../hooks/useAutoLogout';
import { useIdleLock } from '../../hooks/useIdleLock';
import IdleWarning from './IdleWarning';
import LockScreen from './LockScreen';

export default function IdleLockGate() {
  // Hook'lar KOŞULSUZ çağrılır (kural) — içleri user/ayar yoksa no-op.
  useAutoLogout();
  const { warning, secondsLeft, dismissWarning } = useIdleLock();
  const locked = useLockStore((s) => s.locked);
  const user = useAuthStore((s) => s.user);

  // Kullanıcı yoksa (logout / 401) kilit kalıntısı kalmasın — sonraki girişte
  // taze başla (aksi halde yeni oturumun üstünde eski kilit ekranı çizilir).
  useEffect(() => {
    if (!user) useLockStore.getState().unlock();
  }, [user]);

  if (!user) return null;

  return (
    <>
      {warning && !locked && <IdleWarning seconds={secondsLeft} onContinue={dismissWarning} />}
      {locked && <LockScreen />}
    </>
  );
}
