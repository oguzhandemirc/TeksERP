/**
 * Fabrika ağında TLS — panelin saf kararları (docs/design/LAN-TLS.md §4, §6).
 *
 * Sunucu kendinden imzalı sertifika sunar; panel onu adresle değil sertifika DER'inin SHA-256
 * parmak iziyle tanır. Parmak izi keşiften ya da ilk girişten SABİTLENMEZ (TOFU): yalnız
 * döngü adresinden, kullanıcı gözle karşılaştırıp onaylayınca ya da tablet QR'ıyla.
 */

export const TLS_PIN_KEY = "config.serverTlsPin";

export type TlsPinVia = "loopback" | "confirmed";

export interface TlsPin {
  installationId: string | null;
  fingerprint: string;
  port: number;
  via: TlsPinVia;
  pinnedAt: string;
}

/** Sunucunun keşif yükündeki ilan (`/api/discovery/identity` → `tls`). Güven kaynağı DEĞİL. */
export interface TlsAdvert {
  port: number;
  fingerprint: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Parmak izini tek biçime indirir: 64 hane küçük harf onaltılık. Kabul: onaltılık (iki nokta /
 * boşluk serbest, büyük-küçük harf) ya da Electron'un `sha256/<base64>` biçimi. Başka her şey null.
 */
export function normalizeFingerprint(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw.startsWith("sha256/")) {
    const b64 = raw.slice("sha256/".length);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(b64)) return null;
    const bin = atob(b64);
    if (bin.length !== 32) return null;
    return Array.from(bin, (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  }
  const hex = raw.replace(/[\s:]/g, "").toLowerCase();
  return HEX64.test(hex) ? hex : null;
}

/** Gözle karşılaştırma biçimi: 4'lük gruplar, büyük harf — sunucunun bastığı biçimle aynı. */
export function formatFingerprintGroups(hex: string): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(" ");
}

export function parseTlsAdvert(raw: unknown): TlsAdvert | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fingerprint = normalizeFingerprint(r.fingerprint);
  const port = r.port;
  if (!fingerprint || typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { port, fingerprint };
}

export function parseTlsPins(raw: string | null | undefined): TlsPin[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: TlsPin[] = [];
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      const fingerprint = normalizeFingerprint(r.fingerprint);
      if (!fingerprint || typeof r.port !== "number") continue;
      out.push({
        installationId: typeof r.installationId === "string" && r.installationId ? r.installationId : null,
        fingerprint,
        port: r.port,
        via: r.via === "loopback" ? "loopback" : "confirmed",
        pinnedAt: typeof r.pinnedAt === "string" ? r.pinnedAt : "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Chromium sertifika doğrulama kancasının kararı: sabitli parmak izi → 0 (kabul); başka her şey → -3
 * (Chromium'un kendi kararı — dış https adresleri normal CA ile doğrulanır, kendinden imzalı yabancı
 * sertifika reddedilir). Kanca adrese bakmaz: kimlik parmak izindedir.
 */
export function certVerifyDecision(pins: readonly TlsPin[], certFingerprint: unknown): 0 | -3 {
  const fp = normalizeFingerprint(certFingerprint);
  if (!fp) return -3;
  return pins.some((p) => p.fingerprint === fp) ? 0 : -3;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function httpsBaseUrlOf(host: string, port: number): string {
  return `https://${host}:${port}`;
}

/** Bu kuruluma ait sabit (kurulum kimliğiyle; kimliksiz sabit yalnız kimliksiz sunucuya). */
export function pinsForInstallation(pins: readonly TlsPin[], installationId: string | null): TlsPin[] {
  return pins.filter((p) => p.installationId === installationId);
}

export type SecureRoute =
  | { kind: "http" }
  | { kind: "https"; port: number; pins: TlsPin[] }
  | { kind: "blocked"; reason: string };

/**
 * Bulunan sunucuya hangi kanaldan gidilir. Sabit yoksa bugünkü gibi HTTP. Sabit varsa HTTPS ZORUNLU:
 * sunucu TLS ilan etmiyorsa ya da ilanın parmak izi sabitte yoksa ENGEL — HTTP'ye sessiz düşüş yok.
 * İlandaki parmak izi yalnız ön elemedir; asıl karşılaştırma TLS el sıkışmasında gözlenen sertifikayla.
 */
export function routeFor(pins: readonly TlsPin[], installationId: string | null, advert: TlsAdvert | null): SecureRoute {
  const mine = pinsForInstallation(pins, installationId);
  if (mine.length === 0) return { kind: "http" };
  if (!advert) return { kind: "blocked", reason: "Şifreli bağlantı sabitli ama sunucu şifreli bağlantı sunmuyor" };
  if (!mine.some((p) => p.fingerprint === advert.fingerprint)) {
    return { kind: "blocked", reason: "Sunucunun sertifika parmak izi sabitlenenle aynı değil" };
  }
  return { kind: "https", port: advert.port, pins: mine };
}

export type PinRequestCheck = { ok: true } | { ok: false; reason: string };

/**
 * Sabitleme isteği kabul edilir mi. `observed` = ana sürecin KENDİ el sıkışmasında gördüğü parmak izi;
 * renderer'ın gönderdiği değer ona eşit olmalı (kullanıcının onayladığı kod, gerçekten sunulan sertifika).
 * `loopback` yalnız döngü adresinde; diğer her adreste kullanıcının açık onayı (`confirmed`) şart.
 */
export function checkPinRequest(req: {
  host: string;
  requested: unknown;
  observed: string | null;
  via: unknown;
}): PinRequestCheck {
  const requested = normalizeFingerprint(req.requested);
  if (!requested) return { ok: false, reason: "Parmak izi biçimi geçersiz" };
  if (!req.observed) return { ok: false, reason: "Sunucuya şifreli bağlanılamadı" };
  if (requested !== req.observed) return { ok: false, reason: "Sunucunun sunduğu sertifika onaylanan kodla aynı değil" };
  if (req.via === "loopback") {
    return isLoopbackHost(req.host) ? { ok: true } : { ok: false, reason: "Otomatik sabitleme yalnız sunucu bilgisayarının kendisinde" };
  }
  if (req.via === "confirmed") return { ok: true };
  return { ok: false, reason: "Sabitleme yolu tanınmıyor" };
}

/** Yeni sabiti listeye ekler; aynı kurulumun eski sabitleri yerini yeniye bırakır. */
export function withPin(pins: readonly TlsPin[], pin: TlsPin): TlsPin[] {
  return [...pins.filter((p) => p.installationId !== pin.installationId), pin];
}

// ---------------------------------------------------------------------------
// Tablet QR'ı — `teks-erp-tls:1:<installationId|->:<parmak-izi>:<port>`
// ---------------------------------------------------------------------------

export const TLS_QR_PREFIX = "teks-erp-tls:1:";

export function buildTlsQr(installationId: string | null, advert: TlsAdvert): string {
  return `${TLS_QR_PREFIX}${installationId ?? "-"}:${advert.fingerprint}:${advert.port}`;
}

export function parseTlsQr(text: string): { installationId: string | null; advert: TlsAdvert } | null {
  if (typeof text !== "string" || !text.startsWith(TLS_QR_PREFIX)) return null;
  const parts = text.slice(TLS_QR_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [iid, fp, port] = parts as [string, string, string];
  const advert = parseTlsAdvert({ fingerprint: fp, port: /^\d{1,5}$/.test(port) ? Number(port) : NaN });
  if (!advert || fp !== advert.fingerprint) return null;
  if (iid !== "-" && !/^[0-9a-f-]{36}$/i.test(iid)) return null;
  return { installationId: iid === "-" ? null : iid, advert };
}
