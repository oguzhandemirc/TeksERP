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
  groupByInstallation,
  parseIdentityPayload,
  rankCandidates,
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
  /** Tarama gerçekten koştu mu — koşmadıysa sebebi. */
  scan: { ran: boolean; tried: number; skippedReason: string | null };
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
 * Tek adresi doğrular. Kimlik ucu 200 verirse kimlikli, 404 verirse `/health`
 * ile teyit edip KİMLİKSİZ aday döner (eski backend — uyuşmazlık DEĞİLDİR).
 * Asla throw etmez.
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

  let tried = 0;
  const bump = (n: number): void => {
    tried = n;
    opts.onProgress?.({ tried: n, total: priority.length });
  };
  const early = await probeMany(priority, pinnedId, found, {
    signal: opts.signal,
    onProgress: bump,
  });

  // --- 2) Tam süpürme (yalnız gerekiyorsa) ---------------------------------
  let scanRan = false;
  let skippedReason: string | null = null;
  // ⚠️ "Aday bulundu" yetmez, KULLANILABİLİR aday bulunmuş olmalı. Kimliği
  // sabitlenmişle UYUŞMAYAN bir sunucu bulmak, aramayı bitirmek için sebep
  // değildir — doğrusu ağda başka bir yerde olabilir ve süpürmezsek kullanıcıya
  // yalnız yanlış sunucuyu göstermiş oluruz.
  const usable = found.some((c) => c.matchesPinned !== 'mismatch');
  if (early) {
    skippedReason = 'sabitlenmiş sunucu öncelikli listede bulundu';
  } else if (usable) {
    skippedReason = 'öncelikli listede kullanılabilir sunucu bulundu';
  } else if (!opts.fullSweep) {
    skippedReason = 'hızlı arama (süpürme kapalı)';
  } else if (!address) {
    skippedReason = 'cihazın ağ adresi okunamadı';
  } else {
    const sweep = scanTargetsFor(address, subnet)
      .map((h) => push(h, DISCOVERY_DEFAULT_PORT))
      .filter((t): t is { host: string; port: number } => t !== null);
    scanRan = true;
    const total = priority.length + sweep.length;
    await probeMany(sweep, pinnedId, found, {
      signal: opts.signal,
      onProgress: (n) => opts.onProgress?.({ tried: priority.length + n, total }),
    });
    tried = total;
  }

  // Sıra: ÖNCE tekilleştir (sunucu başına en iyi adres), SONRA sırala. Tersi,
  // aynı sunucunun iki adresini iki ayrı satır gibi sıralar.
  const groups = groupByInstallation(found);
  return {
    candidates: rankCandidates(dedupeCandidates(found)),
    groups,
    scan: { ran: scanRan, tried, skippedReason },
    network: { address, subnet },
  };
}
