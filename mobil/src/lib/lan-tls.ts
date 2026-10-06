// Fabrika ağında TLS — tabletin saf kararları (docs/design/LAN-TLS.md §4c, §6).
// Tablet sunucuyu sertifika parmak iziyle tanır; sabit yalnız sabitli panelin gösterdiği QR'dan gelir
// (keşiften ya da ilk girişten SABİTLENMEZ). İKİZ: aşağıdaki işlevler `Electron/shared/lan-tls.ts`teki
// aynı adlı işlevlerle metin olarak aynıdır (bekçi: lan-tls.contract.test.ts) — mobil onu import edemez.

export type TlsPinVia = 'qr';

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

// ---- İKİZ BAŞLANGIÇ (Electron/shared/lan-tls.ts) ----

const HEX64 = /^[0-9a-f]{64}$/;

export function normalizeFingerprint(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (raw.startsWith('sha256/')) {
    const b64 = raw.slice('sha256/'.length);
    if (!/^[A-Za-z0-9+/]{43}=$/.test(b64)) return null;
    const bin = atob(b64);
    if (bin.length !== 32) return null;
    return Array.from(bin, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  }
  const hex = raw.replace(/[\s:]/g, '').toLowerCase();
  return HEX64.test(hex) ? hex : null;
}

export function formatFingerprintGroups(hex: string): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
}

export function parseTlsAdvert(raw: unknown): TlsAdvert | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const fingerprint = normalizeFingerprint(r.fingerprint);
  const port = r.port;
  if (!fingerprint || typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { port, fingerprint };
}

export function httpsBaseUrlOf(host: string, port: number): string {
  return `https://${host}:${port}`;
}

export function pinsForInstallation(pins: readonly TlsPin[], installationId: string | null): TlsPin[] {
  return pins.filter((p) => p.installationId === installationId);
}

export type SecureRoute =
  | { kind: 'http' }
  | { kind: 'https'; port: number; pins: TlsPin[] }
  | { kind: 'blocked'; reason: string };

export function routeFor(pins: readonly TlsPin[], installationId: string | null, advert: TlsAdvert | null): SecureRoute {
  const mine = pinsForInstallation(pins, installationId);
  if (mine.length === 0) return { kind: 'http' };
  if (!advert) return { kind: 'blocked', reason: 'Şifreli bağlantı sabitli ama sunucu şifreli bağlantı sunmuyor' };
  if (!mine.some((p) => p.fingerprint === advert.fingerprint)) {
    return { kind: 'blocked', reason: 'Sunucunun sertifika parmak izi sabitlenenle aynı değil' };
  }
  return { kind: 'https', port: advert.port, pins: mine };
}

export function withPin(pins: readonly TlsPin[], pin: TlsPin): TlsPin[] {
  return [...pins.filter((p) => p.installationId !== pin.installationId), pin];
}

export const TLS_QR_PREFIX = 'teks-erp-tls:1:';

export function buildTlsQr(installationId: string | null, advert: TlsAdvert): string {
  return `${TLS_QR_PREFIX}${installationId ?? '-'}:${advert.fingerprint}:${advert.port}`;
}

export function parseTlsQr(text: string): { installationId: string | null; advert: TlsAdvert } | null {
  if (typeof text !== 'string' || !text.startsWith(TLS_QR_PREFIX)) return null;
  const parts = text.slice(TLS_QR_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [iid, fp, port] = parts as [string, string, string];
  const advert = parseTlsAdvert({ fingerprint: fp, port: /^\d{1,5}$/.test(port) ? Number(port) : NaN });
  if (!advert || fp !== advert.fingerprint) return null;
  if (iid !== '-' && !/^[0-9a-f-]{36}$/i.test(iid)) return null;
  return { installationId: iid === '-' ? null : iid, advert };
}

// ---- İKİZ BİTİŞ ----

export function parseTlsPins(raw: string | null | undefined): TlsPin[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: TlsPin[] = [];
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      const r = p as Record<string, unknown>;
      const fingerprint = normalizeFingerprint(r.fingerprint);
      if (!fingerprint || typeof r.port !== 'number') continue;
      out.push({
        installationId: typeof r.installationId === 'string' && r.installationId ? r.installationId : null,
        fingerprint,
        port: r.port,
        via: 'qr',
        pinnedAt: typeof r.pinnedAt === 'string' ? r.pinnedAt : '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type QrPinDecision =
  | { ok: true; pin: TlsPin; baseUrl: string }
  | { ok: false; reason: string };

/**
 * Okutulan QR bu tablete sabitlenir mi. QR güven köküdür; bağlı sunucunun HTTP'den verdiği kimlik ve
 * ilan yalnız ÇAPRAZ DENETİMDİR: kurulum kimliği QR'dakinden farklıysa QR başka sunucunun; ilan farklıysa
 * araya giren olabilir — ikisinde de sabitlenmez. Native doğrulama katmanı yoksa sabit HİÇ yazılmaz
 * (yazılsaydı ya bağlantı kesilirdi ya da sahte bir güvenlik hissi doğardı).
 */
export function decideQrPin(input: {
  qrText: string;
  nativeAvailable: boolean;
  host: string | null;
  serverInstallationId: string | null;
  serverAdvert: TlsAdvert | null;
  now: string;
}): QrPinDecision {
  const qr = parseTlsQr(input.qrText);
  if (!qr) return { ok: false, reason: 'Bu bir şifreli bağlantı QR\'ı değil.' };
  if (!input.nativeAvailable) {
    return { ok: false, reason: 'Bu tablet sürümü şifreli bağlantıyı henüz desteklemiyor — tablet uygulamasını güncelleyin.' };
  }
  if (!input.host) return { ok: false, reason: 'Önce sunucuya bağlanın, sonra QR\'ı okutun.' };
  if (qr.installationId !== input.serverInstallationId) {
    return { ok: false, reason: 'QR bağlı olduğunuz sunucuya ait değil.' };
  }
  if (!input.serverAdvert) return { ok: false, reason: 'Sunucu şifreli bağlantı sunmuyor (sunucuda LAN_TLS_MODE kapalı).' };
  if (input.serverAdvert.fingerprint !== qr.advert.fingerprint || input.serverAdvert.port !== qr.advert.port) {
    return {
      ok: false,
      reason: 'Sunucunun bildirdiği kod QR\'dakiyle aynı değil. Ağda araya giren biri olabilir — sistem yöneticisine haber verin.',
    };
  }
  return {
    ok: true,
    pin: { installationId: qr.installationId, fingerprint: qr.advert.fingerprint, port: qr.advert.port, via: 'qr', pinnedAt: input.now },
    baseUrl: httpsBaseUrlOf(input.host, qr.advert.port),
  };
}

/** Sabit kaldırılınca dönülecek HTTP adresi: aynı sunucunun son http adresi, yoksa varsayılan port. */
export function httpFallbackUrl(host: string, recent: readonly string[], defaultPort: number): string {
  const prior = recent.find((u) => {
    const m = /^http:\/\/([^:/\s]+)/i.exec(u.trim());
    return m?.[1] === host;
  });
  return (prior ?? `http://${host}:${defaultPort}`).replace(/\/api\/?$/, '');
}

export interface TlsRouted {
  baseUrl: string;
  host: string;
  port: number;
  identity: { installationId: string | null } | null;
  tls?: TlsAdvert | null;
}

/**
 * Keşif adaylarını sabitlere göre kanala dağıtır. Sabit yoksa aday DEĞİŞMEZ (bugünkü davranış); sabitli
 * kurulumun adayı https adresine yükseltilir ya da ENGELLENİR — HTTP'ye sessiz düşüş yok.
 */
export function applyTlsRoute<T extends TlsRouted>(list: readonly T[], pins: readonly TlsPin[]): { list: T[]; blocked: string | null } {
  if (pins.length === 0) return { list: [...list], blocked: null };
  const out: T[] = [];
  let blocked: string | null = null;
  for (const c of list) {
    const route = routeFor(pins, c.identity?.installationId ?? null, c.tls ?? null);
    if (route.kind === 'http') out.push(c);
    else if (route.kind === 'https') out.push({ ...c, port: route.port, baseUrl: httpsBaseUrlOf(c.host, route.port) });
    else blocked = `${c.host}: ${route.reason}`;
  }
  return { list: out, blocked };
}
