import { create } from "zustand";

/**
 * Backend ulaşılabilirliği + sunucu-saati offset'i. Tek kaynak: apiClient
 * interceptor'ı her yanıtta günceller (piggyback — ekstra istek yok). İdeal
 * durumda hiç polling gerekmez; idle kalan client'lar için AppShell hafif bir
 * /health heartbeat'i atar (bkz. useServerHeartbeat).
 *
 * - offsetMs: sunucu_zamanı − client_zamanı (yanıtın `Date` header'ından). Gösterim
 *   `Date.now() + offsetMs` ile yerelde tik atar; client saati kaymış olsa bile
 *   sunucunun zamanını gösterir.
 * - status: connecting (ilk yanıt gelmedi) → online / offline.
 */
type ServerConnState = "connecting" | "online" | "offline";

interface ServerStatusState {
  status: ServerConnState;
  offsetMs: number;
  /** İlk başarılı senkron yapıldı mı (offset güvenilir mi). */
  synced: boolean;
  /** Son ulaşılabilir yanıt zamanı (client clock) — heartbeat idle kararı için. */
  lastReachableAt: number | null;
  /** Yanıt başarılı/ulaştı → online + offset güncelle (Date header verilirse). */
  markReachable: (dateHeader?: string) => void;
  /** Ağ hatası (yanıt yok) → offline. */
  markUnreachable: () => void;
}

/** Offset'i yalnız >1sn anlamlı sapmada güncelle → gereksiz re-render yok. */
const OFFSET_EPSILON_MS = 1000;

export const useServerStatusStore = create<ServerStatusState>((set, get) => ({
  status: "connecting",
  offsetMs: 0,
  synced: false,
  lastReachableAt: null,
  markReachable: (dateHeader) => {
    const cur = get();
    let offsetMs = cur.offsetMs;
    if (dateHeader) {
      const serverMs = Date.parse(dateHeader);
      if (!Number.isNaN(serverMs)) {
        const candidate = serverMs - Date.now();
        if (!cur.synced || Math.abs(candidate - cur.offsetMs) > OFFSET_EPSILON_MS) {
          offsetMs = candidate;
        }
      }
    }
    set({
      status: "online",
      offsetMs,
      synced: true,
      lastReachableAt: Date.now(),
    });
  },
  markUnreachable: () => {
    if (get().status !== "offline") set({ status: "offline" });
  },
}));
