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

/** K-B2: oturum kapanmadan bu kadar önce uyarı göster (aktivite süreyi uzatır). */
const WARNING_BEFORE_MS = 60_000;
const WARNING_TOAST_ID = "idle-logout-warning";

/**
 * Hareketsizlik (idle) zaman aşımı — `auth.idleTimeoutMinutes` ayarı >0 iken, panel
 * bu kadar dakika hiçbir kullanıcı işlemi (fare/klavye/scroll) görmezse oturumu
 * otomatik kapatır ve login'e döner. 0 (default) iken devre dışı.
 *
 * K-B2 fix: eskiden uyarısız tetikleniyordu — açık formdaki veri sessizce
 * gidiyordu. Artık kapanmadan 60 sn önce kalıcı bir uyarı çıkar; HERHANGİ bir
 * aktivite (tıklama/klavye) süreyi uzatıp uyarıyı kapatır. Veri kaybı olacaksa
 * operatörün gözü önünde olur.
 *
 * AppShell'de bir kez mount edilir (yalnız giriş yapılmışken render edilir). Backend
 * token'ı yine kendi mutlak ömrüne (auth.sessionDurationHours) kadar geçerli kalır;
 * bu hook salt client-side bir erken çıkış kapısıdır.
 */
export function useIdleLogout(): void {
  const idleMinutes = useIdleTimeoutMinutes();
  const lastResetRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningShownRef = useRef(false);

  useEffect(() => {
    if (idleMinutes <= 0) return; // kapalı
    const timeoutMs = idleMinutes * 60_000;
    // Çok kısa timeout'larda (uyarı penceresinden küçük) uyarıyı yarıya çek.
    const warnAt = Math.max(timeoutMs - WARNING_BEFORE_MS, Math.floor(timeoutMs / 2));

    const clearWarning = () => {
      if (warningShownRef.current) {
        warningShownRef.current = false;
        toast.dismiss(WARNING_TOAST_ID);
      }
    };

    const doLogout = () => {
      clearWarning();
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

    const showWarning = () => {
      warningShownRef.current = true;
      const remainingSec = Math.round((timeoutMs - warnAt) / 1000);
      toast.warning("Oturum kapanmak üzere", {
        id: WARNING_TOAST_ID,
        description: `Hareketsizlik nedeniyle ~${remainingSec} sn içinde çıkış yapılacak — devam etmek için ekrana dokunun/tıklayın.`,
        duration: Number.POSITIVE_INFINITY,
      });
    };

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      timerRef.current = setTimeout(doLogout, timeoutMs);
      warnTimerRef.current = setTimeout(showWarning, warnAt);
    };

    const onActivity = () => {
      const now = Date.now();
      // Uyarı görünüyorken throttle BEKLEMEDEN uzat — operatör "dokun" çağrısına
      // uyduğu anda uyarı kapansın.
      if (!warningShownRef.current && now - lastResetRef.current < RESET_THROTTLE_MS) return;
      lastResetRef.current = now;
      clearWarning();
      arm();
    };

    arm(); // ilk sayaç
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
      clearWarning();
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [idleMinutes]);
}
