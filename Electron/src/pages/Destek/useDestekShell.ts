// Kabuk düzeyi destek kancaları: özellik durumu, rozet yoklaması, "Sorun bildir" kısayolu.
// AppShell bunları `DestekRoot` üzerinden bir kez bağlar.
import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";
import { useDestekStore } from "./destek-store";
import { destekService } from "./service";
import { pollUnreadOnce } from "./unread";

export const POLL_INTERVAL_MS = 60_000;
/** Sekme değişimi yoklamayı tetikler ama bu aralıktan sık değil (hızlı gezinmede istek yağmuru olmasın). */
const MIN_GAP_MS = 10_000;

/** Oturum açılınca bir kez `durum` sorulur; kapalı / eski backend (404) / hata → kapalı kalır. */
export function useDestekStatus(): void {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const setEnabled = useDestekStore((s) => s.setEnabled);
  const reset = useDestekStore((s) => s.reset);
  useEffect(() => {
    reset();
    if (!userId) return;
    let alive = true;
    destekService
      .durum()
      .then((r) => alive && setEnabled(r.etkin, r.firmaYoneticisi))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, [userId, setEnabled, reset]);
}

export function useCanSeeTenant(): boolean {
  const tenantAdmin = useDestekStore((s) => s.tenantAdmin);
  const denied = useDestekStore((s) => s.tenantDenied);
  // Sözleşme §5.1: karar sunucunun (`/durum.firmaYoneticisi`); yine de 403 gelirse oturum boyunca gizlenir.
  return tenantAdmin && !denied;
}

/** Rozet yoklaması: açılışta, 60 sn'de bir, sekme/sayfa değişiminde; pencere arka plandayken DURUR. */
export function useUnreadPolling(): void {
  const enabled = useDestekStore((s) => s.enabled);
  const canTenant = useCanSeeTenant();
  const activePath = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const lastAt = useRef(0);

  const poll = useCallback(
    (force: boolean) => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (!force && now - lastAt.current < MIN_GAP_MS) return;
      lastAt.current = now;
      const st = useDestekStore.getState();
      void pollUnreadOnce({ fetchUnread: destekService.unread, canTenant, setUnread: st.setUnread, denyTenant: st.denyTenant });
    },
    [canTenant],
  );

  useEffect(() => {
    if (!enabled) return;
    poll(true);
    const timer = setInterval(() => poll(true), POLL_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && poll(false);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, poll]);

  useEffect(() => {
    if (enabled && activePath) poll(false);
  }, [enabled, activePath, poll]);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * "Sorun bildir": ÖNCE ekran görüntüsü, SONRA form. Menü kapanma animasyonu görüntüye girmesin diye kısa bir
 * bekleme yapılır. Web panelinde (köprü yok) ya da yakalama düşerse form görüntüsüz açılır.
 */
export async function startReport(waitMs = 180): Promise<void> {
  const st = useDestekStore.getState();
  if (!st.enabled || st.report.open) return;
  await nextFrame();
  await new Promise((r) => setTimeout(r, waitMs));
  let shot: string | null = null;
  try {
    shot = (await window.api?.screen?.capture())?.dataBase64 ?? null;
  } catch {
    shot = null;
  }
  useDestekStore.getState().openReport(shot);
}

/** Ctrl/⌘ + Shift + B → Sorun bildir (yazı yazarken de çalışır; harf eklemez). */
export function useReportShortcut(): void {
  const enabled = useDestekStore((s) => s.enabled);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== "KeyB") return;
      e.preventDefault();
      void startReport(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
