// =============================================================================
// useIdleLock — hareketsizlik izleme + geri sayım uyarısı + kilitleme
// =============================================================================
// Kök seviyede BİR KEZ mount edilir (IdleLockGate). Saf reducer (idleLock.ts)
// kararı verir; bu hook yalnız zamanlayıcı + AppState + lockStore köprüsüdür.
//   - `mobileIdleLockEnabled` kapalı VEYA kullanıcı yoksa → idle ile kilitlenmez.
//   - idle süresi (feature-flags dk) dolmadan `IDLE_WARNING_MS` önce geri sayım.
//   - Arka plana geçince (AppState !== 'active') ANINDA kilitlenir — AYRI bayrak
//     `mobileLockOnBackground` (default açık); kapalıysa arka plana geçince kilit YOK.
// Aktivite zaman damgası App.tsx kök responder-capture'ından `recordActivity()`
// ile güncellenir (bu hook yalnız okur).
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../store/authStore';
import {
  consumeSuppressedBackground,
  getLastActivity,
  isSystemDialogPending,
  noteSuppressedBackground,
  recordActivity,
  useLockStore,
} from '../store/lockStore';
import {
  useMobileIdleLockEnabled,
  useMobileIdleLockMinutes,
  useMobileLockOnBackground,
} from './useFeatureFlags';
import {
  computeIdlePhase,
  idleMinutesToMs,
  warningSeconds,
  IDLE_WARNING_MS,
  SUPPRESSED_BACKGROUND_GRACE_MS,
} from '../utils/idleLock';

export interface IdleLockUi {
  /** Geri sayım uyarısı gösterilmeli mi ("Devam et"). */
  warning: boolean;
  /** Kilide kalan tam saniye (uyarı sırasında). */
  secondsLeft: number;
  /** "Devam et" → aktiviteyi tazele, uyarıyı kapat. */
  dismissWarning: () => void;
}

export function useIdleLock(): IdleLockUi {
  const enabled = useMobileIdleLockEnabled();
  const minutes = useMobileIdleLockMinutes();
  const lockOnBackground = useMobileLockOnBackground();
  const user = useAuthStore((s) => s.user);
  const locked = useLockStore((s) => s.locked);
  const lock = useLockStore((s) => s.lock);

  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const activeGuard = enabled && !!user; // idle timeout (hareketsizlik)
  const bgGuard = lockOnBackground && !!user; // arka plana geçince anında kilit (bağımsız)
  const idleMs = idleMinutesToMs(minutes);

  // Etkin olunca aktiviteyi tazele → yükleme/ayar değişiminde anında kilitlenme.
  useEffect(() => {
    if (activeGuard) recordActivity();
  }, [activeGuard]);

  // Periyodik idle kontrolü (kilitli değilken).
  useEffect(() => {
    if (!activeGuard || locked) {
      setWarning(false);
      return;
    }
    const tick = () => {
      const st = computeIdlePhase(getLastActivity(), Date.now(), idleMs, IDLE_WARNING_MS);
      if (st.phase === 'locked') {
        setWarning(false);
        lock();
      } else if (st.phase === 'warning') {
        setWarning(true);
        setSecondsLeft(warningSeconds(st.msUntilLock));
      } else {
        setWarning(false);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [activeGuard, locked, idleMs, lock]);

  // Arka plana geçince anında kilitle (mobileLockOnBackground açık + kullanıcı varken).
  // Idle kilitten BAĞIMSIZ: idle kapalı olsa da bu açıksa arka planda kilitlenir;
  // bu kapalıysa idle açık olsa da arka planda kilitlenmez (yalnız süre dolunca).
  // MUAFİYET: uygulamanın kendi açtığı sistem diyaloğu (BT izin/aç/PIN,
  // yazdırma, kamera izni — withSystemDialog ile sarılı) da activity'yi pause
  // edip 'background' yayar; bu blip'te KİLİTLEME (operatör uygulamadan
  // ayrılmadı). Ama anı damgala: diyalog açıkken home'a basılır ya da operatör
  // çekip giderse EK 'background' event'i gelmez (activity zaten paused) —
  // dönüşteki 'active'te bastırılmış arka plan süresi grace'i aşmışsa kilitle
  // (dönen kişi başkası olabilir). recordActivity ÇAĞRILMAZ: diyalog süresi
  // idle sayılır — idle tick'i dönüşte ikinci emniyet ağıdır.
  useEffect(() => {
    if (!bgGuard) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        if (isSystemDialogPending()) noteSuppressedBackground();
        else lock();
      } else if (consumeSuppressedBackground() > SUPPRESSED_BACKGROUND_GRACE_MS) {
        lock();
      }
    });
    return () => sub.remove();
  }, [bgGuard, lock]);

  const dismissWarning = useCallback(() => {
    recordActivity();
    setWarning(false);
  }, []);

  return { warning: warning && activeGuard && !locked, secondsLeft, dismissWarning };
}
