import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ApiBridge } from "@shared/ipc-contract";
import { useAuthStore } from "@/store/auth";
import { useIdleTimeoutMinutes } from "./usePricingEnabled";

/** Sistem-geneli modda boşta süresi bu sıklıkla okunur (ms). */
const POLL_MS = 5_000;
/** Oturum kapanmadan bu kadar sn önce uyarı göster (girdi süreyi uzatır). */
const WARNING_BEFORE_SEC = 60;
const WARNING_TOAST_ID = "idle-logout-warning";
/** Fallback (pencere-içi) modda sayaç sıfırlayan aktivite event'leri. */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

/**
 * Hareketsizlik (idle) zaman aşımı — `auth.idleTimeoutMinutes` > 0 iken, bu
 * bilgisayar bu kadar dakika hiç girdi görmezse panel oturumunu kapatır. 0 = kapalı.
 *
 * İKİ MOD:
 *  1) SİSTEM-GENELİ (tercih edilen): Electron `powerMonitor.getSystemIdleTime()`
 *     (main süreç) periyodik okunur → yalnız Electron değil, TÜM makinenin son
 *     girdisi sayılır (başka programla çalışırken düşmez). `window.api.power`
 *     gerektirir; bu main/preload IPC'sidir → değişince TAM DEV RESTART şart
 *     (renderer reload main'i yeniden derlemez).
 *  2) FALLBACK (window.api.power yoksa — ör. main/preload build'i eski): pencere-içi
 *     DOM aktivite dinleyicileri. Yalnız Electron penceresi hareketini sayar ama en
 *     azından ÇALIŞIR → özellik hiç sessizce ölmez. Dev restart sonrası (1)'e döner.
 *
 * AppShell'de bir kez mount edilir. Backend token'ı yine mutlak ömrüne kadar
 * geçerli — bu hook salt client-side erken çıkış kapısıdır.
 */
export function useIdleLogout(): void {
  const idleMinutes = useIdleTimeoutMinutes();
  const warningShownRef = useRef(false);

  useEffect(() => {
    if (idleMinutes <= 0) return; // kapalı
    const timeoutMs = idleMinutes * 60_000;
    const warnBeforeMs = WARNING_BEFORE_SEC * 1_000;
    // Çok kısa timeout'larda uyarıyı yarıya çek (uyarı penceresinden küçükse).
    const warnAtMs = Math.max(timeoutMs - warnBeforeMs, Math.floor(timeoutMs / 2));
    let stopped = false;

    const clearWarning = () => {
      if (warningShownRef.current) {
        warningShownRef.current = false;
        toast.dismiss(WARNING_TOAST_ID);
      }
    };

    const doLogout = () => {
      stopped = true;
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

    const showWarning = (remainingSec: number) => {
      warningShownRef.current = true;
      toast.warning("Oturum kapanmak üzere", {
        id: WARNING_TOAST_ID,
        description: `Bilgisayar bir süredir kullanılmıyor — ~${remainingSec} sn içinde çıkış yapılacak. Devam etmek için fare veya klavyeyi kullanın.`,
        duration: Number.POSITIVE_INFINITY,
      });
    };

    const power = (window as unknown as { api?: ApiBridge }).api?.power;

    // --- MOD 1: SİSTEM-GENELİ (powerMonitor poll) ---
    if (power) {
      const timeoutSec = idleMinutes * 60;
      const warnAtSec = Math.max(timeoutSec - WARNING_BEFORE_SEC, Math.floor(timeoutSec / 2));
      const poll = async () => {
        if (stopped) return;
        let idleSec: number;
        try {
          idleSec = await power.getSystemIdleTime();
        } catch {
          return; // IPC hatası → bu turu atla (yanlışlıkla çıkış yapma)
        }
        if (stopped) return;
        if (idleSec >= timeoutSec) doLogout();
        else if (idleSec >= warnAtSec) showWarning(Math.max(1, Math.ceil(timeoutSec - idleSec)));
        else clearWarning();
      };
      void poll();
      const iv = setInterval(() => void poll(), POLL_MS);
      return () => {
        stopped = true;
        clearInterval(iv);
        clearWarning();
      };
    }

    // --- MOD 2: FALLBACK (pencere-içi aktivite) ---
    // window.api.power yok (main/preload henüz güncellenmemiş) → dev restart gerekli.
    // Bu arada sessizce ölmemesi için pencere-içi hareketsizlik ile çalışır.
    console.warn(
      "[useIdleLogout] window.api.power yok → pencere-içi hareketsizlik moduna düşüldü. " +
        "Sistem-geneli için tam dev restart (npm run dev) ile main/preload'ı yeniden derleyin.",
    );
    let timer: ReturnType<typeof setTimeout> | null = null;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      if (warnTimer) clearTimeout(warnTimer);
      timer = setTimeout(doLogout, timeoutMs);
      warnTimer = setTimeout(
        () => showWarning(Math.round((timeoutMs - warnAtMs) / 1000)),
        warnAtMs,
      );
    };
    const onActivity = () => {
      if (stopped) return;
      clearWarning();
      arm();
    };
    arm();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (warnTimer) clearTimeout(warnTimer);
      clearWarning();
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    };
  }, [idleMinutes]);
}
