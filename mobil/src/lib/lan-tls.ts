// Fabrika ağında TLS — tabletin saf kararları (docs/design/LAN-TLS.md §4c, §6).
// Tablet sunucuyu sertifika parmak iziyle tanır; sabit yalnız sabitli panelin gösterdiği QR'dan gelir
// (keşiften ya da ilk girişten SABİTLENMEZ). İKİZ: aşağıdaki işlevler `Electron/shared/lan-tls.ts`teki
// aynı adlı işlevlerle metin olarak aynıdır (bekçi: lan-tls.contract.test.ts) — mobil onu import edemez.
import { INTERNET_TLS_PORT, internetServerFor, kipFor, type InternetServer } from './internet-tls';

/** Sabitin güven kökü: panelin QR'ı ya da kullanıcının doğrulama kodunu göz ile karşılaştırması (§4b). */
export type TlsPinVia = 'qr' | 'kod';

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

export const HTTP_TO_PINNED_REASON = "Bu sunucuya şifreli bağlanılıyor; şifresiz adrese geçmek için önce 'Şifreli bağlantıyı kaldır'";

/**
 * Elle yazılan şifresiz adres sabitli sunucuya mı gidiyor: geçerli adres sabitli https ve host aynı, ya da
 * adresin bildirdiği kurulum kimliği bir sabitin kimliği. Öyleyse o sabit döner ve geçiş engellenir (HTTP'ye
 * sessiz düşüş yok); başka sunucu serbesttir — sabit sunucu başınadır.
 */
export function pinBlockingHttp(
  pins: readonly TlsPin[],
  current: { scheme: string; host: string; port: number },
  target: { scheme: string; host: string; installationId: string | null },
): TlsPin | null {
  if (target.scheme !== 'http' || pins.length === 0) return null;
  const host = target.host.trim().toLowerCase();
  if (current.scheme === 'https' && host !== '' && current.host.trim().toLowerCase() === host) {
    const here = pins.find((p) => p.port === current.port);
    if (here) return here;
  }
  if (!target.installationId) return null;
  return pinsForInstallation(pins, target.installationId)[0] ?? null;
}

export function withPin(pins: readonly TlsPin[], pin: TlsPin): TlsPin[] {
  return [...pins.filter((p) => p.installationId !== pin.installationId), pin];
}

// Tablet QR'ı — v1 `teks-erp-tls:1:<kimlik|->:<iz>:<port>`; v2 = v1 + `:<adres,adres…>` (biçim: Electron ikizi).
export const TLS_QR_PREFIX = 'teks-erp-tls:1:';
export const TLS_QR_V2_PREFIX = 'teks-erp-tls:2:';
export const TLS_QR_MAX_HOSTS = 6;
const QR_HOST = /^[0-9a-z]([0-9a-z.-]{0,251}[0-9a-z])?$/;

export interface TlsQr {
  installationId: string | null;
  advert: TlsAdvert;
  /** Sunucunun https adresleri (v2); boş = ağda izle aranır. Güven adreste değil izdedir. */
  hosts: string[];
}

export function buildTlsQr(installationId: string | null, advert: TlsAdvert, hosts: readonly string[] = []): string {
  const head = `${installationId ?? '-'}:${advert.fingerprint}:${advert.port}`;
  const list = [...new Set(hosts.map((h) => h.trim().toLowerCase()))].filter((h) => QR_HOST.test(h)).slice(0, TLS_QR_MAX_HOSTS);
  return list.length > 0 ? `${TLS_QR_V2_PREFIX}${head}:${list.join(',')}` : `${TLS_QR_PREFIX}${head}`;
}

export function parseTlsQr(text: string): TlsQr | null {
  if (typeof text !== 'string') return null;
  const v2 = text.startsWith(TLS_QR_V2_PREFIX);
  if (!v2 && !text.startsWith(TLS_QR_PREFIX)) return null;
  const parts = text.slice((v2 ? TLS_QR_V2_PREFIX : TLS_QR_PREFIX).length).split(':');
  if (v2 ? parts.length < 4 : parts.length !== 3) return null;
  const [iid, fp, port] = parts as [string, string, string];
  const advert = parseTlsAdvert({ fingerprint: fp, port: /^\d{1,5}$/.test(port) ? Number(port) : NaN });
  if (!advert || fp !== advert.fingerprint) return null;
  if (iid !== '-' && !/^[0-9a-f-]{36}$/i.test(iid)) return null;
  const hosts = v2 ? (parts[3] ?? '').split(',') : [];
  if (hosts.length > TLS_QR_MAX_HOSTS || !hosts.every((h) => QR_HOST.test(h))) return null;
  return { installationId: iid === '-' ? null : iid, advert, hosts };
}

// ---- İKİZ BİTİŞ ----

/** Sabit deposunun anahtarı (expo-secure-store); adres deposu da açılışta okur. */
export const TLS_PINS_KEY = 'api_server_tls_pins';

/** Sunucunun şifreli dinleyicisinin varsayılan portu (`Teks-Erp/src/lib/lan-tls/config.ts` LAN_TLS_DEFAULT_PORT). */
export const LAN_TLS_DEFAULT_PORT = 4443;

export const INSECURE_ADDRESS_REASON =
  'Bu tablet sunucuya yalnız şifreli (HTTPS) bağlanır; "http://" ile başlayan adres kullanılamaz. ' +
  'Sunucuyu QR ile ya da IP adresi ve doğrulama koduyla ekleyin.';

export type PairAddress = { ok: true; host: string; port: number } | { ok: false; reason: string };

/** Sabitli kip internet kipindeki adı sabitlemez (kip adresten türer; düşüş yok). */
export const INTERNET_HOST_NOT_PINNABLE =
  'Bu ad internet sertifikasıyla doğrulanır, doğrulama koduyla ya da QR ile sabitlenmez. “Adres yaz” ile ekleyin.';

/**
 * Elle yazılan sunucu adresi: IP/ad, isteğe bağlı port (yoksa kipin varsayılanı: sabitli 4443, internet 443).
 * `https://` öneki ve `/api` yolu kabul edilir; `http://` açıkça reddedilir — tablet şifresiz bağlanmaz.
 */
export function parsePairAddress(input: string, defaultPort?: number): PairAddress {
  let v = (input ?? '').trim();
  if (/^http:\/\//i.test(v)) return { ok: false, reason: INSECURE_ADDRESS_REASON };
  v = v.replace(/^https:\/\//i, '').replace(/\/+$/, '').replace(/\/api$/i, '').replace(/\/+$/, '');
  if (!v) return { ok: false, reason: 'Sunucunun IP adresini yazın (ör. 192.168.1.10).' };
  if (/[/\s]/.test(v) || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    return { ok: false, reason: 'Adres anlaşılamadı — yalnız IP adresi ya da sunucu adı yazın (ör. 192.168.1.10).' };
  }
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return { ok: false, reason: 'Adres anlaşılamadı — yalnız IP adresi ya da sunucu adı yazın (ör. 192.168.1.10).' };
  const host = (m[1] ?? '').toLowerCase();
  if (!/^[0-9a-z]([0-9a-z.-]{0,251}[0-9a-z])?$/.test(host)) {
    return { ok: false, reason: 'Adres anlaşılamadı — yalnız IP adresi ya da sunucu adı yazın (ör. 192.168.1.10).' };
  }
  const port = m[2] ? Number(m[2]) : (defaultPort ?? (kipFor(host) === 'internet' ? INTERNET_TLS_PORT : LAN_TLS_DEFAULT_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'Port 1–65535 arasında olmalı.' };
  return { ok: true, host, port };
}

/** Şifreli yoklamanın sonucu (native: gözlenen iz + doğrulanmamış kimlik). */
export interface ObservedServer {
  host: string;
  port: number;
  fingerprint: string;
  installationId: string | null;
}

export type PairDecision = { ok: true; pin: TlsPin; baseUrl: string } | { ok: false; reason: string };

/**
 * Kullanıcı doğrulama kodunu sunucunun gösterdiğiyle karşılaştırıp onayladı mı: onay yoksa sabit YOK.
 * Kod = `formatFingerprintGroups(iz)` (kurulum sonu, durum sayfası ve panel aynı biçimi basar).
 */
export function decideCodePin(input: { observed: ObservedServer; confirmed: boolean; now: string }): PairDecision {
  if (kipFor(input.observed.host) === 'internet') return { ok: false, reason: INTERNET_HOST_NOT_PINNABLE };
  const fp = normalizeFingerprint(input.observed.fingerprint);
  if (!fp) return { ok: false, reason: 'Sunucunun sertifika kodu okunamadı.' };
  if (!input.confirmed) {
    return { ok: false, reason: 'Kod onaylanmadı — bağlanılmadı. Kod farklıysa ağda araya giren biri olabilir; sistem yöneticisine haber verin.' };
  }
  const { host, port, installationId } = input.observed;
  return {
    ok: true,
    pin: { installationId, fingerprint: fp, port, via: 'kod', pinnedAt: input.now },
    baseUrl: httpsBaseUrlOf(host, port),
  };
}

/**
 * QR'daki iz/port/kurulum kimliği bu adreste gözlenen sunucuyla aynı mı. QR güven köküdür; adres yalnız
 * QR'ın izini taşıyan sunucuya bağlanır (kurulum kimliği sunucunun bildirdiğiyle de çapraz denetlenir).
 */
export function decideQrAddressPin(input: { qrText: string; observed: ObservedServer; now: string }): PairDecision {
  const qr = parseTlsQr(input.qrText);
  if (!qr) return { ok: false, reason: "Bu bir şifreli bağlantı QR'ı değil." };
  const o = input.observed;
  if (kipFor(o.host) === 'internet') return { ok: false, reason: INTERNET_HOST_NOT_PINNABLE };
  if (o.port !== qr.advert.port || normalizeFingerprint(o.fingerprint) !== qr.advert.fingerprint) {
    return { ok: false, reason: "Bu adresteki sunucunun kodu QR'dakiyle aynı değil. Ağda araya giren biri olabilir — sistem yöneticisine haber verin." };
  }
  if (o.installationId && qr.installationId && o.installationId !== qr.installationId) {
    return { ok: false, reason: 'QR bu sunucuya ait değil.' };
  }
  return {
    ok: true,
    pin: { installationId: qr.installationId ?? o.installationId, fingerprint: qr.advert.fingerprint, port: qr.advert.port, via: 'qr', pinnedAt: input.now },
    baseUrl: httpsBaseUrlOf(o.host, o.port),
  };
}

/**
 * QR'daki adresleri (v2) sırayla dener; ilk, QR'ın izini taşıyan sunucunun sabit kararını döner. İzi tutmayan
 * ya da cevap vermeyen adres atlanır (bağlanılmaz); hiçbiri tutmazsa null — çağıran ağ aramasına düşer.
 */
export async function pairViaQrHosts(input: {
  qrText: string;
  probe: (host: string, port: number) => Promise<ObservedServer | null>;
  now: () => string;
  stillWanted?: () => boolean;
}): Promise<PairDecision | null> {
  const qr = parseTlsQr(input.qrText);
  if (!qr) return null;
  for (const host of qr.hosts) {
    if (input.stillWanted && !input.stillWanted()) return null;
    if (kipFor(host) === 'internet') continue; // QR kip taşımaz: internet kipindeki ad sabitlenmez
    const observed = await input.probe(host, qr.advert.port);
    if (!observed) continue;
    const decision = decideQrAddressPin({ qrText: input.qrText, observed, now: input.now() });
    if (decision.ok) return decision;
  }
  return null;
}

/**
 * Yalnız şifreli kipte (sürüm paketi) kayıtlı adres kullanılabilir mi: https olmalı; sabitli kipte portu bir sabitin
 * portu (native sabitli uç ölçütü), internet kipinde ad + port bir internet kaydı. Kip adresten türer: internet
 * kipindeki ad sabitle, sabitli adres internet kaydıyla kullanılamaz. Değilse tablet "Sunucuyu ekle"ye döner.
 */
export function secureAddressUsable(url: string, pins: readonly TlsPin[], internet: readonly InternetServer[] = []): boolean {
  const m = /^https:\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? '').trim());
  if (!m) return false;
  if (kipFor(m[1] ?? '') === 'internet') return internetServerFor(url, internet) !== null;
  if (!m[2]) return false;
  return pins.some((p) => String(p.port) === m[2]);
}

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
        via: r.via === 'kod' ? 'kod' : 'qr',
        pinnedAt: typeof r.pinnedAt === 'string' ? r.pinnedAt : '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Native zorlama katmanına itilen küme: kabul edilen parmak izleri + şifreli bağlanılan sabitli uç. */
export interface NativePinState {
  fingerprints: string[];
  endpoints: string[];
}

/**
 * Sabitli uç = geçerli API adresi https ve portu bir sabitin portu (kart `activePin` ile aynı ölçüt).
 * Native o uca sabit dışı sertifikayı reddeder, o makineye şifresiz istek göndermez.
 */
export function nativePinState(
  pins: readonly TlsPin[],
  current: { scheme: 'http' | 'https'; host: string; port: string },
): NativePinState {
  const fingerprints = [...new Set(pins.map((p) => p.fingerprint))].sort();
  const host = current.host.trim().toLowerCase();
  const pinnedHere =
    current.scheme === 'https' && host !== '' && kipFor(host) === 'sabitli' && pins.some((p) => String(p.port) === current.port);
  return { fingerprints, endpoints: pinnedHere ? [`${host}:${current.port}`] : [] };
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
