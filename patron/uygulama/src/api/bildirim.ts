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
  // Push köprüsü P4 (`/auth/me` `patronPush` açıkken): telefon belirteci + tür başına PATRON_PUSH tercihi.
  cihazKaydet: ["post", "/bildirim/cihaz"],
  cihazBirak: ["delete", "/bildirim/cihaz"],
  katalog: ["get", "/bildirim/katalog"],
  tercihler: ["get", "/bildirim/tercihler"],
  tercihYaz: ["put", "/bildirim/tercihler"],
} as const;

/** Telefon bildirimi kanalı (fabrika `NotificationKanal`). */
export const PATRON_PUSH_KANAL = "PATRON_PUSH";

/** `GET /bildirim/tercihler` — yalnız okunan alanlar. `hucreler` görünen türler; `satirlar` kişinin kendi sapma satırları. */
export interface TercihHucresi {
  readonly kind: string;
  readonly kanallar: readonly { readonly kanal: string; readonly durum: "ACIK" | "KAPALI" | "GIZLI"; readonly kilit: boolean }[];
}
export interface TercihSatiri {
  readonly tur: string;
  readonly kanal: string;
  readonly acik: boolean;
  readonly kapsam?: unknown;
}
export interface Tercihler {
  readonly hucreler: readonly TercihHucresi[];
  readonly satirlar: readonly TercihSatiri[];
}
export interface KatalogTuru {
  readonly kod: string;
  readonly ad: string;
}

/** Telefon push cihazı + tercih (ERP). Yalnız `yetenek().patronPush` açıkken çağrılır. */
export interface PushCihazci {
  kaydet(b: { belirtec: string; platform: "android" | "ios"; cihazAdi?: string }): Promise<unknown>;
  birak(belirtec: string): Promise<unknown>;
  katalog(): Promise<{ turler: readonly KatalogTuru[] }>;
  tercihler(): Promise<Tercihler>;
  tercihYaz(tercihler: readonly TercihSatiri[]): Promise<Tercihler>;
}

export function createErpPushCihazci(c: ApiClient): PushCihazci {
  const E = ERP_BILDIRIM_ENDPOINTS;
  return {
    kaydet: (b) => c.post(E.cihazKaydet[1], b),
    birak: (belirtec) => c.del(E.cihazBirak[1], { belirtec }),
    katalog: () => c.get(E.katalog[1]),
    tercihler: () => c.get(E.tercihler[1]),
    tercihYaz: (tercihler) => c.put(E.tercihYaz[1], { tercihler }),
  };
}

/**
 * `PUT /bildirim/tercihler` TAM gövdedir (görünen türlerin bütün kendi satırları silinip yeniden yazılır). Yalnız
 * (tür, PATRON_PUSH) hücresi değişsin diye: görünen türün kendi kanallarındaki MEVCUT satırlar (kapsam dahil) aynen
 * geri yollanır, yalnız o hücrenin satırı eklenir/değişir. Görünmeyen türün satırı yollanmaz (sunucu onu silmez).
 */
export function pushTercihGovdesi(t: Tercihler, tur: string, acik: boolean): TercihSatiri[] {
  const kanallar = new Map(t.hucreler.map((h) => [h.kind, new Set(h.kanallar.map((k) => k.kanal))]));
  const out: TercihSatiri[] = t.satirlar
    .filter((r) => kanallar.get(r.tur)?.has(r.kanal) && !(r.tur === tur && r.kanal === PATRON_PUSH_KANAL))
    .map((r) => (r.kapsam === undefined || r.kapsam === null ? { tur: r.tur, kanal: r.kanal, acik: r.acik } : { tur: r.tur, kanal: r.kanal, acik: r.acik, kapsam: r.kapsam }));
  out.push({ tur, kanal: PATRON_PUSH_KANAL, acik });
  return out;
}

/** Tür → telefon bildirimi hücresi (yalnız kanalı taşıyan ve gizli olmayan türler). */
export function pushHucreleri(t: Tercihler): { tur: string; acik: boolean }[] {
  return t.hucreler.flatMap((h) => {
    const k = h.kanallar.find((x) => x.kanal === PATRON_PUSH_KANAL);
    return k && k.durum !== "GIZLI" ? [{ tur: h.kind, acik: k.durum === "ACIK" }] : [];
  });
}

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
