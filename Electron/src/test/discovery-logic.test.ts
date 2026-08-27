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
  dedupeCandidates,
  rankCandidates,
  SCAN_MAX_HOSTS,
  type DiscoveredServer,
} from "@shared/discovery";

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
    const out = dedupeCandidates([
      candidate({ via: "scan", identity: { installationId: "iid-1" } as never }),
      candidate({ via: "mdns", identity: { installationId: "iid-1" } as never }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.via).toBe("mdns");
  });

  it("kimliksiz adaylar adrese göre tekilleşir", () => {
    const out = dedupeCandidates([
      candidate({ host: "192.168.1.5", via: "scan" }),
      candidate({ host: "192.168.1.5", via: "mdns" }),
      candidate({ host: "192.168.1.6", via: "scan" }),
    ]);
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
