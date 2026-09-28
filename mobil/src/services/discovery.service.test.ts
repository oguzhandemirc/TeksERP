// =============================================================================
// Bekçi: keşif orkestrasyonu — ÖNCELİK, sonra süpürme
// =============================================================================
// NEDEN: sıra bir optimizasyon değil, özelliğin sahada kullanılabilir olmasının
// şartı. Düz süpürme tablet Wi-Fi'sinde 253 isteği saniyelere yayar; fabrikanın
// sunucusu `.250`de ve öncelik listesi onu İLK turda bulur.
//
// Üç kural burada kilitli ve üçü de sessizce kaybolabilir:
//  1) Öncelikli liste bulursa TAM SÜPÜRME KOŞMAZ (pil + ağ bütçesi).
//  2) Sabitlenmiş kimlik eşleşince tur ERKEN biter — kalan adresler denenmez.
//  3) `fullSweep` KAPALIYKEN süpürme asla koşmaz (açılış yolu ekranı bekletmesin).
//
// `fetch` mock'lanır: gerçek ağ yok, hangi adreslerin DENENDİĞİ ölçülür.
// =============================================================================
import NetInfo from '@react-native-community/netinfo';
import { discoverServers } from './discovery.service';

// Gömülü varsayılan ERP adresi: testfabrika tabletinin kanal adresi (Tailscale).
jest.mock('../constants/api', () => ({ API_URL: 'http://100.70.47.46:4000/api' }));

const IDENTITY = {
  product: 'TeksERP',
  discoveryVersion: 1,
  installationId: 'iid-fabrika',
  serverName: 'SAHINSRV',
  companyName: 'Adnan Şahin Tekstil',
  version: '2.9.0',
};

/**
 * Yalnız `aliveHosts` içindeki adresler cevap verir; kalanı ağ hatası.
 *
 * Anahtar iki biçimde yazılabilir: `host` (YALNIZ varsayılan port) ya da
 * `host:port`. Host-only anahtarın varsayılan porta bağlı olması bilinçli —
 * "her portta cevap veren" bir sunucu, port kademelerini ölçen sondaları
 * sessizce vakuma düşürürdü.
 */
function mockNetwork(aliveHosts: Record<string, typeof IDENTITY | 'health-only'>) {
  const tried: string[] = [];
  /** `host:port` — port kademelerini ölçen sondalar bunu okur. */
  const triedFull: string[] = [];
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url);
    const m = /^https?:\/\/([^:/]+):(\d+)/.exec(u);
    const host = m?.[1] ?? '';
    const port = Number(m?.[2] ?? 0);
    if (u.includes('/api/discovery/identity')) {
      tried.push(host);
      triedFull.push(`${host}:${port}`);
    }
    const entry = aliveHosts[`${host}:${port}`] ?? (port === 4000 ? aliveHosts[host] : undefined);
    if (!entry) throw new Error('Network request failed');
    if (u.includes('/api/discovery/identity')) {
      if (entry === 'health-only') return { status: 404, text: async () => 'yok' } as never;
      return { status: 200, text: async () => JSON.stringify(entry) } as never;
    }
    if (u.endsWith('/health')) {
      return { status: 200, text: async () => JSON.stringify({ status: 'UP' }) } as never;
    }
    throw new Error('beklenmeyen istek');
  }) as never;
  return { tried, triedFull };
}

function mockOwnIp(ipAddress: string | null, subnet = '255.255.255.0') {
  (NetInfo.fetch as jest.Mock).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
    details: { ipAddress, subnet },
  });
}

describe('discoverServers — öncelik, sonra süpürme', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnIp('192.168.1.42');
  });

  it('⭐ 1. KURAL: öncelikli listede bulunca TAM SÜPÜRME koşmaz', async () => {
    const { tried } = mockNetwork({ '192.168.1.250': IDENTITY });
    const res = await discoverServers({ fullSweep: true });

    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.host).toBe('192.168.1.250');
    expect(res.scan.ran).toBe(false);
    expect(res.scan.skippedReason).toBeTruthy();
    // Öncelik listesi kısa — 253 adres DENENMEDİ.
    expect(tried.length).toBeLessThan(20);
  });

  it('⭐ 2. KURAL: sabitlenmiş kimlik eşleşince tur ERKEN biter', async () => {
    const { tried } = mockNetwork({
      '192.168.1.250': IDENTITY,
      '192.168.1.1': IDENTITY,
      '192.168.1.10': IDENTITY,
    });
    const res = await discoverServers({
      pinnedInstallationId: 'iid-fabrika',
      fullSweep: true,
    });
    expect(res.candidates[0]?.matchesPinned).toBe('match');
    expect(res.scan.ran).toBe(false);
    // Erken çıkış: eşzamanlılık nedeniyle birkaç istek uçuşta olabilir ama
    // öncelik listesinin TAMAMI denenmemeli.
    expect(tried.length).toBeLessThan(20);
  });

  it('⭐ 3. KURAL: fullSweep KAPALIYKEN süpürme asla koşmaz', async () => {
    const { tried } = mockNetwork({}); // hiçbir sunucu yok
    const res = await discoverServers({ fullSweep: false });
    expect(res.candidates).toHaveLength(0);
    expect(res.scan.ran).toBe(false);
    expect(res.scan.skippedReason).toContain('hızlı arama');
    expect(tried.length).toBeLessThan(20); // süpürme yok
  });

  it('⭐ 1b. KURAL: bulunan aday UYUŞMUYORSA süpürme YİNE koşar', async () => {
    // Yanlış sunucuyu bulup durmak, kullanıcıya yalnız yanlış seçeneği
    // göstermek demektir — doğrusu ağda başka yerde olabilir.
    const { tried } = mockNetwork({
      '192.168.1.250': { ...IDENTITY, installationId: 'baska-kurulum' },
      '192.168.1.77': IDENTITY,
    });
    const res = await discoverServers({
      pinnedInstallationId: 'iid-fabrika',
      fullSweep: true,
    });
    expect(res.scan.ran).toBe(true);
    // Süpürme gerçekten koştu (öncelik listesi ~10 adres, bunun çok üstü)...
    expect(tried.length).toBeGreaterThan(30);
    // ...ama doğru sunucuyu bulunca ERKEN ÇIKTI — tüm /24 denenmedi.
    expect(tried.length).toBeLessThan(253);
    // Doğru sunucu bulundu VE başa geldi.
    expect(res.candidates[0]?.matchesPinned).toBe('match');
    expect(res.candidates[0]?.host).toBe('192.168.1.77');
  });

  it('öncelikte bulunamazsa süpürme KOŞAR ve sunucuyu bulur', async () => {
    // `.77` öncelik listesinde YOK → yalnız süpürme bulabilir.
    const { tried } = mockNetwork({ '192.168.1.77': IDENTITY });
    const res = await discoverServers({ fullSweep: true });
    expect(res.scan.ran).toBe(true);
    expect(res.candidates.map((c) => c.host)).toContain('192.168.1.77');
    expect(tried.length).toBeGreaterThan(100); // gerçekten süpürdü
  });

  it('kimliksiz (eski) sunucu GEÇERLİ aday — /health ile teyit edilir', async () => {
    mockNetwork({ '192.168.1.250': 'health-only' });
    const res = await discoverServers({ fullSweep: false });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.identity).toBeNull();
    // Kimliksizlik UYUŞMAZLIK DEĞİLDİR.
    expect(res.candidates[0]?.matchesPinned).toBe('unknown');
  });

  it('cihazın IP\'si okunamazsa süpürme atlanır (çökmez)', async () => {
    mockOwnIp(null);
    mockNetwork({});
    const res = await discoverServers({ fullSweep: true });
    expect(res.candidates).toHaveLength(0);
    expect(res.scan.skippedReason).toContain('ağ adresi okunamadı');
  });

  it('körlük zemini: mock ağ gerçekten sorgulanıyor', async () => {
    const { tried } = mockNetwork({ '192.168.1.250': IDENTITY });
    await discoverServers({ fullSweep: false });
    expect(tried.length).toBeGreaterThan(0);
    expect(tried).toContain('192.168.1.250');
  });
});

// =============================================================================
// Bekçi: KADEMELİ PORT TARAMASI — "bulamazsa farklı portları da arar"
// =============================================================================
// Dört kural, dördü de sessizce bozulabilir:
//  4) Varsayılan portta bulunca yedek portlara HİÇ bakılmaz — yoksa her arama
//     port sayısıyla ÇARPILIR ve keşif kullanılamaz hale gelir.
//  5) Hiç bulunamayınca yedekler denenir ve aday KENDİ PORTUYLA döner
//     (`baseUrl` yanlış porta işaret ederse "buldum" demek işe yaramaz).
//  6) `extraPorts` kapalıyken davranış BUGÜNKÜYLE birebir (arka plan turları).
//  7) FAIL-OPEN YASAK: yedek portta `/health` UP diyen yabancı servis aday DEĞİL.
// =============================================================================
describe('discoverServers — yedek portlar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnIp('192.168.1.42');
  });

  it('⭐ 4. KURAL: varsayılan portta bulununca YEDEK PORT DENENMEZ (maliyet sıfır)', async () => {
    const { triedFull } = mockNetwork({ '192.168.1.250': IDENTITY });
    const res = await discoverServers({ fullSweep: true, extraPorts: true });

    expect(res.candidates).toHaveLength(1);
    expect(res.scan.ports).toEqual([4000]);
    // Tek bir 5000/3000/8080 isteği bile atılmamalı.
    expect(triedFull.every((t) => t.endsWith(':4000'))).toBe(true);
  });

  it('⭐ 5. KURAL: 5000de duran sunucu BULUNUR ve aday PORTU taşır', async () => {
    const { triedFull } = mockNetwork({ '192.168.1.250:5000': IDENTITY });
    const res = await discoverServers({ fullSweep: true, extraPorts: true });

    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.port).toBe(5000);
    expect(res.candidates[0]?.host).toBe('192.168.1.250');
    // ⚠️ `baseUrl` PORTU TAŞIMALI — panel/tablet bağlantıyı bundan kurar.
    expect(res.candidates[0]?.baseUrl).toBe('http://192.168.1.250:5000');
    expect(res.scan.ports).toEqual([4000, 5000]);
    // Bulan portta DURULDU: 3000/8080 hiç denenmedi.
    expect(triedFull.some((t) => t.endsWith(':3000'))).toBe(false);
    expect(triedFull.some((t) => t.endsWith(':8080'))).toBe(false);
  });

  it('hiçbir portta yoksa TÜM yedekler sırayla denenir', async () => {
    const { triedFull } = mockNetwork({});
    const res = await discoverServers({ fullSweep: true, extraPorts: true });
    expect(res.candidates).toHaveLength(0);
    expect(res.scan.ports).toEqual([4000, 5000, 3000, 8080]);
    for (const p of [5000, 3000, 8080]) {
      expect(triedFull.some((t) => t.endsWith(`:${p}`))).toBe(true);
    }
  });

  it('tablet bütçesi: TAM SÜPÜRME yalnız İLK yedek portta koşar', async () => {
    // 3000/8080 yalnız öncelik listesini görür — her tam süpürme turu tablette
    // ~10 sn ve "alışılmadık IP + alışılmadık port" bileşik bir olasılıktır.
    const { triedFull } = mockNetwork({});
    await discoverServers({ fullSweep: true, extraPorts: true });
    const say = (p: number): number => triedFull.filter((t) => t.endsWith(`:${p}`)).length;
    expect(say(4000)).toBeGreaterThan(200); // körlük zemini: süpürme gerçekten koştu
    expect(say(5000)).toBeGreaterThan(200);
    expect(say(3000)).toBeLessThan(20);
    expect(say(8080)).toBeLessThan(20);
    expect(say(8080)).toBeGreaterThan(0); // ...ama HİÇ denenmemiş de değil
  });

  it('⭐ 6. KURAL: extraPorts KAPALIYKEN yedek port HİÇ denenmez', async () => {
    // Arka plan turu (`serverReachability.trySelfHeal`) bu yoldan geçer.
    const { triedFull } = mockNetwork({ '192.168.1.250:5000': IDENTITY });
    const res = await discoverServers({ fullSweep: true });
    expect(res.candidates).toHaveLength(0);
    expect(res.scan.ports).toEqual([4000]);
    expect(triedFull.every((t) => t.endsWith(':4000'))).toBe(true);
  });

  it('⭐ 7. KURAL: yedek portta TeksERP OLMAYAN servis aday SAYILMAZ', async () => {
    // 5000'de `/health` → {"status":"UP"} diyen yabancı bir servis (Spring Boot
    // Actuator birebir bunu basar). Kimlik ucu yok → aday değil.
    mockNetwork({ '192.168.1.250:5000': 'health-only' });
    const res = await discoverServers({ fullSweep: true, extraPorts: true });
    expect(res.candidates).toHaveLength(0);
  });

  it('körlük zemini: AYNI servis VARSAYILAN portta aday SAYILIR (eski backend)', async () => {
    // 7. kuralın vakumen geçmediğini kanıtlar: kimliksiz sunucu 4000'de meşru.
    mockNetwork({ '192.168.1.250': 'health-only' });
    const res = await discoverServers({ fullSweep: true, extraPorts: true });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.identity).toBeNull();
    expect(res.candidates[0]?.port).toBe(4000);
  });
});

// =============================================================================
// Bekçi: AÇIK ARAMA ("Ağda Ara") ağdaki HER sunucuyu gösterir + varsayılan adres
// =============================================================================
// Saha vakası: testfabrika tableti (Wi-Fi 192.168.1.100) SAHINSRV'ye elle bağlı;
// aynı Wi-Fi'deki test sunucusu (192.168.1.109, Tailscale 100.70.47.46 — tabletin
// kendi gömülü varsayılanı) "Ağda Ara"da görünmüyordu: öncelik listesi SAHINSRV'yi
// bulunca süpürme koşmuyor, gömülü varsayılan da hiç denenmiyordu.
// =============================================================================
const SAHINSRV = { ...IDENTITY, installationId: 'iid-fabrika', serverName: 'SAHINSRV' };
const THINKPAD = {
  ...IDENTITY,
  installationId: 'iid-test',
  serverName: 'thinkpad-1',
  companyName: 'Test Fabrika',
  version: '2.11.0',
};

describe('discoverServers — açık arama hepsini listeler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwnIp('192.168.1.100');
  });

  it('⭐ öncelikte bulunsa da AÇIK arama süpürür ve ikinci sunucuyu listeler', async () => {
    const { tried } = mockNetwork({ '100.107.103.79': SAHINSRV, '192.168.1.109': THINKPAD });
    const res = await discoverServers({
      pinnedInstallationId: 'iid-fabrika',
      preferredUrls: ['http://100.107.103.79:4000/api'],
      fullSweep: true,
      mode: 'explicit',
    });
    expect(res.scan.ran).toBe(true);
    expect(res.scan.skippedReason).toBeNull();
    // Sabitlenmiş eşleşme turu bitirmedi: /24'ün tamamı denendi (bütçe = 253 − kendisi).
    expect(tried.length).toBeGreaterThan(240);
    expect(tried.length).toBeLessThanOrEqual(256);
    const names = res.candidates.map((c) => c.identity?.serverName).sort();
    expect(names).toEqual(['SAHINSRV', 'thinkpad-1']);
    // Sabitlenmiş uyuşmazlık işaretlemesi aynen: ikinci sunucu "farklı kurulum".
    expect(res.candidates.find((c) => c.host === '192.168.1.109')?.matchesPinned).toBe('mismatch');
    expect(res.candidates[0]?.matchesPinned).toBe('match');
  });

  it('⭐ hızlı keşif erken çıkışı DEĞİŞMEDİ (aynı ağ, kip verilmedi)', async () => {
    const { tried } = mockNetwork({ '100.107.103.79': SAHINSRV, '192.168.1.109': THINKPAD });
    const res = await discoverServers({
      pinnedInstallationId: 'iid-fabrika',
      preferredUrls: ['http://100.107.103.79:4000/api'],
      fullSweep: true,
    });
    expect(res.scan.ran).toBe(false);
    expect(res.scan.skippedReason).toBeTruthy();
    expect(tried.length).toBeLessThan(20);
    expect(res.candidates.map((c) => c.identity?.serverName)).toEqual(['SAHINSRV']);
  });

  it('⭐ gömülü VARSAYILAN adres öncelik listesinde — süpürmesiz de bulunur', async () => {
    // Test sunucusu yalnız Tailscale'den erişilebilir (LAN süpürmesi onu göremez).
    const { tried } = mockNetwork({ '100.107.103.79': SAHINSRV, '100.70.47.46': THINKPAD });
    const res = await discoverServers({
      preferredUrls: ['http://100.107.103.79:4000/api'],
      fullSweep: false,
    });
    expect(tried).toContain('100.70.47.46');
    expect(res.candidates.map((c) => c.identity?.serverName).sort()).toEqual([
      'SAHINSRV',
      'thinkpad-1',
    ]);
  });

  it('aynı sunucu Wi-Fi + Tailscale adresinden bulununca TEK satır kalır', async () => {
    mockNetwork({ '100.107.103.79': SAHINSRV, '100.70.47.46': THINKPAD, '192.168.1.109': THINKPAD });
    const res = await discoverServers({
      pinnedInstallationId: 'iid-fabrika',
      preferredUrls: ['http://100.107.103.79:4000/api'],
      fullSweep: true,
      mode: 'explicit',
    });
    expect(res.candidates).toHaveLength(2);
    const test = res.groups.find((g) => g.installationId === 'iid-test');
    expect(test?.addresses.map((a) => a.host).sort()).toEqual(['100.70.47.46', '192.168.1.109']);
    // LAN adresi Tailscale'den önce tercih edilir.
    expect(test?.primary.host).toBe('192.168.1.109');
  });
});
