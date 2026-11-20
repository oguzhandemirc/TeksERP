// =============================================================================
// Destek görünürlüğü ve rozet — HATA SESSİZ YUTULUR
// =============================================================================
// Kural (sözleşme §4, §6): `/durum` `etkin:false` döner ya da uç YOKTUR (eski
// backend → 404) → hiçbir destek girişi/rozeti görünmez, başka destek isteği
// atılmaz. Herhangi bir hata da "kapalı" sayılır (fail-closed: saha bugünkü
// gibi çalışır). Rozet yoklamasının hatası (502/504/429/ağ) YUTULUR: rozet eski
// değerinde kalır, toast basılmaz, saha işleyişi etkilenmez.
// =============================================================================

import type { DestekVisibility, DestekOkunmamis } from '../../services/destek.service';

/** Uygulama ön plandayken rozet yoklama aralığı. */
export const ROZET_YOKLAMA_MS = 120_000;
/** "Taleplerim" açıkken liste yenileme aralığı (sözleşme önerisi). */
export const LIST_REFRESH_MS = 30_000;

export const DESTEK_OFF: DestekVisibility = { etkin: false, firmaYoneticisi: false };

/**
 * `/durum` yanıtını güvenli özete çevirir. "Firmanın" sekmesi YALNIZ sunucunun
 * `firmaYoneticisi` kararından açılır (tek kaynak, sözleşme §5.1); kapalı/hata → ikisi de false.
 */
export async function safeStatus(
  getir: () => Promise<Partial<DestekVisibility>>,
): Promise<DestekVisibility> {
  try {
    const d = await getir();
    const etkin = d?.etkin === true;
    return { etkin, firmaYoneticisi: etkin && d?.firmaYoneticisi === true };
  } catch {
    return DESTEK_OFF;
  }
}

export const SIFIR_OKUNMAMIS: DestekOkunmamis = { count: 0, tickets: 0 };

export async function okunmamisGuvenli(
  getir: () => Promise<DestekOkunmamis>,
  onceki: DestekOkunmamis | undefined,
): Promise<DestekOkunmamis> {
  try {
    return await getir();
  } catch {
    return onceki ?? SIFIR_OKUNMAMIS;
  }
}

/** Rozette talep sayısı (`tickets`) gösterilir; 0 → rozet yok. */
export function rozetMetni(o: DestekOkunmamis | undefined): string | null {
  const n = o?.tickets ?? 0;
  if (n <= 0) return null;
  return n > 9 ? '9+' : String(n);
}

/** Sayfa-numaralı liste (`page`/`limit`/`total`) → sonraki sayfa ya da undefined. */
export function nextPage(s: { page: number; limit: number; total: number; items: unknown[] }): number | undefined {
  if (s.items.length === 0) return undefined;
  return s.page * s.limit < s.total ? s.page + 1 : undefined;
}

/** 403 (yetkisiz `scope=tenant`) → "Firmanın" sekmesi gizlenir. */
export function yetkisizMi(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 403;
}
