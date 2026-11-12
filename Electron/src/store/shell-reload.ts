import { create } from "zustand";

/** Yenileme gösteriminden sonra gerçek yeniden yükleme (simge dönüşü + solma görünsün). */
export const RELOAD_DELAY_MS = 250;
/** Yükleme iptal edilirse (beforeunload) düğme sonsuza dek pasif kalmasın. */
const RELOAD_GIVE_UP_MS = 4000;

interface ShellReloadState {
  busy: boolean;
  /** Meşgulken ikinci çağrı yok sayılır. Davranış: tam sayfa yeniden yükleme. */
  reload: () => void;
}

export const useShellReload = create<ShellReloadState>((set, get) => ({
  busy: false,
  reload: () => {
    if (get().busy) return;
    set({ busy: true });
    setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    setTimeout(() => set({ busy: false }), RELOAD_GIVE_UP_MS);
  },
}));
