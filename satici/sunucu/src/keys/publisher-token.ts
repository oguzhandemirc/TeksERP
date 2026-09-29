// YAYINCI İNDİRME belirteçleri — yayın betiklerinin kenar (CF Worker) doğrulaması için. Kurulum kiraya
// eşlik eden belirteçle AYNI biçimdedir (kanal + ürün öneki + ≤ 70 dk); kurulum kimliği yerine sabit
// yayıncı kimliği taşır. Özel anahtar yalnız satıcının İNDİRME anahtarıdır (hazırlık ya da VDS).
import { ChannelCodeSchema, DOWNLOAD_MAX_TTL_MS, msToIso, signDownloadToken } from "../lisans-protokol";
import type { KeyStore } from "./key-store";

/** Kurulum değil yayıncı: belirteç kimin için basıldı (Worker kurulumu sorgulamaz). */
export const PUBLISHER_INSTALLATION_ID = "00000000-0000-4000-8000-000000000000";
export const PUBLISHER_PRODUCTS = ["electron", "mobil"] as const;
export const PUBLISHER_DEFAULT_MINUTES = 60;
export const PUBLISHER_MAX_MINUTES = DOWNLOAD_MAX_TTL_MS / 60_000;

export interface PublisherToken {
  readonly kanal: string;
  readonly yolOneki: string;
  readonly belirtec: string;
  readonly exp: string;
}

export class PublisherTokenError extends Error {}

/** Kanal listesi × {electron, mobil}; kanal biçimsiz, ömür 1–70 dk dışı ya da İNDİRME anahtarı yoksa RED. */
export function publisherTokens(keys: KeyStore, g: { channels: readonly string[]; minutes: number; nowMs: number }): PublisherToken[] {
  if (g.channels.length === 0) throw new PublisherTokenError("En az bir kanal verilmeli (--kanal=a,b)");
  for (const c of g.channels) {
    if (!ChannelCodeSchema.safeParse(c).success) throw new PublisherTokenError(`Kanal kodu biçimsiz: ${c}`);
  }
  if (!Number.isInteger(g.minutes) || g.minutes < 1 || g.minutes > PUBLISHER_MAX_MINUTES) {
    throw new PublisherTokenError(`Ömür 1–${PUBLISHER_MAX_MINUTES} dakika olmalı`);
  }
  const key = keys.downloadKey(g.nowMs);
  if (!key) throw new PublisherTokenError("Geçerli İNDİRME anahtarı yok (anahtar dizini ya da sertifika)");
  const exp = msToIso(g.nowMs + g.minutes * 60_000);
  return [...new Set(g.channels)].flatMap((kanal) =>
    PUBLISHER_PRODUCTS.map((urun) => {
      const yolOneki = `/${kanal}/${urun}/`;
      const belirtec = signDownloadToken({
        payload: { v: 1, kanal, yolOneki, kurulumId: PUBLISHER_INSTALLATION_ID, exp },
        key: { kid: key.kid, privateKey: key.privateKey },
        nowMs: g.nowMs,
      });
      return { kanal, yolOneki, belirtec, exp };
    }),
  );
}
