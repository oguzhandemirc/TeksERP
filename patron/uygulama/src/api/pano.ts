// Pano kutuları (ERP kipi, `/auth/me` `patronPano` ≥ 1): fabrikanın panelde kullandığı açılış panosu kutuları —
// katalog `GET /patron/v1/pano/kutular`, veri `GET /patron/v1/pano?kutular=&donem=`. Hesap fabrikada; uygulama
// yalnız seçer ve çizer. Bulutta bu uç yok: her yöntem AĞA GİTMEDEN 404 (pano yerel anlık kutularıyla çizilir).
import { kipteYok } from "./baglanti";
import type { ApiClient } from "./client";

export const ERP_PANO_ENDPOINTS = {
  katalog: ["get", "/patron/v1/pano/kutular"],
  veri: ["get", "/patron/v1/pano"],
} as const;

export const PANO_DONEMLERI = ["bugun", "hafta", "ay", "yil"] as const;
export type PanoDonem = (typeof PANO_DONEMLERI)[number];

export type PanoKutuBoyutu = "kpi" | "kucuk" | "orta" | "genis";

/** Katalog satırı (fabrika `PanoKutuTanimi`); sıra = varsayılan yerleşim. */
export interface PanoKutuTanimi {
  readonly anahtar: string;
  readonly baslik: string;
  readonly aciklama: string;
  readonly grup: string;
  readonly donemli: boolean;
  readonly varsayilan: boolean;
  readonly boyut: PanoKutuBoyutu;
}

export interface PanoKutuYaniti {
  readonly donem: PanoDonem;
  readonly olusturuldu: string;
  /** Bilinen ama izinsiz/kapalı kutu `null`. */
  readonly kutular: Readonly<Record<string, unknown>>;
}

export interface Panocu {
  katalog(): Promise<{ kutular: readonly PanoKutuTanimi[] }>;
  veri(anahtarlar: readonly string[], donem: PanoDonem): Promise<PanoKutuYaniti>;
}

export function createErpPanocu(c: ApiClient): Panocu {
  return {
    katalog: () => c.get<{ kutular: readonly PanoKutuTanimi[] }>(ERP_PANO_ENDPOINTS.katalog[1]),
    veri: (anahtarlar, donem) => c.get<PanoKutuYaniti>(ERP_PANO_ENDPOINTS.veri[1], { kutular: anahtarlar.join(","), donem }),
  };
}

export function createBulutPanocu(): Panocu {
  const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));
  return { katalog: yok, veri: yok };
}
