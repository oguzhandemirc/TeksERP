import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { useIdleTimeoutMinutes } from "./usePricingEnabled";

/** İzlenen kullanıcı aktivitesi event'leri — herhangi biri sayacı sıfırlar. */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

/** Aktivite event'leri çok sık tetiklenir — sayacı en fazla bu aralıkla yenile. */
const RESET_THROTTLE_MS = 1_000;

/**
 * Hareketsizlik (idle) zaman aşımı — `auth.idleTimeoutMinutes` ayarı >0 iken, panel
 * bu kadar dakika hiçbir kullanıcı işlemi (fare/klavye/scroll) görmezse oturumu
 * otomatik kapatır ve login'e döner. 0 (default) iken devre dışı.
 *
 * AppShell'de bir kez mount edilir (yalnız giriş yapılmışken render edilir). Backend
 * token'ı yine kendi mutlak ömrüne (auth.sessionDurationHours) kadar geçerli kalır;
 * bu hook salt client-side bir erken çıkış kapısıdır.
 */
export function useIdleLogout(): void {
  const idleMinutes = useIdleTimeoutMinutes();
  const lastResetRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (idleMinutes <= 0) return; // kapalı
    const timeoutMs = idleMinutes * 60_000;

    const doLogout = () => {
      void useAuthStore
        .getState()
        .logout()
        .then(() => {
          toast.error(
            "Hareketsizlik nedeniyle oturumunuz kapatıldı. Lütfen tekrar giriş yapın.",
          );
          window.location.hash = "#/login";
        });
    };

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(doLogout, timeoutMs);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastResetRef.current < RESET_THROTTLE_MS) return;
      lastResetRef.current = now;
      arm();
    };

    arm(); // ilk sayaç
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [idleMinutes]);
}
