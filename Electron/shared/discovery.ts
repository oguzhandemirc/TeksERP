/**
 * Sunucu keşfi — SAF mantık ve sabitler.
 *
 * ⚠️ BU DOSYAYA `node:net` / `os` / `dgram` İMPORT EDİLEMEZ. `tsconfig.web.json`
 * `shared/`'ı renderer ile birlikte derliyor ve orada node tipleri yok — bu bir
 * tercih değil derleyici dayatması. Soket işleri `electron/discovery/*` altında.
 *
 * Buradaki her şeyin saf olmasının ikinci bir faydası var: `vitest.config.ts`
 * yalnız `src/**`i topluyor, yani `electron/**` test EDİLEMİYOR. Mantık burada
 * durursa bekçi yazılabilir.
 */

/** mDNS servis tipi — sunucu `_teks-erp._tcp` olarak ilan eder. */
export const DISCOVERY_MDNS_TYPE = "teks-erp";

/** Kimlik ucunun yolu (taban adresin ARDINA eklenir). */
export const DISCOVERY_IDENTITY_PATH = "/api/discovery/identity";

/** Backend'in varsayılan portu. */
export const DISCOVERY_DEFAULT_PORT = 4000;

/** secure-store anahtarları. */
export const PINNED_IDENTITY_KEY = "config.serverIdentity";
export const LAST_DISCOVERY_KEY = "config.lastDiscovery";

/** Tek turda taranacak en fazla adres — fabrika switch'ini boğmamak için. */
export const SCAN_MAX_HOSTS = 1022;

/** Bir `/24` diliminden geniş ağlarda tam tarama YAPILMAZ; bu eşiğin altı reddedilir. */
export const SCAN_MIN_PREFIX = 22;

export interface ServerIdentity {
  product: string;
  discoveryVersion: number;
  installationId: string | null;
  serverName: string;
  companyName: string;
  version: string;
}

/** Sabitlenmiş kimlikle bulunan kimliğin karşılaştırma sonucu. */
export type IdentityMatch = "match" | "mismatch" | "unknown";

/** Adayın hangi yoldan bulunduğu — sıralamada ve arayüzdeki rozette kullanılır. */
export type DiscoverySource = "stored" | "mdns" | "recent" | "scan" | "localhost";

export interface DiscoveredServer {
  baseUrl: string;
  host: string;
  port: number;
  via: DiscoverySource;
  /** null = eski backend (kimlik ucu 404) ama `/health` UP. UYUŞMAZLIK DEĞİLDİR. */
  identity: ServerIdentity | null;
  rttMs: number;
  matchesPinned: IdentityMatch;
}

// ---------------------------------------------------------------------------
// Kimlik
// ---------------------------------------------------------------------------

/** Ham JSON'u kimliğe çözer; şekli tutmuyorsa null. */
export function parseIdentityPayload(raw: unknown): ServerIdentity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.product !== "TeksERP") return null;
  const iid = r.installationId;
  return {
    product: "TeksERP",
    discoveryVersion: typeof r.discoveryVersion === "number" ? r.discoveryVersion : 0,
    // Boş string kimlik DEĞİLDİR — null'a indirilir ki "kimlik yok" tek biçimde temsil edilsin.
    installationId: typeof iid === "string" && iid.trim() ? iid.trim() : null,
    serverName: typeof r.serverName === "string" ? r.serverName : "",
    companyName: typeof r.companyName === "string" ? r.companyName : "",
    version: typeof r.version === "string" ? r.version : "",
  };
}

/** mDNS TXT kaydından kısmi kimlik çıkarır (ön eleme için — kesin kaynak HTTP). */
export function identityFromTxt(
  txt: Record<string, string | Uint8Array | undefined> | null | undefined,
): Partial<ServerIdentity> {
  if (!txt) return {};
  const read = (k: string): string | undefined => {
    const v = txt[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string") return v;
    // bonjour-service bazı alanları Uint8Array olarak verebiliyor.
    try {
      return new TextDecoder().decode(v);
    } catch {
      return undefined;
    }
  };
  const iid = read("iid");
  const out: Partial<ServerIdentity> = {};
  if (iid && iid.trim()) out.installationId = iid.trim();
  const name = read("name");
  if (name) out.serverName = name;
  const co = read("co");
  if (co) out.companyName = co;
  const ver = read("ver");
  if (ver) out.version = ver;
  const v = read("v");
  if (v && Number.isFinite(Number(v))) out.discoveryVersion = Number(v);
  return out;
}

/**
 * Sabitlenmiş kimlik ile bulunanı karşılaştırır.
 *
 * ⚠️ `unknown` ASLA `match` gibi davranmamalı ve ASLA uyarı doğurmamalı. Üç
 * meşru sebebi var: henüz sabitlenmemiş cihaz, kimlik ucu olmayan eski backend,
 * boot'ta DB'si hazır olmayan sunucu. Bunları "farklı sunucu" diye suçlamak
 * uyarıyı yanlış-pozitif üretir hale getirir; operatör onu ezberden geçmeye
 * başlar ve koruma değersizleşir.
 */
export function compareIdentity(
  pinned: string | null | undefined,
  found: string | null | undefined,
): IdentityMatch {
  const p = (pinned ?? "").trim().toLowerCase();
  const f = (found ?? "").trim().toLowerCase();
  if (!p || !f) return "unknown";
  return p === f ? "match" : "mismatch";
}

/** Kullanıcıya soru sorulmalı mı — YALNIZ gerçek uyuşmazlıkta. */
export function shouldWarnOnMismatch(m: IdentityMatch): boolean {
  return m === "mismatch";
}

// ---------------------------------------------------------------------------
// Alt ağ taraması hedefleri
// ---------------------------------------------------------------------------

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
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
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Maskeden prefix uzunluğu (255.255.255.0 → 24). Geçersizse null. */
export function prefixFromNetmask(netmask: string): number | null {
  const n = ipToInt(netmask);
  if (n === null) return null;
  // Maske bitişik 1'lerden oluşmalı.
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

export interface ScanInterface {
  address: string;
  netmask: string;
}

/**
 * Taranacak IP listesini üretir.
 *
 * ⚠️ ÜÇ SINIR, üçü de bilinçli:
 *  • Ağ adresi (.0), yayın adresi (.255) ve CİHAZIN KENDİSİ dışlanır.
 *  • `/22`den geniş ağlarda TAM tarama YAPILMAZ — yalnız cihazın kendi `/24`
 *    dilimi taranır. Bir `/16` 65534 bağlantı denemesi demektir: fabrika
 *    switch'ini boğar ve IT'nin kara listesine girer.
 *  • Link-local (`169.254.x`) hiç taranmaz — orada sunucu olmaz.
 */
export function scanTargetsFor(
  ifaces: ScanInterface[],
  opts: { maxHosts?: number } = {},
): string[] {
  const maxHosts = opts.maxHosts ?? SCAN_MAX_HOSTS;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const iface of ifaces) {
    const self = ipToInt(iface.address);
    if (self === null) continue;
    // Link-local: DHCP alamamış arayüz. Sunucu orada olmaz.
    if (iface.address.startsWith("169.254.")) continue;

    let prefix = prefixFromNetmask(iface.netmask);
    if (prefix === null) prefix = 24;
    // Geniş ağda kendi /24 dilimine daral.
    if (prefix < SCAN_MIN_PREFIX) prefix = 24;

    const maskBits = 0xffffffff << (32 - prefix);
    const network = (self & maskBits) >>> 0;
    const broadcast = (network | (~maskBits >>> 0)) >>> 0;

    for (let ip = network + 1; ip < broadcast; ip++) {
      if (ip === self) continue;
      const s = intToIp(ip);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= maxHosts) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aday listesi
// ---------------------------------------------------------------------------

const SOURCE_RANK: Record<DiscoverySource, number> = {
  stored: 0,
  mdns: 1,
  recent: 2,
  scan: 3,
  localhost: 4,
};

/**
 * Aynı sunucuyu iki yoldan bulmuşsak tekilleştirir. Kimlik biliniyorsa ona,
 * bilinmiyorsa `host:port`e göre. Daha güvenilir kaynak (mDNS) taramayı yener.
 */
export function dedupeCandidates(list: DiscoveredServer[]): DiscoveredServer[] {
  const byKey = new Map<string, DiscoveredServer>();
  for (const c of list) {
    const key = c.identity?.installationId
      ? `iid:${c.identity.installationId}`
      : `addr:${c.host}:${c.port}`;
    const prev = byKey.get(key);
    if (!prev || SOURCE_RANK[c.via] < SOURCE_RANK[prev.via]) byKey.set(key, c);
  }
  return [...byKey.values()];
}

/** En iyi aday başa: sabitlenmiş kimlik → kaynak güvenilirliği → düşük gecikme. */
export function rankCandidates(list: DiscoveredServer[]): DiscoveredServer[] {
  return [...list].sort((a, b) => {
    const am = a.matchesPinned === "match" ? 0 : 1;
    const bm = b.matchesPinned === "match" ? 0 : 1;
    if (am !== bm) return am - bm;
    const ar = SOURCE_RANK[a.via];
    const br = SOURCE_RANK[b.via];
    if (ar !== br) return ar - br;
    return a.rttMs - b.rttMs;
  });
}

/** `http://host:port` — taban adres (`/api` EKLENMEZ; onu apiClient ekler). */
export function baseUrlOf(host: string, port: number): string {
  return `http://${host}:${port}`;
}
