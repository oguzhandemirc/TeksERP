import type { JwtPayload } from "@/types/auth";

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "="));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Token'ın son kullanma anını **ms cinsinden epoch** olarak döndürür (JWT `exp`
 * saniye → ms). `exp` yoksa/token çözülemezse `null` (= süre bilinmiyor).
 * Saf fonksiyon — otomatik-logout zamanlaması ve açılış geçerlilik kontrolü ortak
 * kaynağı.
 */
export function jwtExpiryMs(token: string): number | null {
  const decoded = decodeJwt(token);
  return jwtPayloadExpiryMs(decoded);
}

/** Çözülmüş payload'tan son kullanma (ms epoch) — `exp` sayı değilse `null`. */
export function jwtPayloadExpiryMs(payload: { exp?: number } | null | undefined): number | null {
  if (payload && typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
    return payload.exp * 1000;
  }
  return null;
}
