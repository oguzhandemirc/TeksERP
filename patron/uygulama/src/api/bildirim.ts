// Gelen bildirim katmanı (ERP kipi): fabrikanın kişisel gelen kutusu (`/api/bildirim/*`, verifyToken; satır kapsamı
// sunucuda `userId` + görme süzgeci). Ekran kip bilmez; `yetenek().bildirimKutusu` açıksa `Bildirimci` ile çalışır.
// Bulutun bildirim akışı (`/bildirim/ayarlar`, `/bildirimler` geçmişi) `Api` üzerinde AYNEN kalır; bulut `Bildirimci`si ağa gitmez.
import { kipteYok } from "./baglanti";
import type { ApiClient } from "./client";

export const ERP_BILDIRIM_ENDPOINTS = {
  ozet: ["get", "/bildirim/ozet"],
  liste: ["get", "/bildirim"],
  okundu: ["post", "/bildirim/:id/okundu"],
  tumunuOkundu: ["post", "/bildirim/tumunu-okundu"],
} as const;

/** `GET /bildirim/ozet`; bayrak kapalıyken yalnız `{enabled:false}`. */
export interface BildirimOzeti {
  readonly enabled: boolean;
  readonly okunmamis?: number;
  readonly epoch?: number;
  readonly rev?: number;
}

/** Liste satırı — yalnız uygulamanın okuduğu alanlar (metin sunucuda render edilmiş). */
export interface GelenBildirim {
  readonly id: string;
  readonly tur: string;
  readonly sinif: string;
  readonly baslik: string;
  readonly govde: string;
  readonly sayac: number;
  readonly sonAn: string;
  readonly okunduAn: string | null;
  readonly cozulduAn: string | null;
}

export interface BildirimSayfasi {
  readonly items: readonly GelenBildirim[];
  readonly nextCursor: string | null;
  readonly sayi: number;
}

export type BildirimSekmesi = "okunmamis" | "tumu";

export interface Bildirimci {
  ozet(): Promise<BildirimOzeti>;
  liste(p: { sekme: BildirimSekmesi; cursor?: string; limit?: number }): Promise<BildirimSayfasi>;
  okundu(id: string): Promise<{ degisti: boolean }>;
  tumunuOkundu(): Promise<{ ids: string[] }>;
}

export function createErpBildirimci(c: ApiClient): Bildirimci {
  return {
    ozet: () => c.get<BildirimOzeti>(ERP_BILDIRIM_ENDPOINTS.ozet[1]),
    liste: (p) => c.get<BildirimSayfasi>(ERP_BILDIRIM_ENDPOINTS.liste[1], { sekme: p.sekme, cursor: p.cursor, limit: p.limit }),
    okundu: (id) => c.post<{ degisti: boolean }>(`/bildirim/${encodeURIComponent(id)}/okundu`, {}),
    tumunuOkundu: () => c.post<{ ids: string[] }>(ERP_BILDIRIM_ENDPOINTS.tumunuOkundu[1], {}),
  };
}

/** Bulut: bu akış yok; her yöntem AĞA GİTMEDEN 404. */
export function createBulutBildirimci(): Bildirimci {
  const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));
  return { ozet: yok, liste: yok, okundu: yok, tumunuOkundu: yok };
}

/**
 * Fabrikada gelen kutusu açık mı (panelin kuralı: `/ozet` 404 ya da `enabled !== true` → yok). Ağ/sunucu hatası
 * da KAPALI sayılır (fail-closed); eski fabrika hata görmez, yalnız özellik gizlenir.
 */
export async function erpBildirimAcik(oku: () => Promise<BildirimOzeti>): Promise<boolean> {
  try {
    return (await oku()).enabled === true;
  } catch {
    return false;
  }
}
