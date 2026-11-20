// Okunmamış rozet yoklaması — saf adım (hook ve test aynı kodu koşar).
// ⚠️ Hata YUTULUR: merkez erişilemez (502/504), hız sınırı (429), ağ kopukluğu → rozet eski değerinde kalır,
// toast basılmaz, panel işleyişi etkilenmez (sözleşme §4 son satır).
import { readDestekError } from "./errors";
import type { TicketScope, UnreadCount } from "./types";

export interface UnreadDeps {
  fetchUnread: (scope: TicketScope) => Promise<UnreadCount>;
  /** Kullanıcı "Firmanın" kapsamını isteyebilir mi (sunucunun `/durum.firmaYoneticisi` kararı) ve daha önce 403 alınmadı mı. */
  canTenant: boolean;
  setUnread: (scope: TicketScope, tickets: number) => void;
  denyTenant: () => void;
}

export async function pollUnreadOnce(d: UnreadDeps): Promise<void> {
  try {
    const mine = await d.fetchUnread("mine");
    d.setUnread("mine", mine.tickets);
  } catch {
    return;
  }
  if (!d.canTenant) return;
  try {
    const tenant = await d.fetchUnread("tenant");
    d.setUnread("tenant", tenant.tickets);
  } catch (e) {
    if (readDestekError(e).status === 403) d.denyTenant();
  }
}

/** Rozet metni: 0 → yok; 9 üstü "9+". */
export function badgeText(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return n > 9 ? "9+" : String(n);
}
