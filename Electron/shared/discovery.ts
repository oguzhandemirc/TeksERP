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

/** Varsayılan port artık KEŞİF-İKİZ bloğunda, `DISCOVERY_PORTS`ten türer. */

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
 * Keşifte denenecek portlar — SIRA ANLAMLI, İLK ELEMAN VARSAYILANDIR.
 *
 * ⚠️ TEK KAYNAK: `DISCOVERY_DEFAULT_PORT` bu listeden TÜRETİLİR, ayrıca
 * yazılmaz. İki ayrı gerçek olsaydı biri değişip diğeri kalırdı ve arıza
 * SESSİZ olurdu: mDNS ilanı portu kendi taşıdığı için o yol çalışmaya devam
 * eder, yalnız TARAMA yanlış porta bakardı — yani "bazen buluyor, bazen
 * bulmuyor".
 *
 * ⚠️ LİSTE KISA TUTULUR. Tarama maliyeti host × port ile DOĞRUSAL büyür; her
 * yeni port, sunucunun hiç bulunamadığı turda saniyeler ekler. Buradaki üç
 * yedek "kurulumu yapan kişi varsayılanı değiştirdiyse hangi sayıyı yazar"
 * sorusunun cevabıdır:
 *   • 5000 — kullanıcı tarafından açıkça istendi (2026-09-04)
 *   • 3000 — Node/Express dünyasının klasik varsayılanı
 *   • 8080 — "alternatif HTTP"nin evrensel karşılığı
 *
 * ⚠️ YEDEK PORTTA KİMLİK ZORUNLUDUR (`identityRequiredForPort`). Varsayılan
 * portta `/health` UP diyen KİMLİKSİZ sunucu meşru adaydır (eski backend);
 * yedek portta değildir. `{"status":"UP"}` TeksERP'e özgü bir gövde değil
 * (Spring Boot Actuator birebir aynısını basar) ve yedek portlar kimlik
 * ucuyla BİRLİKTE doğdu — yani orada "kimlik ucu olmayan eski backend" diye
 * bir vaka YOKTUR. Gevşetirsen 8080'deki rastgele bir web sunucusu operatöre
 * "sunucu bulundu" diye gösterilir.
 */
export const DISCOVERY_PORTS = [4000, 5000, 3000, 8080] as const;

/** Backend'in varsayılan portu — listenin İLK elemanı, ayrı bir gerçek DEĞİL. */
export const DISCOVERY_DEFAULT_PORT: number = DISCOVERY_PORTS[0];

/** Varsayılan bulunamazsa denenecek portlar, SIRAYLA. */
export function fallbackDiscoveryPorts(): number[] {
  return DISCOVERY_PORTS.filter((p) => p !== DISCOVERY_DEFAULT_PORT);
}

/** Bu portta aday olabilmek için kimlik ucu ŞART mı? Yedek portlarda EVET. */
export function identityRequiredForPort(port: number): boolean {
  return port !== DISCOVERY_DEFAULT_PORT;
}

export interface StagedScanOutcome<T> {
  results: T[];
  /** Gerçekten taranan portlar — "yedeğe hiç inilmedi" bunun uzunluğundan okunur. */
  ports: number[];
}

/**
 * KADEMELİ PORT TARAMASI — önce varsayılan, bulamazsa yedekler.
 *
 * ⚠️ MALİYET SIFIR KURALI: varsayılan port (ya da başka bir keşif ayağı) tek
 * bir aday üretmişse yedek portlara HİÇ BAKILMAZ. Normal fabrikada bu döngü
 * tam olarak BİR kez koşar ve bugünkü davranışla birebir aynı maliyeti üretir.
 * `hasCandidate` bu yüzden var: mDNS ya da kayıtlı adres zaten cevap verdiyse
 * tarama kademesi hiç genişlemesin.
 *
 * ⚠️ ADAY BULAN İLK KADEMEDE DURULUR. "Hepsini tara, en iyisini seç" demek,
 * sunucu 5000'de bulunduktan sonra 3000 ve 8080 için tam bir tur daha koşmak
 * demektir — kullanıcı beklerken, hiçbir şey kazanmadan.
 */
export async function runStagedPortScan<T>(
  scanPort: (port: number) => Promise<T[]>,
  opts: { hasCandidate?: () => boolean; aborted?: () => boolean } = {},
): Promise<StagedScanOutcome<T>> {
  const ports: number[] = [];
  const results: T[] = [];
  for (const port of DISCOVERY_PORTS) {
    if (opts.aborted?.()) break;
    if (port !== DISCOVERY_DEFAULT_PORT && (results.length > 0 || opts.hasCandidate?.())) break;
    ports.push(port);
    results.push(...(await scanPort(port)));
  }
  return { results, ports };
}

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

const SOURCE_RANK: Record<DiscoverySource, number> = {
  stored: 0,
  mdns: 1,
  recent: 2,
  scan: 3,
  localhost: 4,
};

/**
 * Electron'a ÖZGÜ eşitlik bozucu: adres tercihi eşitse, adayı daha güvenilir
 * yoldan bulmuş olan kazanır (mDNS ilanı ↔ kör tarama). İkiz blok bunu
 * bilmez — `tieBreak` olarak DIŞARIDAN verilir, çünkü mobilde `via` yok.
 */
export const bySourceRank = (a: DiscoveredServer, b: DiscoveredServer): number =>
  SOURCE_RANK[a.via] - SOURCE_RANK[b.via];

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
