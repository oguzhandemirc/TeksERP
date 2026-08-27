/**
 * Sunucu keşfi — SAF mantık (mobil).
 *
 * ⚠️ Bu dosya `Electron/shared/discovery.ts`in İKİZİDİR ama import EDEMEZ:
 * mobil bağımsız bir proje, monorepo paylaşımı yok (`types/permissions.ts` ile
 * aynı durum). İkisi elle senkron tutulur; sözleşmenin kilidi
 * `discovery.contract.test.ts` — kimlik ucunun YOLUNU backend kaynağından okur,
 * yani asıl ayrışma noktası mekanik olarak korunur.
 *
 * Saf tutulmasının sebebi test edilebilirlik: soket/fetch işleri
 * `services/discovery.service.ts`te.
 */

/** Kimlik ucunun yolu — taban adresin KÖKÜNE eklenir (`/api` ZATEN içinde). */
export const DISCOVERY_IDENTITY_PATH = "/api/discovery/identity";

/** Backend'in varsayılan portu. */
export const DISCOVERY_DEFAULT_PORT = 4000;

/** Tek turda taranacak en fazla adres — fabrika ağını boğmamak için. */
export const SCAN_MAX_HOSTS = 512;

/** Bu eşikten geniş ağlarda TAM tarama yapılmaz, kendi /24 dilimine daraltılır. */
export const SCAN_MIN_PREFIX = 22;

export interface ServerIdentity {
  product: string;
  discoveryVersion: number;
  /** null = eski backend ya da boot'ta DB hazır değildi. UYUŞMAZLIK DEĞİLDİR. */
  installationId: string | null;
  serverName: string;
  companyName: string;
  version: string;
}

export type IdentityMatch = 'match' | 'mismatch' | 'unknown';

export interface DiscoveredServer {
  /** `http://host:port` — `/api` EKLİ DEĞİL (normalizeUrl ekler). */
  baseUrl: string;
  host: string;
  port: number;
  identity: ServerIdentity | null;
  rttMs: number;
  matchesPinned: IdentityMatch;
}

// ---------------------------------------------------------------------------
// Kimlik
// ---------------------------------------------------------------------------

export function parseIdentityPayload(raw: unknown): ServerIdentity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  // 4000 portunda BAŞKA bir servis de olabilir — ürün damgası tutmuyorsa aday değil.
  if (r.product !== 'TeksERP') return null;
  const iid = r.installationId;
  return {
    product: 'TeksERP',
    discoveryVersion: typeof r.discoveryVersion === 'number' ? r.discoveryVersion : 0,
    // Boş string kimlik DEĞİLDİR — null'a indirilir ki "yok" tek biçimde temsil edilsin.
    installationId: typeof iid === 'string' && iid.trim() ? iid.trim() : null,
    serverName: typeof r.serverName === 'string' ? r.serverName : '',
    companyName: typeof r.companyName === 'string' ? r.companyName : '',
    version: typeof r.version === 'string' ? r.version : '',
  };
}

/**
 * ⚠️ `unknown` ASLA `match` gibi davranmaz ve ASLA uyarı doğurmaz. Üç meşru
 * sebebi var (henüz sabitlenmemiş cihaz · kimlik ucu olmayan eski backend ·
 * boot'ta DB'si hazır olmayan sunucu). Bunları "farklı sunucu" diye suçlamak
 * uyarıyı yanlış-pozitife çevirir; operatör onu ezberden geçer ve koruma
 * gerçek uyuşmazlıkta da işe yaramaz.
 */
export function compareIdentity(
  pinned: string | null | undefined,
  found: string | null | undefined,
): IdentityMatch {
  const p = (pinned ?? '').trim().toLowerCase();
  const f = (found ?? '').trim().toLowerCase();
  if (!p || !f) return 'unknown';
  return p === f ? 'match' : 'mismatch';
}

export function shouldWarnOnMismatch(m: IdentityMatch): boolean {
  return m === 'mismatch';
}

// ---------------------------------------------------------------------------
// Tarama hedefleri
// ---------------------------------------------------------------------------

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Maskeden prefix uzunluğu (255.255.255.0 → 24). Bitişik değilse null. */
export function prefixFromNetmask(netmask: string): number | null {
  const n = ipToInt(netmask);
  if (n === null) return null;
  const inverted = ~n >>> 0;
  if (((inverted + 1) & inverted) !== 0) return null;
  let bits = 0;
  let x = n;
  while (x & 0x80000000) {
    bits++;
    x = (x << 1) >>> 0;
  }
  return bits;
}

/**
 * Cihazın kendi adresinden taranacak IP listesini üretir.
 *
 * ⚠️ ÜÇ SINIR:
 *  • ağ adresi (.0), yayın adresi (.255) ve CİHAZIN KENDİSİ dışlanır;
 *  • `/22`den geniş ağda TAM tarama YOK — yalnız kendi `/24` dilimi (bir `/16`
 *    65534 istek demek; tablet pili ve fabrika Wi-Fi'si bunu kaldırmaz);
 *  • link-local (`169.254.x`) hiç taranmaz.
 *
 * ⚠️ Tavan masaüstünden DAHA DAR (512 ↔ 1022): tablet Wi-Fi üzerinden ve pille
 * çalışıyor, aynı bütçeyi vermek yanlış olurdu.
 */
export function scanTargetsFor(
  address: string | null | undefined,
  netmask: string | null | undefined,
  opts: { maxHosts?: number } = {},
): string[] {
  if (!address) return [];
  if (address.startsWith('169.254.')) return [];
  const self = ipToInt(address);
  if (self === null) return [];

  let prefix = netmask ? prefixFromNetmask(netmask) : null;
  if (prefix === null) prefix = 24;
  if (prefix < SCAN_MIN_PREFIX) prefix = 24;

  const maskBits = 0xffffffff << (32 - prefix);
  const network = (self & maskBits) >>> 0;
  const broadcast = (network | (~maskBits >>> 0)) >>> 0;
  const maxHosts = opts.maxHosts ?? SCAN_MAX_HOSTS;

  const out: string[] = [];
  for (let ip = network + 1; ip < broadcast; ip++) {
    if (ip === self) continue;
    out.push(intToIp(ip));
    if (out.length >= maxHosts) break;
  }
  return out;
}

/** En iyi aday başa: sabitlenmiş kimlik → düşük gecikme. */
export function rankCandidates(list: DiscoveredServer[]): DiscoveredServer[] {
  return [...list].sort((a, b) => {
    const am = a.matchesPinned === 'match' ? 0 : 1;
    const bm = b.matchesPinned === 'match' ? 0 : 1;
    if (am !== bm) return am - bm;
    return a.rttMs - b.rttMs;
  });
}

/**
 * "Sunucu taşınmış, adresi kendiliğinden güncelle" kararı — SAF.
 *
 * ⚠️ BU FONKSİYON BİR GÜVENLİK SINIRIDIR ve üç kuralı var; üçü de sessizce
 * kaybolabilecek türden:
 *
 *  1) SABİTLENMİŞ KİMLİK YOKSA HİÇBİR ŞEY YAPILMAZ. Kimlik olmadan "aynı sunucu"
 *     kanıtlanamaz; ağda cevap veren ilk makineye sessizce bağlanmak, operatörün
 *     YANLIŞ FABRİKANIN verisine kayıt girmesi demektir.
 *  2) Yalnız kimliği TUTAN aday seçilir. `unknown` (kimliksiz/eski sunucu) da,
 *     `mismatch` de otomatik geçiş için YETERSİZDİR — ikisi de kullanıcıya sorulur.
 *  3) Adres GERÇEKTEN değişmiş olmalı; aynı adresi yeniden yazmak gereksiz bir
 *     store yazımı ve gereksiz bir "bağlantı geri geldi" bildirimi üretir.
 */
export function pickSelfHealTarget(
  candidates: DiscoveredServer[],
  currentBaseUrl: string,
  pinnedId: string | null | undefined,
): DiscoveredServer | null {
  if (!pinnedId || !pinnedId.trim()) return null;
  const current = (currentBaseUrl ?? '').replace(/\/api\/?$/i, '').replace(/\/+$/, '');
  for (const c of candidates) {
    if (c.matchesPinned !== 'match') continue;
    if (c.baseUrl.replace(/\/+$/, '') === current) continue;
    return c;
  }
  return null;
}

/** `http://host:port` — taban adres. `normalizeUrl` sonradan `/api` ekler. */
export function baseUrlOf(host: string, port: number): string {
  return `http://${host}:${port}`;
}
