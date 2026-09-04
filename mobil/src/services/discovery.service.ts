/**
 * Sunucu keşfi (mobil) — ALT AĞ TARAMASI.
 *
 * ⚠️ MASAÜSTÜNDEN FARKI: burada mDNS AYAĞI YOK. `bonjour-service` bir Node
 * kütüphanesi, React Native'de koşmaz; mDNS için `react-native-zeroconf` (yerel
 * modül) ve `expo prebuild` gerekirdi — o da belgelenmiş bir saha regresyonu
 * riski taşıyor (2026-08-15: prebuild manifesti sıfırladı, `usesCleartextTraffic`
 * düştü, HER istek "Network Error"). Tarama ayağı yeni yerel modül İSTEMEZ,
 * hiçbir multicast filtresine takılmaz ve OTA ile gidebilir.
 *
 * ⚠️ SIRA LOAD-BEARING: önce OLASI adresler (kayıtlı/son kullanılan/tipik sunucu
 * IP'leri), sonra tam süpürme. Fabrikada sunucu `.250`de — öncelik listesi onu
 * ilk turda bulur ve süpürme HİÇ koşmaz. Düz süpürme 253 isteği tablet Wi-Fi'sinde
 * ~3 sn'ye yayar; öncelik listesi bunu tipik olarak yarım saniyeye indirir.
 *
 * Cihazın kendi IP'si `NetInfo`dan geliyor (`details.ipAddress`/`subnet`) —
 * EK İZİN GEREKMİYOR, kütüphanenin kendi manifesti `ACCESS_WIFI_STATE` getiriyor
 * ve birleşik manifest'te doğrulandı.
 */
import NetInfo from '@react-native-community/netinfo';
import {
  DISCOVERY_DEFAULT_PORT,
  DISCOVERY_IDENTITY_PATH,
  baseUrlOf,
  compareIdentity,
  dedupeCandidates,
  fallbackDiscoveryPorts,
  groupByInstallation,
  identityRequiredForPort,
  parseIdentityPayload,
  rankCandidates,
  runStagedPortScan,
  scanTargetsFor,
  type DiscoveredServer,
  type ServerGroup,
} from '../lib/discovery';

/** Tek adres için bekleme. Wi-Fi'de çok kısası YANLIŞ "sunucu yok" üretir. */
const PROBE_TIMEOUT_MS = 900;
/** Aynı anda kaç istek — tablet ve fabrika Wi-Fi'si için bilinçli olarak dar. */
const CONCURRENCY = 24;

/**
 * Öncelikli denenecek son oktetler. Fabrikanın sunucusu `.250`; `.1` ağ geçidi,
 * kalanlar tipik sabit sunucu adresleri. Liste KISA olmalı — uzun bir "olası"
 * listesi süpürmenin ta kendisine dönüşür ve önceliği anlamsızlaştırır.
 */
const LIKELY_OCTETS = [250, 1, 10, 100, 200, 2, 5, 20, 50, 254];

export interface DiscoveryProgress {
  tried: number;
  total: number;
}

export interface DiscoveryOptions {
  /** Sabitlenmiş kurulum kimliği — aday bununla eşleşirse tur ERKEN biter. */
  pinnedInstallationId?: string | null;
  /** Önce denenecek tam adresler (kayıtlı adres, son kullanılanlar). */
  preferredUrls?: string[];
  /** Tam süpürme yapılsın mı. Splash yolunda KAPALI tutulur (ekranı bekletmesin). */
  fullSweep?: boolean;
  /**
   * Varsayılan portta HİÇBİR aday çıkmazsa yedek portlar (5000/3000/8080) da
   * denensin mi.
   *
   * ⚠️ VARSAYILAN KAPALI ve bu bilinçli: maliyet host × port ile doğrusal
   * büyür. Yalnız kullanıcının AÇIKÇA "Ağda Ara" dediği yolda açılır. Kendi
   * kendini onaran arka plan turu (`serverReachability.trySelfHeal`) bunu
   * AÇMAZ — orada aranan şey sabitlenmiş kimliği taşıyan, DAHA ÖNCE bilinen
   * bir portta bulunmuş sunucudur (adresi zaten `preferredUrls`te); port avı
   * bir KURULUM sorunudur, kesinti sorunu değil.
   */
  extraPorts?: boolean;
  onProgress?: (p: DiscoveryProgress) => void;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  /**
   * SUNUCU başına TEK satır — adres başına değil.
   *
   * ⚠️ Çok ağ arayüzlü sunucu (Wi-Fi + hotspot + sanal anahtar) aynı süreci
   * birden çok adresten cevaplatır; adres bazlı liste operatöre "iki ayrı
   * sunucu" gösteriyordu (ölçüm: `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md` §4).
   * Tekilleştirme ölçütü `installationId`; kimliği OLMAYAN sunucuda eski
   * davranış (adres bazlı) birebir korunur.
   */
  candidates: DiscoveredServer[];
  /** Aynı liste, adresleri açık — kullanıcıya adres seçtirmek isteyen yüzey için. */
  groups: ServerGroup<DiscoveredServer>[];
  /**
   * Tarama gerçekten koştu mu — koşmadıysa sebebi.
   * `ports` = gerçekten denenen portlar; tek eleman → yedeklere HİÇ inilmedi.
   */
  scan: { ran: boolean; tried: number; ports: number[]; skippedReason: string | null };
  /** Cihazın kendi ağ bilgisi okunabildi mi. */
  network: { address: string | null; subnet: string | null };
}

/** `http://host:port[/api]` → parçalar. Çözülemezse null. */
function splitUrl(url: string): { host: string; port: number } | null {
  const m = /^https?:\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? '').trim());
  if (!m || !m[1]) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : DISCOVERY_DEFAULT_PORT };
}

/**
 * Tek adresi doğrular. Kimlik ucu 200 verirse kimlikli; VARSAYILAN portta 404
 * verirse `/health` ile teyit edip KİMLİKSİZ aday döner (eski backend —
 * uyuşmazlık DEĞİLDİR). Yedek portlarda kimlik ŞART. Asla throw etmez.
 */
export async function probeServer(
  host: string,
  port: number,
  pinnedId: string | null | undefined,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DiscoveredServer | null> {
  const started = Date.now();
  const root = baseUrlOf(host, port);

  const get = async (path: string): Promise<{ status: number; body: string } | null> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}${path}`, { signal: ctrl.signal });
      const body = await res.text();
      return { status: res.status, body };
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  };

  const res = await get(DISCOVERY_IDENTITY_PATH);
  if (res && res.status === 200) {
    try {
      const identity = parseIdentityPayload(JSON.parse(res.body));
      if (identity) {
        return {
          baseUrl: root,
          host,
          port,
          identity,
          rttMs: Date.now() - started,
          matchesPinned: compareIdentity(pinnedId, identity.installationId),
        };
      }
    } catch {
      /* gövde JSON değil → /health yoluna düş */
    }
  }

  // ⚠️ Yedek portta `/health` yolu KAPALI: `{"status":"UP"}` TeksERP'e özgü
  // değildir (Spring Boot Actuator birebir aynısını basar). Varsayılan portta
  // bu riski "kimlik ucu olmayan eski backend'i kaybetmemek" için alıyoruz;
  // yedek portlarda öyle bir vaka yok, orada kimlik ŞART.
  if (identityRequiredForPort(port)) return null;
  const health = await get('/health');
  if (!health || health.status !== 200) return null;
  try {
    const parsed = JSON.parse(health.body) as { status?: unknown };
    if (parsed?.status !== 'UP') return null;
  } catch {
    return null;
  }
  return {
    baseUrl: root,
    host,
    port,
    identity: null,
    rttMs: Date.now() - started,
    matchesPinned: 'unknown',
  };
}

/** Sınırlı eşzamanlılıkla koşar; `stopOnMatch` doluysa eşleşmede erken çıkar. */
async function probeMany(
  targets: { host: string; port: number }[],
  pinnedId: string | null | undefined,
  found: DiscoveredServer[],
  opts: { signal?: AbortSignal; onProgress?: (n: number) => void },
): Promise<boolean> {
  let index = 0;
  let tried = 0;
  let earlyMatch = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (earlyMatch || opts.signal?.aborted) return;
      const i = index++;
      if (i >= targets.length) return;
      const t = targets[i];
      if (!t) return;
      const hit = await probeServer(t.host, t.port, pinnedId);
      tried++;
      opts.onProgress?.(tried);
      if (hit) {
        found.push(hit);
        // Sabitlenmiş kimlikle eşleşen aday = kesin cevap; aramaya devam etmek
        // tablet pilini ve fabrika ağını boşuna meşgul eder.
        if (hit.matchesPinned === 'match') earlyMatch = true;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
  );
  return earlyMatch;
}

/**
 * Sunucuyu arar.
 *
 * `fullSweep` KAPALIYKEN yalnız öncelikli adresler denenir (hızlı, açılış yolu
 * için); AÇIKKEN bulunamazsa tüm alt ağ süpürülür (kullanıcı "Sunucuyu Ara"
 * dediğinde).
 *
 * `extraPorts` AÇIKKEN ve varsayılan portta HİÇ kullanılabilir aday çıkmadıysa
 * yedek portlar (`DISCOVERY_PORTS`) sırayla denenir; aday bulan İLK portta
 * durulur. Aday varsa bu kademe HİÇ koşmaz — maliyet sıfır.
 */
export async function discoverServers(opts: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const pinnedId = opts.pinnedInstallationId ?? null;
  const found: DiscoveredServer[] = [];
  const seen = new Set<string>();
  const push = (host: string, port: number): { host: string; port: number } | null => {
    const key = `${host}:${port}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { host, port };
  };

  const net = await NetInfo.fetch().catch(() => null);
  const details = (net?.details ?? {}) as { ipAddress?: string | null; subnet?: string | null };
  const address = details.ipAddress ?? null;
  const subnet = details.subnet ?? null;

  // --- 1) Öncelikli adresler: kayıtlı/son kullanılan + tipik sunucu oktetleri --
  const priority: { host: string; port: number }[] = [];
  for (const url of opts.preferredUrls ?? []) {
    const p = splitUrl(url);
    if (!p) continue;
    const t = push(p.host, p.port);
    if (t) priority.push(t);
  }
  if (address) {
    const prefix = address.split('.').slice(0, 3).join('.');
    for (const o of LIKELY_OCTETS) {
      const host = `${prefix}.${o}`;
      if (host === address) continue;
      const t = push(host, DISCOVERY_DEFAULT_PORT);
      if (t) priority.push(t);
    }
  }

  // İlerleme tek sayaçtan akar: kademeler eklendikçe `total` büyür, `done`
  // biten kademeleri taşır. Ayrı ayrı sayarsak çubuk her kademede sıfırlanır.
  let done = 0;
  let total = priority.length;
  let tried = 0;
  const bump = (n: number): void => {
    tried = done + n;
    opts.onProgress?.({ tried, total });
  };
  const early = await probeMany(priority, pinnedId, found, {
    signal: opts.signal,
    onProgress: bump,
  });
  done += priority.length;
  tried = done;

  /**
   * ⚠️ "Aday bulundu" yetmez, KULLANILABİLİR aday bulunmuş olmalı. Kimliği
   * sabitlenmişle UYUŞMAYAN bir sunucu bulmak, aramayı bitirmek için sebep
   * değildir — doğrusu ağda başka bir yerde olabilir ve aramayı kesersek
   * kullanıcıya yalnız yanlış sunucuyu göstermiş oluruz.
   */
  const hasUsable = (): boolean => found.some((c) => c.matchesPinned !== 'mismatch');

  const sweepHosts = address ? scanTargetsFor(address, subnet) : [];

  /** Bir kademeyi koşturur; bulunan YENİ adayları döner. */
  const runStage = async (
    targets: { host: string; port: number }[],
  ): Promise<DiscoveredServer[]> => {
    if (targets.length === 0) return [];
    const before = found.length;
    total += targets.length;
    await probeMany(targets, pinnedId, found, { signal: opts.signal, onProgress: bump });
    done += targets.length;
    tried = done;
    return found.slice(before);
  };

  // --- 2) Tam süpürme, VARSAYILAN portta (yalnız gerekiyorsa) ---------------
  let scanRan = false;
  let skippedReason: string | null = null;
  if (early) {
    skippedReason = 'sabitlenmiş sunucu öncelikli listede bulundu';
  } else if (hasUsable()) {
    skippedReason = 'öncelikli listede kullanılabilir sunucu bulundu';
  } else if (!opts.fullSweep) {
    skippedReason = 'hızlı arama (süpürme kapalı)';
  } else if (!address) {
    skippedReason = 'cihazın ağ adresi okunamadı';
  } else {
    scanRan = true;
    await runStage(
      sweepHosts
        .map((h) => push(h, DISCOVERY_DEFAULT_PORT))
        .filter((t): t is { host: string; port: number } => t !== null),
    );
  }

  // --- 3) YEDEK PORTLAR (yalnız hiçbir kullanılabilir aday yokken) ----------
  // Kademe kararı ORTAK helper'da (`runStagedPortScan`, KEŞİF-İKİZ bloğu) —
  // masaüstü de birebir aynı kuralı uygular.
  let ports: number[] = [DISCOVERY_DEFAULT_PORT];
  if (opts.extraPorts) {
    const staged = await runStagedPortScan<DiscoveredServer>(
      async (port) => {
        // Varsayılan portun turu YUKARIDA koştu; burada yalnız sonucunu
        // bildiriyoruz ki "genişleyeyim mi" kararı TEK yerde kalsın.
        if (port === DISCOVERY_DEFAULT_PORT) {
          return found.filter((c) => c.matchesPinned !== 'mismatch');
        }
        // ⚠️ TABLET BÜTÇESİ (masaüstünden DAR — `SCAN_MAX_HOSTS` 512↔1022 ile
        // aynı gerekçe: pil + Wi-Fi). Yedek portlarda TAM SÜPÜRME yalnız İLK
        // yedekte (bugün 5000, açıkça istenen port) koşar; 3000/8080 yalnız
        // öncelik listesini görür. Ölçüm: her tam süpürme turu tablette ~10 sn
        // ve "alışılmadık IP + alışılmadık port" bileşik bir olasılıktır —
        // 20 sn'lik bekleme karşılığında alınmaz.
        const wideSweep = opts.fullSweep === true && port === fallbackDiscoveryPorts()[0];
        const hosts = [...priority.map((t) => t.host)];
        if (wideSweep) for (const h of sweepHosts) if (!hosts.includes(h)) hosts.push(h);
        const targets = hosts
          .map((h) => push(h, port))
          .filter((t): t is { host: string; port: number } => t !== null);
        if (targets.length > 0) scanRan = true;
        return runStage(targets);
      },
      { aborted: () => opts.signal?.aborted === true },
    );
    ports = staged.ports;
  }

  // Sıra: ÖNCE tekilleştir (sunucu başına en iyi adres), SONRA sırala. Tersi,
  // aynı sunucunun iki adresini iki ayrı satır gibi sıralar.
  const groups = groupByInstallation(found);
  return {
    candidates: rankCandidates(dedupeCandidates(found)),
    groups,
    scan: { ran: scanRan, tried, ports, skippedReason },
    network: { address, subnet },
  };
}
