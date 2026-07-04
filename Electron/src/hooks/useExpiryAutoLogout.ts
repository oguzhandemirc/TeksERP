import { useEffect } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";
import { jwtPayloadExpiryMs } from "@/lib/jwt";
import { autoLogoutDelayMs } from "@/lib/session-auth";
import { useAutoLogoutOnExpiry } from "./usePricingEnabled";

/**
 * Token süresi dolunca otomatik çıkış — `auth.autoLogoutOnExpiry` ayarı açıkken
 * (default), JWT `exp` anına bir zamanlayıcı kurar; süre dolduğunda oturumu
 * kapatır ve login'e döner. Ayrı `useIdleLogout` (hareketsizlik) korunur; bu
 * hook mutlak token ömrüne göre çalışır — hiç işlem olmasa bile.
 *
 * Backend token'ı zaten kendi ömrüne kadar geçerli; bu hook proaktif bir istemci
 * kapısıdır (aksi halde çıkış ancak bir sonraki isteğin 401'inde fark edilirdi).
 * setTimeout 32-bit sınırını aşan uzun token'larda (>~24.8 gün) kendini yeniden
 * zamanlar — `autoLogoutDelayMs` gecikmeyi kırpar, callback tekrar arm eder.
 *
 * AppShell'de bir kez mount edilir (yalnız giriş yapılmışken render edilir).
 */
export function useExpiryAutoLogout(): void {
  const enabled = useAutoLogoutOnExpiry();
  const expMs = useAuthStore((s) => jwtPayloadExpiryMs(s.user));

  useEffect(() => {
    if (!enabled || expMs === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      const delay = autoLogoutDelayMs(expMs, Date.now());
      if (delay === null) return;
      if (delay <= 0) {
        void useAuthStore
          .getState()
          .logout()
          .then(() => {
            toast.error("Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
            window.location.hash = "#/login";
          });
        return;
      }
      // Uzak tarihli token'da gecikme MAX_TIMER_MS'e kırpılır; callback yeniden arm eder.
      timer = setTimeout(arm, delay);
    };

    arm();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, expMs]);
}
