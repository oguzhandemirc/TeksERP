/**
 * Fabrika ağında TLS — panelin saf kararları (docs/design/LAN-TLS.md §4, §6).
 *
 * Sunucu kendinden imzalı sertifika sunar; panel onu adresle değil sertifika DER'inin SHA-256
 * parmak iziyle tanır. Parmak izi keşiften ya da ilk girişten SABİTLENMEZ (TOFU): yalnız
 * döngü adresinden, kullanıcı gözle karşılaştırıp onaylayınca ya da tablet QR'ıyla.
 * İKİZ: parmak izi/ilan/kanal/QR işlevleri `mobil/src/lib/lan-tls.ts`te metin olarak aynıdır (bekçi: mobil `lan-tls.test.ts`).
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
  /** Sunucunun keşif yükünde İLAN ettiği parmak izi; ilansız sertifika (vekil/bulut kenarı) sabitlenmez. */
  advertised: unknown;
  /** Adres internet kipinde mi (`isInternetHost`) — o ad genel CA ile doğrulanır, sabitlenmez. */
  internet: boolean;
  via: unknown;
}): PinRequestCheck {
  if (req.internet) return { ok: false, reason: INTERNET_HOST_NOT_PINNABLE_REASON };
  const requested = normalizeFingerprint(req.requested);
  if (!requested) return { ok: false, reason: "Parmak izi biçimi geçersiz" };
  if (!req.observed) return { ok: false, reason: "Sunucuya şifreli bağlanılamadı" };
  if (requested !== req.observed) return { ok: false, reason: "Sunucunun sunduğu sertifika onaylanan kodla aynı değil" };
  if (normalizeFingerprint(req.advertised) !== req.observed) return { ok: false, reason: UNADVERTISED_CERT_REASON };
  if (req.via === "loopback") {
    return isLoopbackHost(req.host) ? { ok: true } : { ok: false, reason: "Otomatik sabitleme yalnız sunucu bilgisayarının kendisinde" };
  }
  if (req.via === "confirmed") return { ok: true };
  return { ok: false, reason: "Sabitleme yolu tanınmıyor" };
}

export const INTERNET_HOST_NOT_PINNABLE_REASON =
  "Bu ad internet sertifikasıyla doğrulanır, doğrulama koduyla sabitlenmez — Sunucu Adresi penceresinde “Bulut”u seçin.";

export const UNADVERTISED_CERT_REASON =
  "Sunucu bu sertifikayı doğrulama kodu olarak ilan etmiyor (araya bir vekil ya da bulut kenarı girmiş olabilir) — sabitlenmedi.";

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
  if (target.scheme !== "http" || pins.length === 0) return null;
  const host = target.host.trim().toLowerCase();
  if (current.scheme === "https" && host !== "" && current.host.trim().toLowerCase() === host) {
    const here = pins.find((p) => p.port === current.port);
    if (here) return here;
  }
  if (!target.installationId) return null;
  return pinsForInstallation(pins, target.installationId)[0] ?? null;
}

/** Yeni sabiti listeye ekler; aynı kurulumun eski sabitleri yerini yeniye bırakır. */
export function withPin(pins: readonly TlsPin[], pin: TlsPin): TlsPin[] {
  return [...pins.filter((p) => p.installationId !== pin.installationId), pin];
}

// ---------------------------------------------------------------------------
// Tablet QR'ı — v1 `teks-erp-tls:1:<installationId|->:<parmak-izi>:<port>`;
// v2 = v1 + `:<adres,adres…>` (https, QR'daki port; sonraki alanlar yok sayılır).
// v1 okuyucusu (vc60) fazla alanı reddeder — panel eski tablete v1'i ayrıca gösterir.
// ---------------------------------------------------------------------------

export const TLS_QR_PREFIX = "teks-erp-tls:1:";
export const TLS_QR_V2_PREFIX = "teks-erp-tls:2:";
export const TLS_QR_MAX_HOSTS = 6;
const QR_HOST = /^[0-9a-z]([0-9a-z.-]{0,251}[0-9a-z])?$/;

export interface TlsQr {
  installationId: string | null;
  advert: TlsAdvert;
  /** Sunucunun https adresleri (v2); boş = ağda izle aranır. Güven adreste değil izdedir. */
  hosts: string[];
}

export function buildTlsQr(installationId: string | null, advert: TlsAdvert, hosts: readonly string[] = []): string {
  const head = `${installationId ?? "-"}:${advert.fingerprint}:${advert.port}`;
  const list = [...new Set(hosts.map((h) => h.trim().toLowerCase()))].filter((h) => QR_HOST.test(h)).slice(0, TLS_QR_MAX_HOSTS);
  return list.length > 0 ? `${TLS_QR_V2_PREFIX}${head}:${list.join(",")}` : `${TLS_QR_PREFIX}${head}`;
}

export function parseTlsQr(text: string): TlsQr | null {
  if (typeof text !== "string") return null;
  const v2 = text.startsWith(TLS_QR_V2_PREFIX);
  if (!v2 && !text.startsWith(TLS_QR_PREFIX)) return null;
  const parts = text.slice((v2 ? TLS_QR_V2_PREFIX : TLS_QR_PREFIX).length).split(":");
  if (v2 ? parts.length < 4 : parts.length !== 3) return null;
  const [iid, fp, port] = parts as [string, string, string];
  const advert = parseTlsAdvert({ fingerprint: fp, port: /^\d{1,5}$/.test(port) ? Number(port) : NaN });
  if (!advert || fp !== advert.fingerprint) return null;
  if (iid !== "-" && !/^[0-9a-f-]{36}$/i.test(iid)) return null;
  const hosts = v2 ? (parts[3] ?? "").split(",") : [];
  if (hosts.length > TLS_QR_MAX_HOSTS || !hosts.every((h) => QR_HOST.test(h))) return null;
  return { installationId: iid === "-" ? null : iid, advert, hosts };
}

// ---------------------------------------------------------------------------
// Panel yalnız şifreli (kullanıcı kararı 2026-10-08): ağdaki sunucuya http:// yok. Şifresiz yalnız döngü
// adresi (paket makineden çıkmaz); https ya sabitli (kendinden imzalı, kod karşılaştırılmış) ya da izinli üst
// alanda genel CA'lı (sistem güveni + ad eşleşmesi Chromium'da). Panel-yalnız; tablet ikizi değildir.
// ---------------------------------------------------------------------------

export const LAN_TLS_DEFAULT_PORT = 4443;

export const HTTP_NETWORK_REFUSED_REASON =
  "Sunucuya yalnız şifreli bağlanılır — ağdaki sunucuya http:// ile bağlanılmaz. 'Doğrulama kodunu göster' ile sunucunun kodunu karşılaştırın; kodlar aynıysa şifreli bağlanılır.";

export const UNPAIRED_HTTPS_REASON =
  "Bu sunucu bu bilgisayarla henüz eşleşmedi — 'Doğrulama kodunu göster' ile sunucunun kodunu karşılaştırın.";

export type PanelTransport =
  | { kind: "loopback" }
  | { kind: "pinned"; pin: TlsPin }
  | { kind: "internet" }
  | { kind: "refused"; reason: string };

/** https'in standart portu — internet kipinde port yazılmaz. */
export const INTERNET_TLS_PORT = 443;

/**
 * Ana sürecin yoklama/sabitleme hedefi. Port yazılmamışsa https → 443 (`panelTransportFor` ile aynı), http →
 * API'nin varsayılan portu (`httpDefaultPort`, döngüdeki şifresiz kimlik ucu). Adres kimlik yanıtının
 * `protocol`/`apiPort` beyanıyla YENİDEN KURULMAZ: kullanıcının yazdığı şema ve port esastır.
 */
export function serverUrlParts(url: string, httpDefaultPort: number): { scheme: "http" | "https"; host: string; port: number } | null {
  const m = /^(https?):\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? "").trim());
  if (!m || !m[1] || !m[2]) return null;
  const scheme = m[1].toLowerCase() === "https" ? "https" : "http";
  return { scheme, host: m[2], port: m[3] ? Number(m[3]) : scheme === "https" ? INTERNET_TLS_PORT : httpDefaultPort };
}

function urlParts(url: string): { scheme: string; host: string; port: number | null } | null {
  try {
    const u = new URL((url ?? "").trim());
    const scheme = u.protocol.replace(/:$/, "").toLowerCase();
    return { scheme, host: u.hostname.toLowerCase(), port: u.port ? Number(u.port) : null };
  } catch {
    return null;
  }
}

/**
 * Panelin kaydedip bağlanabileceği adres mi. Döngü adresi her kanalda serbest; ağ adresinde http:// red;
 * https yalnız bu porttaki sabitle ya da izinli üst alanda (genel CA). Sabitsiz https kendinden imzalıysa
 * Chromium zaten reddeder — burada da red, kullanıcı eşleştirmeye yönlenir.
 */
export function panelTransportFor(
  pins: readonly TlsPin[],
  url: string,
  isInternetHost: (host: string) => boolean,
): PanelTransport {
  const p = urlParts(url);
  if (!p || (p.scheme !== "http" && p.scheme !== "https") || !p.host) return { kind: "refused", reason: "Adres geçersiz." };
  if (isLoopbackHost(p.host)) return { kind: "loopback" };
  if (p.scheme === "http") return { kind: "refused", reason: HTTP_NETWORK_REFUSED_REASON };
  const port = p.port ?? INTERNET_TLS_PORT;
  const pin = pins.find((x) => x.port === port);
  if (pin) return { kind: "pinned", pin };
  if (isInternetHost(p.host)) return { kind: "internet" };
  return { kind: "refused", reason: UNPAIRED_HTTPS_REASON };
}

/**
 * Ağ katmanı kapısı (oturumun her isteği): şifresiz şema (http/ws) yalnız döngü adresine. Arayüz kapısı
 * atlansa da ağdaki sunucuya düz metin gitmez. Diğer şemalar (https, file, data, devtools…) bu kapının dışında.
 */
export function plainRequestAllowed(url: string): boolean {
  const p = urlParts(url);
  if (!p) return !/^\s*(http|ws):/i.test(url ?? "");
  if (p.scheme !== "http" && p.scheme !== "ws") return true;
  return isLoopbackHost(p.host);
}
