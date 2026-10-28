// Okuma sidecar'ının adresi — TEK çözüm yeri; `GELEN_BELGE_OKUMA_URL` başka yerde okunmaz (`cloud-sync/cloud-url.ts` kalıbı).
// Boş = KAPALI (sidecar yok: durum ucu "servis yok", okutma 503 OCR_SERVICE_UNAVAILABLE; taslak elle/Excel sürer).
// Kabul: HTTPS · döngü adresi düz HTTP (Windows `http://127.0.0.1:8765`) · Linux compose için NOKTASIZ servis adı
// (`http://okuma:8765`) — egress boğazındaki beyanlı tek istisna, yalnız BU dosya kaydeder (`allowPlainHttpServiceHost`).
import { allowPlainHttpServiceHost, isEgressTargetAllowed } from "../http-egress";

export type ReaderUrlSource = "kapali" | "ortam" | "gecersiz";

export interface ReaderUrl {
  readonly url: string | null;
  readonly source: ReaderUrlSource;
}

/** Yalnız köken; kullanıcı adı/parola/yol/sorgu taşıyan adres geçersizdir. */
export function resolveReaderUrl(raw: string | undefined): ReaderUrl {
  const v = raw?.trim();
  if (!v) return { url: null, source: "kapali" };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { url: null, source: "gecersiz" };
  }
  const originOnly = !u.username && !u.password && !u.search && !u.hash && (u.pathname === "/" || u.pathname === "");
  if (!originOnly) return { url: null, source: "gecersiz" };
  // Compose servis adı: noktasız, IP değil — `allowPlainHttpServiceHost` uymayanı reddeder (1.2.3.4 / okuma.local geçmez).
  if (u.protocol === "http:" && !isEgressTargetAllowed(u) && !/^[\d.]+$|:/.test(u.hostname)) allowPlainHttpServiceHost(u.hostname);
  if (!isEgressTargetAllowed(u)) return { url: null, source: "gecersiz" };
  return { url: u.origin, source: "ortam" };
}

let current = resolveReaderUrl(process.env.GELEN_BELGE_OKUMA_URL);

export function getReaderUrl(): ReaderUrl {
  return current;
}

/** Test-only: sahte sidecar adresi (null → kapalı). */
export function setReaderUrlForTests(url: string | null): void {
  current = url === null ? { url: null, source: "kapali" } : resolveReaderUrl(url);
}
