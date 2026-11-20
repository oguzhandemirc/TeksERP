import { create } from "zustand";

/**
 * Destek özelliğinin oturum içi durumu.
 * `enabled` varsayılanı `false`: `/api/etkili-destek/durum` AÇIK demeden hiçbir destek yüzeyi çizilmez ve
 * başka destek isteği atılmaz (kapalı kurulum ve eski backend bugünkü paneli birebir görür).
 */
interface DestekState {
  enabled: boolean;
  /** Okunmamış ekip yanıtı olan talep sayısı (`tickets`). `null` = henüz bilinmiyor. */
  unreadMine: number | null;
  unreadTenant: number | null;
  /** Sunucunun `/durum.firmaYoneticisi` kararı (tek kaynak; istemci izin çıkarımı YAPMAZ). */
  tenantAdmin: boolean;
  /** Yönetici "Firmanın" kapsamı: 403 gelirse kalıcı kapanır (bu oturum boyunca). */
  tenantDenied: boolean;
  /** Talep formu: açılış anında alınan ekran görüntüsü (düz base64 PNG) ya da yok. */
  report: { open: boolean; screenshot: string | null; nonce: number };
  setEnabled: (v: boolean, tenantAdmin?: boolean) => void;
  setUnread: (scope: "mine" | "tenant", tickets: number) => void;
  denyTenant: () => void;
  openReport: (screenshot: string | null) => void;
  closeReport: () => void;
  reset: () => void;
}

const INITIAL = {
  enabled: false,
  unreadMine: null,
  unreadTenant: null,
  tenantAdmin: false,
  tenantDenied: false,
  report: { open: false, screenshot: null, nonce: 0 },
};

export const useDestekStore = create<DestekState>((set) => ({
  ...INITIAL,
  setEnabled: (enabled, tenantAdmin = false) => set({ enabled, tenantAdmin: enabled && tenantAdmin }),
  setUnread: (scope, tickets) => set(scope === "mine" ? { unreadMine: tickets } : { unreadTenant: tickets }),
  denyTenant: () => set({ tenantDenied: true, unreadTenant: null }),
  openReport: (screenshot) => set((s) => ({ report: { open: true, screenshot, nonce: s.report.nonce + 1 } })),
  closeReport: () => set((s) => ({ report: { ...s.report, open: false, screenshot: null } })),
  reset: () => set(INITIAL),
}));
