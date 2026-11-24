import { create } from "zustand";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { tokenStore } from "@/lib/secure-token";

/** Yenileme gösteriminden sonra gerçek yeniden yükleme (simge dönüşü + solma görünsün). */
export const RELOAD_DELAY_MS = 250;
/** Yükleme iptal edilirse (beforeunload) düğme sonsuza dek pasif kalmasın. */
const RELOAD_GIVE_UP_MS = 4000;

// B18/14: tarayıcıda çerezsiz oturumda (panel kipi kapalı backend: geliştirme/önizleme Vite sunucusu) token YALNIZ
// bellekte yaşar (K2 — tarayıcıya token yazılmaz); tam sayfa yenileme onu siler ve girişe atar. O kipte düğme
// sayfayı değil verileri yeniler. Electron (token şifreli diskte) ve çerezli web panelinde tam yenileme oturumu korur.
let softRefresh: (() => Promise<unknown>) | null = null;

/** Uygulama kökü veri yenileyicisini bağlar (TanStack Query: etkin sorguları yeniden çek). */
export function registerSoftRefresh(fn: () => Promise<unknown>): void {
  softRefresh = fn;
}

/** Tam sayfa yenileme oturumu düşürür mü? (tarayıcı + bellekteki token) */
export function reloadDropsSession(): boolean {
  return !IS_ELECTRON && tokenStore.peek() !== null;
}

/** Düğme/komut ipucu — düğmenin O KİPTE ne yaptığını söyler. */
export function reloadTitle(): string {
  return reloadDropsSession()
    ? "Verileri yeniden yükle — bu tarayıcıda oturum saklanmadığından sayfa yenilenmez (F5 oturumu kapatır)"
    : "Sayfayı yeniden yükle (Ctrl+Shift+R) — oturum açık kalır";
}

interface ShellReloadState {
  busy: boolean;
  /** Meşgulken ikinci çağrı yok sayılır. Davranış: tam sayfa yeniden yükleme; oturumu düşürecekse veri yenileme. */
  reload: () => void;
}

export const useShellReload = create<ShellReloadState>((set, get) => ({
  busy: false,
  reload: () => {
    if (get().busy) return;
    set({ busy: true });
    if (reloadDropsSession() && softRefresh) {
      const fn = softRefresh;
      setTimeout(() => void fn().finally(() => set({ busy: false })), RELOAD_DELAY_MS);
      return;
    }
    setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    setTimeout(() => set({ busy: false }), RELOAD_GIVE_UP_MS);
  },
}));
