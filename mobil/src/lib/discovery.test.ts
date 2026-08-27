// =============================================================================
// Bekçi: sunucu keşfi — saf mantık sınırları (mobil)
// =============================================================================
// NEDEN: üç karar sahada geri dönüşü zor sonuçlar üretir ve hiçbiri çalışma
// anında hata vermez:
//
//  1) TARAMA GENİŞLİĞİ. Tablet Wi-Fi üzerinde ve PİLLE çalışıyor. Bir `/16` ağda
//     naif hesap 65534 HTTP isteği demek — vardiya ortasında tabletin ağını ve
//     pilini bitirir. Sınır kaybolursa kimse fark etmez, ta ki sahada olana kadar.
//
//  2) `unknown` KİMLİK "farklı sunucu" SAYILMAMALI (üç meşru sebebi var).
//     Yanlış-pozitif bir güvenlik sorusu ezberden geçilir ve gerçek uyuşmazlıkta
//     da işe yaramaz.
//
//  3) BAŞKA BİR ÜRÜNÜN 4000 portundaki yanıtı aday SAYILMAMALI.
//
// Körlük zemini: mutlu yol boş dönmemeli — aksi halde "boş dizi döner"
// iddialarının hepsi vakumen geçerdi.
// =============================================================================
import {
  scanTargetsFor,
  prefixFromNetmask,
  compareIdentity,
  shouldWarnOnMismatch,
  parseIdentityPayload,
  rankCandidates,
  pickSelfHealTarget,
  SCAN_MAX_HOSTS,
  type DiscoveredServer,
} from './discovery';

function cand(p: Partial<DiscoveredServer>): DiscoveredServer {
  return {
    baseUrl: 'http://192.168.1.50:4000',
    host: '192.168.1.50',
    port: 4000,
    identity: null,
    rttMs: 10,
    matchesPinned: 'unknown',
    ...p,
  };
}

describe('scanTargetsFor — tarama genişliği', () => {
  it('körlük zemini: mutlu yol BOŞ dönmez', () => {
    expect(scanTargetsFor('192.168.1.23', '255.255.255.0').length).toBeGreaterThan(200);
  });

  it('/24 → tam 253 hedef (.0, .255 ve KENDİSİ hariç)', () => {
    const t = scanTargetsFor('192.168.1.23', '255.255.255.0');
    expect(t).toHaveLength(253);
    expect(t).not.toContain('192.168.1.0');
    expect(t).not.toContain('192.168.1.255');
    expect(t).not.toContain('192.168.1.23');
    expect(t).toContain('192.168.1.250'); // fabrikanın sunucusu
  });

  it('⭐ /16 gibi geniş ağda TAM TARAMA YOK — kendi /24 dilimine daralır', () => {
    const t = scanTargetsFor('10.0.5.7', '255.255.0.0');
    expect(t.length).toBeLessThanOrEqual(SCAN_MAX_HOSTS);
    // NEGATİF SINAMA: naif tam sayımın MUTLAKA döndüreceği adres.
    expect(t).not.toContain('10.0.6.1');
    expect(t).toContain('10.0.5.1');
  });

  it('link-local (169.254.x) HİÇ taranmaz', () => {
    expect(scanTargetsFor('169.254.10.5', '255.255.0.0')).toEqual([]);
  });

  it('adres yoksa/bozuksa boş döner (tarama patlamaz)', () => {
    expect(scanTargetsFor(null, '255.255.255.0')).toEqual([]);
    expect(scanTargetsFor('saçma', '255.255.255.0')).toEqual([]);
    expect(scanTargetsFor('192.168.1.5', null)).toHaveLength(253); // maske yoksa /24 varsay
  });

  it('tablet tavanı masaüstünden DAR (512) — pil/Wi-Fi bütçesi', () => {
    expect(SCAN_MAX_HOSTS).toBe(512);
    expect(scanTargetsFor('10.0.5.7', '255.255.252.0').length).toBeLessThanOrEqual(512);
  });

  it('prefixFromNetmask bitişik olmayan maskeyi reddeder', () => {
    expect(prefixFromNetmask('255.255.255.0')).toBe(24);
    expect(prefixFromNetmask('255.0.255.0')).toBeNull();
  });
});

describe('compareIdentity — "unknown" asla suçlamaz', () => {
  it('eşleşme / uyuşmazlık / bilinmiyor', () => {
    expect(compareIdentity('abc', 'abc')).toBe('match');
    expect(compareIdentity('abc', 'xyz')).toBe('mismatch');
    expect(compareIdentity(null, 'abc')).toBe('unknown');
    expect(compareIdentity('abc', null)).toBe('unknown');
  });

  it('büyük/küçük harf ve boşluk anlamsız (uuid hex)', () => {
    expect(compareIdentity('ABC-def', ' abc-DEF ')).toBe('match');
  });

  it('⭐ ASIL İDDİA: yalnız "mismatch" uyarı doğurur', () => {
    expect(shouldWarnOnMismatch('mismatch')).toBe(true);
    expect(shouldWarnOnMismatch('unknown')).toBe(false);
    expect(shouldWarnOnMismatch('match')).toBe(false);
  });
});

describe('parseIdentityPayload', () => {
  it('geçerli yükü çözer', () => {
    const id = parseIdentityPayload({
      product: 'TeksERP',
      discoveryVersion: 1,
      installationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      serverName: 'SAHINSRV',
      companyName: 'Adnan Şahin Tekstil',
      version: '2.9.0',
    });
    expect(id?.companyName).toBe('Adnan Şahin Tekstil');
  });

  it('⭐ BAŞKA bir ürünün yanıtını reddeder (4000 portunda başka servis olabilir)', () => {
    expect(parseIdentityPayload({ product: 'BaskaSistem', version: '1' })).toBeNull();
    expect(parseIdentityPayload(null)).toBeNull();
    expect(parseIdentityPayload('metin')).toBeNull();
    expect(parseIdentityPayload([])).toBeNull();
  });

  it('boş installationId null\'a iner (kimlik YOK ile tek biçim)', () => {
    expect(parseIdentityPayload({ product: 'TeksERP', installationId: '  ' })?.installationId)
      .toBeNull();
  });
});

describe('rankCandidates', () => {
  it('sabitlenmiş kimlikle eşleşen aday HER ZAMAN başa gelir', () => {
    const out = rankCandidates([
      cand({ host: 'a', rttMs: 1, matchesPinned: 'unknown' }),
      cand({ host: 'b', rttMs: 900, matchesPinned: 'match' }),
    ]);
    expect(out[0]?.host).toBe('b');
  });

  it('eşitlikte düşük gecikme kazanır', () => {
    const out = rankCandidates([
      cand({ host: 'slow', rttMs: 500 }),
      cand({ host: 'fast', rttMs: 5 }),
    ]);
    expect(out.map((c) => c.host)).toEqual(['fast', 'slow']);
  });
});

// =============================================================================
// pickSelfHealTarget — "sunucu taşındı, adresi kendiliğinden güncelle" kararı
// =============================================================================
// Bu bir GÜVENLİK SINIRI: yanlış tarafa düşerse tablet, ağda cevap veren
// herhangi bir sunucuya sessizce bağlanır ve operatör YANLIŞ FABRİKANIN
// verisine kayıt girer. Üç kuralın üçü de burada kilitli.
describe('pickSelfHealTarget — sessiz geçiş sınırı', () => {
  const matched = cand({ host: '192.168.1.77', baseUrl: 'http://192.168.1.77:4000', matchesPinned: 'match' });

  it('⭐ 1. KURAL: sabitlenmiş kimlik YOKSA hiçbir şey seçilmez', () => {
    expect(pickSelfHealTarget([matched], 'http://192.168.1.50:4000', null)).toBeNull();
    expect(pickSelfHealTarget([matched], 'http://192.168.1.50:4000', '   ')).toBeNull();
  });

  it('⭐ 2. KURAL: yalnız kimliği TUTAN aday seçilir', () => {
    const unknown = cand({ host: 'a', baseUrl: 'http://a:4000', matchesPinned: 'unknown' });
    const mismatch = cand({ host: 'b', baseUrl: 'http://b:4000', matchesPinned: 'mismatch' });
    expect(pickSelfHealTarget([unknown, mismatch], 'http://192.168.1.50:4000', 'iid-1')).toBeNull();
  });

  it('⭐ 3. KURAL: adres GERÇEKTEN değişmişse seçilir', () => {
    const same = cand({ host: 'x', baseUrl: 'http://192.168.1.50:4000', matchesPinned: 'match' });
    expect(pickSelfHealTarget([same], 'http://192.168.1.50:4000', 'iid-1')).toBeNull();
    // `/api` soneki ve sondaki eğik çizgi kıyaslamayı BOZMAMALI — yoksa aynı
    // adres "değişmiş" sanılır ve her kesintide gereksiz yazım + bildirim olur.
    expect(pickSelfHealTarget([same], 'http://192.168.1.50:4000/api', 'iid-1')).toBeNull();
    expect(pickSelfHealTarget([same], 'http://192.168.1.50:4000/', 'iid-1')).toBeNull();
  });

  it('mutlu yol: kimlik tutuyor + adres değişmiş → seçilir', () => {
    const out = pickSelfHealTarget([matched], 'http://192.168.1.50:4000/api', 'iid-1');
    expect(out?.baseUrl).toBe('http://192.168.1.77:4000');
  });

  it('körlük zemini: boş liste null döner (mutlu yol yukarıda kanıtlandı)', () => {
    expect(pickSelfHealTarget([], 'http://192.168.1.50:4000', 'iid-1')).toBeNull();
  });
});
