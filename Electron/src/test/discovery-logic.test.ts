// =============================================================================
// Bekçi: sunucu keşfi — saf mantık sınırları
// =============================================================================
// NEDEN: bu dosyadaki üç karar sahada geri dönüşü zor sonuçlar üretir ve hiçbiri
// çalışma anında hata vermez:
//
//  1) TARAMA GENİŞLİĞİ. Bir `/16` ağda naif hesap 65534 bağlantı denemesi üretir.
//     15 masaüstü aynı anda açılırsa fabrika switch'i boğulur ve IT bizi kara
//     listeye alır. Sınır kaybolursa kimse fark etmez — ta ki sahada olana kadar.
//
//  2) `unknown` KİMLİK "farklı sunucu" SAYILMAMALI. Üç meşru sebebi var (henüz
//     sabitlenmemiş cihaz · kimlik ucu olmayan eski backend · boot'ta DB'si hazır
//     olmayan sunucu). Uyarıyı yanlış-pozitif üretir hale getirmek, operatöre onu
//     ezberden geçmeyi öğretir — yani korumayı gerçek uyuşmazlıkta da kaybederiz.
//
//  3) TEKİLLEŞTİRME kimliğe bakmalı: aynı sunucu mDNS'ten ve taramadan iki kez
//     gelirse kullanıcıya iki aday göstermek "hangisi benimki" sorusunu doğurur.
//
// Körlük zemini: mutlu yol boş dönmemeli — aksi halde "boş dizi döner"
// iddialarının hepsi vakumen geçerdi.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  scanTargetsFor,
  prefixFromNetmask,
  compareIdentity,
  shouldWarnOnMismatch,
  parseIdentityPayload,
  identityFromTxt,
  addressPreferenceRank,
  ADDRESS_RANK,
  bySourceRank,
  dedupeCandidates,
  groupByInstallation,
  rankCandidates,
  SCAN_MAX_HOSTS,
  DISCOVERY_PORTS,
  DISCOVERY_DEFAULT_PORT,
  fallbackDiscoveryPorts,
  identityRequiredForPort,
  runStagedPortScan,
  type DiscoveredServer,
} from "@shared/discovery";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function candidate(p: Partial<DiscoveredServer>): DiscoveredServer {
  return {
    baseUrl: "http://192.168.1.50:4000",
    host: "192.168.1.50",
    port: 4000,
    via: "scan",
    identity: null,
    rttMs: 10,
    matchesPinned: "unknown",
    ...p,
  };
}

describe("scanTargetsFor — tarama genişliği", () => {
  it("körlük zemini: mutlu yol boş DÖNMEZ", () => {
    const t = scanTargetsFor([{ address: "192.168.1.23", netmask: "255.255.255.0" }]);
    expect(t.length).toBeGreaterThan(200);
  });

  it("/24 → tam 253 hedef (.0, .255 ve KENDİSİ hariç)", () => {
    const t = scanTargetsFor([{ address: "192.168.1.23", netmask: "255.255.255.0" }]);
    // Sihirli sayı bilinçli: algoritma kayarsa sessizce değil gürültülü patlasın.
    expect(t).toHaveLength(253);
    expect(t).not.toContain("192.168.1.0");
    expect(t).not.toContain("192.168.1.255");
    expect(t).not.toContain("192.168.1.23");
    expect(t).toContain("192.168.1.1");
    expect(t).toContain("192.168.1.254");
  });

  it("/16 gibi geniş ağda TAM TARAMA YAPILMAZ — kendi /24 dilimine daralır", () => {
    const t = scanTargetsFor([{ address: "10.0.5.7", netmask: "255.255.0.0" }]);
    expect(t.length).toBeLessThanOrEqual(SCAN_MAX_HOSTS);
    // NEGATİF SINAMA: naif tam sayımın MUTLAKA döndüreceği bir adres.
    // Bu satır geçiyorsa daraltma gerçekten uygulanmış demektir.
    expect(t).not.toContain("10.0.6.1");
    expect(t).toContain("10.0.5.1");
  });

  it("link-local (169.254.x) HİÇ taranmaz", () => {
    expect(scanTargetsFor([{ address: "169.254.10.5", netmask: "255.255.0.0" }])).toEqual([]);
  });

  it("bozuk maske /24 varsayar (tarama tamamen düşmez)", () => {
    const t = scanTargetsFor([{ address: "192.168.9.4", netmask: "saçma" }]);
    expect(t).toHaveLength(253);
  });

  it("maxHosts tavanı aşılmaz", () => {
    const t = scanTargetsFor(
      [
        { address: "192.168.1.5", netmask: "255.255.255.0" },
        { address: "192.168.2.5", netmask: "255.255.255.0" },
      ],
      { maxHosts: 300 },
    );
    expect(t).toHaveLength(300);
  });

  it("iki arayüzde aynı adres iki kez gelmez", () => {
    const t = scanTargetsFor([
      { address: "192.168.1.5", netmask: "255.255.255.0" },
      { address: "192.168.1.9", netmask: "255.255.255.0" },
    ]);
    expect(new Set(t).size).toBe(t.length);
  });

  it("prefixFromNetmask bitişik olmayan maskeyi reddeder", () => {
    expect(prefixFromNetmask("255.255.255.0")).toBe(24);
    expect(prefixFromNetmask("255.255.0.0")).toBe(16);
    expect(prefixFromNetmask("255.0.255.0")).toBeNull();
  });
});

describe("compareIdentity — 'unknown' asla suçlamaz", () => {
  it("eşleşme / uyuşmazlık", () => {
    expect(compareIdentity("abc", "abc")).toBe("match");
    expect(compareIdentity("abc", "xyz")).toBe("mismatch");
  });

  it("büyük/küçük harf ve boşluk anlamlı değil (uuid hex)", () => {
    expect(compareIdentity("ABC-def", " abc-DEF ")).toBe("match");
  });

  it("taraflardan biri yoksa → unknown", () => {
    expect(compareIdentity(null, "abc")).toBe("unknown");
    expect(compareIdentity("abc", null)).toBe("unknown");
    expect(compareIdentity("", "")).toBe("unknown");
  });

  it("⭐ ASIL İDDİA: yalnız 'mismatch' uyarı doğurur", () => {
    expect(shouldWarnOnMismatch("mismatch")).toBe(true);
    // Bu ikisi false OLMAK ZORUNDA — dosya başlığındaki 2. maddeye bak.
    expect(shouldWarnOnMismatch("unknown")).toBe(false);
    expect(shouldWarnOnMismatch("match")).toBe(false);
  });
});

describe("parseIdentityPayload", () => {
  it("geçerli yükü çözer", () => {
    const id = parseIdentityPayload({
      product: "TeksERP",
      discoveryVersion: 1,
      installationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      serverName: "SAHINSRV",
      companyName: "Adnan Şahin Tekstil",
      version: "2.9.0",
    });
    expect(id?.installationId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(id?.companyName).toBe("Adnan Şahin Tekstil");
  });

  it("başka bir ürünün yanıtını REDDEDER (4000'de başka servis olabilir)", () => {
    expect(parseIdentityPayload({ product: "BaskaSistem", version: "1" })).toBeNull();
    expect(parseIdentityPayload(null)).toBeNull();
    expect(parseIdentityPayload("metin")).toBeNull();
    expect(parseIdentityPayload([])).toBeNull();
  });

  it("boş installationId null'a iner (kimlik YOK ile tek biçim)", () => {
    const id = parseIdentityPayload({ product: "TeksERP", installationId: "   " });
    expect(id?.installationId).toBeNull();
  });
});

describe("identityFromTxt", () => {
  it("metin ve Uint8Array değerleri okur", () => {
    const out = identityFromTxt({
      iid: "abc",
      co: new TextEncoder().encode("Adnan Şahin Tekstil"),
      v: "1",
    });
    expect(out.installationId).toBe("abc");
    expect(out.companyName).toBe("Adnan Şahin Tekstil");
    expect(out.discoveryVersion).toBe(1);
  });

  it("eksik/boş anahtarlarda alan HİÇ doğmaz", () => {
    const out = identityFromTxt({ iid: "" });
    expect("installationId" in out).toBe(false);
    expect(identityFromTxt(null)).toEqual({});
  });
});

describe("dedupe + rank", () => {
  it("aynı kimlik iki kaynaktan gelirse TEK aday kalır, mDNS kazanır", () => {
    const out = dedupeCandidates(
      [
        candidate({ via: "scan", identity: { installationId: "iid-1" } as never }),
        candidate({ via: "mdns", identity: { installationId: "iid-1" } as never }),
      ],
      bySourceRank,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.via).toBe("mdns");
  });

  it("kimliksiz adaylar adrese göre tekilleşir", () => {
    const out = dedupeCandidates(
      [
        candidate({ host: "192.168.1.5", via: "scan" }),
        candidate({ host: "192.168.1.5", via: "mdns" }),
        candidate({ host: "192.168.1.6", via: "scan" }),
      ],
      bySourceRank,
    );
    expect(out).toHaveLength(2);
  });

  it("sabitlenmiş kimlikle eşleşen aday HER ZAMAN başa gelir", () => {
    const out = rankCandidates([
      candidate({ host: "a", via: "mdns", rttMs: 1, matchesPinned: "unknown" }),
      candidate({ host: "b", via: "scan", rttMs: 900, matchesPinned: "match" }),
    ]);
    expect(out[0]?.host).toBe("b");
  });

  it("eşitlikte kaynak güvenilirliği, sonra gecikme", () => {
    const out = rankCandidates([
      candidate({ host: "slow-mdns", via: "mdns", rttMs: 500 }),
      candidate({ host: "fast-scan", via: "scan", rttMs: 5 }),
      candidate({ host: "fast-mdns", via: "mdns", rttMs: 5 }),
    ]);
    expect(out.map((c) => c.host)).toEqual(["fast-mdns", "slow-mdns", "fast-scan"]);
  });
});


// =============================================================================
// ÖLÇÜLEN VAKA — `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md` §4
// Tek sunucu, 7 IPv4, tek dinleyen süreç. Tablet iki satır görüyor, panel
// üçüncü (host-only) adresi seçiyordu.
// =============================================================================
const IID = "94c955fe-f354-401b-83e0-6dd2ec12283c";
const ident = (id: string | null) =>
  ({
    product: "TeksERP",
    discoveryVersion: 1,
    installationId: id,
    serverName: "ThinkPad",
    companyName: "Adnan Şahin",
    version: "2.9.0",
  }) as DiscoveredServer["identity"];

describe("adres tercihi — sıralar, ELEMEZ", () => {
  it("körlük zemini: gerçek LAN adresi en iyi sırada", () => {
    expect(addressPreferenceRank("192.168.1.102")).toBe(ADDRESS_RANK.LAN);
    expect(addressPreferenceRank("10.0.5.7")).toBe(ADDRESS_RANK.LAN);
  });

  it("⭐ Hyper-V/Docker (172.16/12) gerçek LAN'ın ARDINDA", () => {
    expect(addressPreferenceRank("172.20.144.1")).toBeGreaterThan(
      addressPreferenceRank("192.168.1.102"),
    );
    expect(addressPreferenceRank("172.17.0.1")).toBe(ADDRESS_RANK.VIRTUAL);
  });

  it("Tailscale/CGNAT · loopback · link-local giderek geride", () => {
    expect(addressPreferenceRank("100.70.47.46")).toBe(ADDRESS_RANK.OVERLAY);
    expect(addressPreferenceRank("127.0.0.1")).toBe(ADDRESS_RANK.LOOPBACK);
    expect(addressPreferenceRank("localhost")).toBe(ADDRESS_RANK.LOOPBACK);
    expect(addressPreferenceRank("169.254.10.3")).toBe(ADDRESS_RANK.LINK_LOCAL);
  });

  it("ad (mDNS/DNS) ve sınıflandırılamayan adres ORTADA — dışlanmaz", () => {
    expect(addressPreferenceRank("erp.local")).toBe(ADDRESS_RANK.OTHER);
    expect(addressPreferenceRank("")).toBe(ADDRESS_RANK.OTHER);
  });
});

describe("groupByInstallation — bir satır = bir SUNUCU", () => {
  const dortAdres = [
    candidate({ host: "172.20.144.1", via: "stored", rttMs: 1, identity: ident(IID) }),
    candidate({ host: "192.168.1.102", via: "scan", rttMs: 30, identity: ident(IID) }),
    candidate({ host: "192.168.137.1", via: "scan", rttMs: 40, identity: ident(IID) }),
    candidate({ host: "100.70.47.46", via: "scan", rttMs: 60, identity: ident(IID) }),
  ];

  it("⭐ dört adres TEK gruba iner ve HİÇBİRİ kaybolmaz", () => {
    const g = groupByInstallation(dortAdres, bySourceRank);
    expect(g).toHaveLength(1);
    expect(g[0]?.addresses).toHaveLength(4);
    expect(g[0]?.installationId).toBe(IID);
  });

  it("⭐ ASIL İDDİA: host-only adres 'kayıtlı' + EN HIZLI olsa bile seçilmez", () => {
    const g = groupByInstallation(dortAdres, bySourceRank);
    expect(g[0]?.primary.host).toBe("192.168.1.102");
    // ...ama listede DURUR — sıralama yapıldı, eleme değil.
    expect(g[0]?.addresses.map((a) => a.host)).toContain("172.20.144.1");
  });

  it("eşit tercihte kaynak güvenilirliği, sonra gecikme, sonra ad (determinizm)", () => {
    const g = groupByInstallation(
      [
        candidate({ host: "192.168.1.9", via: "scan", rttMs: 5, identity: ident(IID) }),
        candidate({ host: "192.168.1.8", via: "mdns", rttMs: 90, identity: ident(IID) }),
      ],
      bySourceRank,
    );
    expect(g[0]?.primary.host).toBe("192.168.1.8"); // mDNS kazanır
  });

  it("⭐ KİMLİKSİZ sunucuda eski davranış korunur: adres bazlı, birleştirme YOK", () => {
    const g = groupByInstallation(
      [
        candidate({ host: "192.168.1.10", identity: null }),
        candidate({ host: "192.168.1.11", identity: null }),
      ],
      bySourceRank,
    );
    expect(g).toHaveLength(2); // iki kimliksiz aday "aynı sunucu" SAYILMAZ
    expect(g.every((x) => x.installationId === null)).toBe(true);
  });

  it("farklı kurulumlar birleşmez (ikinci fabrika / demo kurulumu)", () => {
    const g = groupByInstallation(
      [
        candidate({ host: "192.168.1.5", identity: ident(IID) }),
        candidate({ host: "192.168.1.6", identity: ident("baska-kurulum") }),
      ],
      bySourceRank,
    );
    expect(g).toHaveLength(2);
  });

  it("körlük zemini: boş giriş boş çıkar, tek aday tek grup", () => {
    expect(groupByInstallation([], bySourceRank)).toHaveLength(0);
    expect(groupByInstallation([candidate({})], bySourceRank)).toHaveLength(1);
  });
});

// =============================================================================
// KADEMELİ PORT TARAMASI — "bulamazsa farklı portları da arar"
// =============================================================================
// NEDEN: bu kademenin İKİ ayrı arıza biçimi var ve ikisi de sessiz.
//
//  A) MALİYET. Yedek portlar koşulsuz taranırsa tarama süresi port sayısıyla
//     ÇARPILIR (1022 host × 4 port = 4088 bağlantı denemesi) ve keşif her
//     açılışta saniyeler yer. Kural: sunucu bulunduysa genişleme HİÇ koşmaz.
//
//  B) FAIL-OPEN. Yedek portta `/health` yoluna izin verilirse 8080'de duran
//     rastgele bir web sunucusu operatöre "sunucu bulundu" diye gösterilir.
//     `{"status":"UP"}` TeksERP'e özgü DEĞİLDİR.
//
// Ayrıca `DISCOVERY_DEFAULT_PORT` listenin İLK elemanıdır — iki ayrı gerçek
// olursa mDNS çalışmaya devam eder (portu ilandan alır) ama tarama yanlış
// porta bakar: "bazen buluyor, bazen bulmuyor".
// =============================================================================
describe("port listesi — tek kaynak", () => {
  it("⭐ varsayılan port listenin İLK elemanı ve 4000", () => {
    expect(DISCOVERY_PORTS[0]).toBe(DISCOVERY_DEFAULT_PORT);
    expect(DISCOVERY_DEFAULT_PORT).toBe(4000);
  });

  it("5000 listede (kullanıcı isteği, 2026-09-04)", () => {
    expect([...DISCOVERY_PORTS]).toContain(5000);
  });

  it("liste KISA — her ek port en kötü durumu doğrusal büyütür", () => {
    expect(DISCOVERY_PORTS.length).toBeLessThanOrEqual(4);
    expect(new Set(DISCOVERY_PORTS).size).toBe(DISCOVERY_PORTS.length);
  });

  it("yedekler = liste eksi varsayılan, SIRA korunur", () => {
    expect(fallbackDiscoveryPorts()).toEqual([5000, 3000, 8080]);
    expect(fallbackDiscoveryPorts()).not.toContain(DISCOVERY_DEFAULT_PORT);
  });

  it("⭐ FAIL-OPEN SINIRI: kimlik yalnız YEDEK portlarda zorunlu", () => {
    // Varsayılan portta gevşeklik BİLİNÇLİ: kimlik ucu olmayan eski backend
    // meşru adaydır (bkz. probe.ts). Yedek portta öyle bir vaka yok.
    expect(identityRequiredForPort(DISCOVERY_DEFAULT_PORT)).toBe(false);
    for (const p of fallbackDiscoveryPorts()) {
      expect(identityRequiredForPort(p)).toBe(true);
    }
  });
});

describe("runStagedPortScan — önce varsayılan, bulamazsa yedekler", () => {
  const hit = (port: number): DiscoveredServer => candidate({ port, baseUrl: `http://h:${port}` });

  it("⭐ 1. KURAL: varsayılan portta bulunca GENİŞ TARAMA KOŞMAZ (maliyet sıfır)", async () => {
    const seen: number[] = [];
    const out = await runStagedPortScan<DiscoveredServer>(async (port) => {
      seen.push(port);
      return [hit(port)];
    });
    expect(seen).toEqual([DISCOVERY_DEFAULT_PORT]);
    expect(out.ports).toEqual([DISCOVERY_DEFAULT_PORT]);
  });

  it("⭐ 1b. başka bir ayak (mDNS/kayıtlı adres) bulduysa da genişlemez", async () => {
    const seen: number[] = [];
    const out = await runStagedPortScan<DiscoveredServer>(
      async (port) => {
        seen.push(port);
        return [];
      },
      { hasCandidate: () => true },
    );
    expect(seen).toEqual([DISCOVERY_DEFAULT_PORT]);
    expect(out.results).toHaveLength(0);
  });

  it("⭐ 2. KURAL: hiç bulunamayınca TÜM yedek portlar SIRAYLA denenir", async () => {
    const seen: number[] = [];
    await runStagedPortScan<DiscoveredServer>(async (port) => {
      seen.push(port);
      return [];
    });
    expect(seen).toEqual([...DISCOVERY_PORTS]);
  });

  it("⭐ 3. KURAL: yedek portta bulunan aday DOĞRU PORTLA döner ve orada DURULUR", async () => {
    const seen: number[] = [];
    const out = await runStagedPortScan<DiscoveredServer>(async (port) => {
      seen.push(port);
      return port === 5000 ? [hit(5000)] : [];
    });
    expect(seen).toEqual([4000, 5000]); // 3000/8080 hiç denenmedi
    expect(out.ports).toEqual([4000, 5000]);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.port).toBe(5000);
    expect(out.results[0]?.baseUrl).toBe("http://h:5000");
  });

  it("iptal edilirse kademe İLERLEMEZ", async () => {
    const seen: number[] = [];
    let calls = 0;
    const out = await runStagedPortScan<DiscoveredServer>(
      async (port) => {
        seen.push(port);
        calls++;
        return [];
      },
      { aborted: () => calls >= 1 },
    );
    expect(seen).toEqual([DISCOVERY_DEFAULT_PORT]);
    expect(out.ports).toEqual([DISCOVERY_DEFAULT_PORT]);
  });

  it("körlük zemini: yedek portlar gerçekten VAR (döngü vakumen geçmiyor)", () => {
    expect(fallbackDiscoveryPorts().length).toBeGreaterThan(0);
  });
});

// =============================================================================
// İKİZ KİLİDİ — "iki istemci aynı hatayı ayrı ayrı yapar" sınıfı
// =============================================================================
// Mobil `Electron/shared/discovery.ts`i IMPORT EDEMEZ (ayrı proje). Tekilleştirme
// ve adres tercihi kuralı iki dosyada da yaşıyor; ayrışırsa arıza SESSİZ olur:
// tablet tek satır gösterirken panel üç satır gösterir ve kimse "hangisi doğru"
// diye sormaz. Bu bekçi iki metni doğrudan kıyaslar. İkizi mobil tarafında da
// var (`mobil/src/lib/discovery.contract.test.ts`) — her koşucu kendi tarafından
// bakar, tek bir CI adımına bağlı kalmayız.
const REPO = resolve(__dirname, "../../..");
const MOBILE_LIB = resolve(REPO, "mobil/src/lib/discovery.ts");
const ELECTRON_LIB = resolve(REPO, "Electron/shared/discovery.ts");

/** `>>> KEŞİF-İKİZ BAŞLANGIÇ` ile `<<< KEŞİF-İKİZ SON` arasını çıkarır. */
function twinBlock(file: string): string | null {
  const src = readFileSync(file, "utf8");
  const a = src.indexOf(">>> KEŞİF-İKİZ BAŞLANGIÇ");
  const b = src.indexOf("<<< KEŞİF-İKİZ SON");
  if (a < 0 || b < 0 || b < a) return null;
  return src
    .slice(a, b)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

describe("KEŞİF-İKİZ bloğu — mobil ile Electron BİREBİR", () => {
  it("körlük zemini: iki dosyada da blok BULUNDU ve boş değil", () => {
    const el = twinBlock(ELECTRON_LIB);
    const mo = twinBlock(MOBILE_LIB);
    expect(el?.length ?? 0).toBeGreaterThan(500);
    expect(mo?.length ?? 0).toBeGreaterThan(500);
  });

  it("⭐ ASIL İDDİA: iki metin birebir aynı", () => {
    expect(twinBlock(MOBILE_LIB)).toBe(twinBlock(ELECTRON_LIB));
  });
});
