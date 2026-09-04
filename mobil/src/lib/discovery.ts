/**
 * Sunucu keşfi — SAF mantık (mobil).
 *
 * ⚠️ Bu dosya `Electron/shared/discovery.ts`in İKİZİDİR ama import EDEMEZ:
 * mobil bağımsız bir proje, monorepo paylaşımı yok (`types/permissions.ts` ile
 * aynı durum). İkisi elle senkron tutulur; sözleşmenin kilidi
 * `discovery.contract.test.ts` — kimlik ucunun YOLUNU backend kaynağından okur,
 * ve aşağıdaki `KEŞİF-İKİZ` bloğunu Electron kopyasıyla METİN OLARAK kıyaslar;
 * yani asıl ayrışma noktaları mekanik olarak korunur.
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

// ---------------------------------------------------------------------------
// Adres tercihi + KURULUM BAZLI tekilleştirme
//
// >>> KEŞİF-İKİZ BAŞLANGIÇ — bu blok `Electron/shared/discovery.ts` ile
// `mobil/src/lib/discovery.ts` arasında BİREBİR AYNI olmak zorundadır. İki
// istemci aynı hatayı ayrı ayrı yapmasın diye kural tek metinde yaşar; kilidi
// `discovery.contract.test.ts` (mobil) ve `discovery-logic.test.ts` (Electron)
// mekanik olarak karşılaştırır. Blok içine PROJEYE ÖZGÜ hiçbir şey yazılmaz —
// farklılık gerekiyorsa `tieBreak` parametresiyle DIŞARIDAN verilir.
// ---------------------------------------------------------------------------

/**
 * Adresin "başka bir makineden ne kadar işe yarar" sırası — KÜÇÜK daha iyidir.
 *
 * ⚠️ BU BİR SIRALAMADIR, ELEME DEĞİL. Sanal/overlay aralıklardan gerçekten
 * hizmet veriliyor olabilir (Docker'da koşan sunucu, Tailscale üzerinden bağlı
 * şube). Körlemesine elemek, çalışan tek yolu olan kurulumu sunucusuz bırakır.
 * Bu yüzden her aday listede KALIR; yalnız hangisinin ÖNCE denendiği değişir.
 *
 * Ölçülen vaka (2026-09-04, `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md` §4):
 * Windows'ta Hyper-V sanal anahtarı (`172.20.144.1`, arayüz metriği 15) gerçek
 * Wi-Fi kartından (`192.168.1.102`, metrik 50) ÖNCELİKLİ olduğu için panel
 * host-only adresi seçiyordu — o adres yalnız sunucunun kendi makinesinden
 * erişilebilir, yani ağdaki hiçbir tablet oraya bağlanamaz.
 */
export const ADDRESS_RANK = {
  /** Klasik fabrika LAN'ı — 192.168/16 ve 10/8. */
  LAN: 0,
  /** Ad (mDNS/DNS) ya da sınıflandırılamayan IPv4. */
  OTHER: 1,
  /** 172.16/12 — Hyper-V varsayılan anahtarı, Docker köprüsü, WSL. Çoğu kez host-only. */
  VIRTUAL: 2,
  /** 100.64/10 — CGNAT/Tailscale. Çalışır ama LAN değildir. */
  OVERLAY: 3,
  /** 127/8 ve `localhost` — YALNIZ aynı makineden erişilebilir. */
  LOOPBACK: 4,
  /** 169.254/16 — DHCP alamamış arayüz. */
  LINK_LOCAL: 5,
} as const;

export function addressPreferenceRank(host: string | null | undefined): number {
  const h = (host ?? '').trim().toLowerCase();
  if (!h) return ADDRESS_RANK.OTHER;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return h === 'localhost' ? ADDRESS_RANK.LOOPBACK : ADDRESS_RANK.OTHER;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 127) return ADDRESS_RANK.LOOPBACK;
  if (a === 169 && b === 254) return ADDRESS_RANK.LINK_LOCAL;
  if (a === 192 && b === 168) return ADDRESS_RANK.LAN;
  if (a === 10) return ADDRESS_RANK.LAN;
  if (a === 172 && b >= 16 && b <= 31) return ADDRESS_RANK.VIRTUAL;
  if (a === 100 && b >= 64 && b <= 127) return ADDRESS_RANK.OVERLAY;
  return ADDRESS_RANK.OTHER;
}

/** Gruplama için gereken asgari aday şekli — iki projenin aday tipi de bunu sağlar. */
export interface AddressCandidate {
  host: string;
  port: number;
  identity: ServerIdentity | null;
  rttMs: number;
  matchesPinned: IdentityMatch;
}

/** Tek sunucu (kurulum) — çok adres. Liste bunu TEK SATIR olarak gösterir. */
export interface ServerGroup<T extends AddressCandidate> {
  /** `iid:<kurulum>` ya da kimliksiz adayda `addr:<host>:<port>`. */
  key: string;
  installationId: string | null;
  identity: ServerIdentity | null;
  matchesPinned: IdentityMatch;
  /** Tercih sırasına göre ilk adres — otomatik seçilen. */
  primary: T;
  /** Tümü, tercih sırasında. Kullanıcı isterse buradan başka adres seçer. */
  addresses: T[];
}

/**
 * Adayları KURULUM KİMLİĞİNE göre gruplar.
 *
 * ⚠️ `installationId` NULL olan aday BAŞKA BİR ADAYLA BİRLEŞTİRİLMEZ — kendi
 * `host:port` anahtarında tek başına kalır. Kimliksiz sunucu eski sürüm ya da
 * boot'ta DB'si hazır olmayan sunucudur (bkz. `compareIdentity` notu); iki
 * kimliksiz adayı "aynı sunucu" saymak için elimizde hiçbir kanıt yok ve
 * birleştirmek gerçek ikinci bir sunucuyu listeden SİLERDİ. Yani eski davranış
 * (adres bazlı) kimliksiz sunucuda birebir korunur.
 *
 * Grup içi sıra: adres tercihi → `tieBreak` (çağıranın işi) → gecikme → ad.
 * Son basamak sözlükseldir ve determinizm içindir: eşit adaylarda sıra turdan
 * tura oynarsa "otomatik seçilen adres" de oynar.
 */
export function groupByInstallation<T extends AddressCandidate>(
  list: T[],
  tieBreak?: (a: T, b: T) => number,
): ServerGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const c of list) {
    const iid = c.identity?.installationId;
    const key = iid && iid.trim() ? `iid:${iid.trim().toLowerCase()}` : `addr:${c.host}:${c.port}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(c);
    else {
      byKey.set(key, [c]);
      order.push(key);
    }
  }

  const out: ServerGroup<T>[] = [];
  for (const key of order) {
    const bucket = byKey.get(key);
    if (!bucket || bucket.length === 0) continue;
    const addresses = [...bucket].sort((a, b) => {
      const ar = addressPreferenceRank(a.host);
      const br = addressPreferenceRank(b.host);
      if (ar !== br) return ar - br;
      const t = tieBreak ? tieBreak(a, b) : 0;
      if (t !== 0) return t;
      if (a.rttMs !== b.rttMs) return a.rttMs - b.rttMs;
      return a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
    });
    const primary = addresses[0];
    if (!primary) continue;
    out.push({
      key,
      installationId: primary.identity?.installationId ?? null,
      identity: primary.identity,
      matchesPinned: primary.matchesPinned,
      primary,
      addresses,
    });
  }
  return out;
}

/**
 * Aynı sunucuyu birden çok adresten bulmuşsak TEK adaya indirir.
 *
 * ⚠️ Tekilleştirmenin ölçütü KİMLİKTİR, adres değil: çok ağ arayüzlü bir sunucu
 * (Wi-Fi + hotspot + sanal anahtar + Tailscale) sahada 7 IPv4 taşıyabiliyor ve
 * hepsi aynı tek süreci gösteriyor. Adres bazlı liste operatöre "üç ayrı
 * sunucu" gösteriyordu.
 */
export function dedupeCandidates<T extends AddressCandidate>(
  list: T[],
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return groupByInstallation(list, tieBreak).map((g) => g.primary);
}

// <<< KEŞİF-İKİZ SON

// ---------------------------------------------------------------------------
// Aday listesi
// ---------------------------------------------------------------------------

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
