// İnternet kipi (docs/design/TABLET-GENEL-CA-BAGLANTI.md): kip adresten türer, düşüş yok, IP daima sabitli,
// izinli üst alan tek kaynaktan.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

import {
  INTERNET_PARENT_DOMAINS,
  INTERNET_TLS_PORT,
  decideInternetPair,
  internetIdentityChanged,
  internetServerFor,
  kipFor,
  parseInternetServers,
  webPkiFailureText,
  withInternetServer,
  type InternetServer,
} from './internet-tls';
import {
  INTERNET_HOST_NOT_PINNABLE,
  LAN_TLS_DEFAULT_PORT,
  buildTlsQr,
  decideCodePin,
  decideQrAddressPin,
  nativePinState,
  pairViaQrHosts,
  parsePairAddress,
  secureAddressUsable,
  type TlsPin,
} from './lan-tls';

const FP = 'ab'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const NOW = '2026-10-08T00:00:00.000Z';
const CLOUD = 'tekserp.etkiliyazilim.com';
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: 'kod', pinnedAt: NOW };
const REC: InternetServer = { host: CLOUD, port: 443, installationId: IID, addedAt: NOW };

describe('kipFor — kip adresin biçiminden türer', () => {
  it.each([
    ['192.168.1.10'],
    ['203.0.113.7'], // genel IP de sabitli: IP'yi ele geçiren sunucu olmasın
    ['::1'],
    ['sahinsrv'],
    ['sunucu.local'],
    ['erp.lan'],
    ['x.internal'],
    ['nas.home.arpa'],
    ['etkiliyazilim.com'], // üst alanın kendisi değil, altı
    ['erp.ornek.com.tr'],
    ['etkiliyazilim.com.kotu.net'],
    ['xetkiliyazilim.com'],
    ['a..etkiliyazilim.com'],
    ['-a.etkiliyazilim.com'],
    [''],
  ])('%s → sabitli', (h) => expect(kipFor(h)).toBe('sabitli'));

  it.each([[CLOUD], ['TekSERP.EtkiliYazilim.com.'], ['inceleme.demo.etkiliyazilim.com']])('%s → internet', (h) =>
    expect(kipFor(h)).toBe('internet'));

  it('üst alan tek kaynak: listedeki ad internet, liste değişince kip de değişir', () => {
    expect(INTERNET_PARENT_DOMAINS).toEqual(['etkiliyazilim.com']);
    expect(kipFor(CLOUD, [])).toBe('sabitli');
  });
});

describe('port varsayılanı kipe göre', () => {
  it('internet adı 443, IP ve tek etiket 4443; yazılan port korunur', () => {
    expect(parsePairAddress(CLOUD)).toEqual({ ok: true, host: CLOUD, port: INTERNET_TLS_PORT });
    expect(parsePairAddress(`https://${CLOUD}/api`)).toEqual({ ok: true, host: CLOUD, port: 443 });
    expect(parsePairAddress('192.168.1.10')).toEqual({ ok: true, host: '192.168.1.10', port: LAN_TLS_DEFAULT_PORT });
    expect(parsePairAddress('sahinsrv')).toEqual({ ok: true, host: 'sahinsrv', port: 4443 });
    expect(parsePairAddress(`${CLOUD}:8443`)).toEqual({ ok: true, host: CLOUD, port: 8443 });
  });
  it('http iki kipte de reddedilir', () => {
    expect(parsePairAddress(`http://${CLOUD}`).ok).toBe(false);
    expect(parsePairAddress('http://192.168.1.10').ok).toBe(false);
  });
});

describe('düşüş yok — internet adı sabitlenmez, sabitli adres internet kaydıyla açılmaz', () => {
  it('kodla sabitleme internet adını reddeder', () => {
    const r = decideCodePin({ observed: { host: CLOUD, port: 4443, fingerprint: FP, installationId: IID }, confirmed: true, now: NOW });
    expect(r).toEqual({ ok: false, reason: INTERNET_HOST_NOT_PINNABLE });
  });
  it('QR + adres internet adını reddeder; QR v2 adresleri arasındaki internet adı yoklanmaz', async () => {
    const qr = buildTlsQr(IID, { port: 4443, fingerprint: FP }, [CLOUD]);
    expect(decideQrAddressPin({ qrText: qr, observed: { host: CLOUD, port: 4443, fingerprint: FP, installationId: IID }, now: NOW }).ok).toBe(false);
    const probe = jest.fn(async () => ({ host: CLOUD, port: 4443, fingerprint: FP, installationId: IID }));
    expect(await pairViaQrHosts({ qrText: qr, probe, now: () => NOW })).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
  it('kayıtlı adres kipine göre kullanılır', () => {
    expect(secureAddressUsable(`https://${CLOUD}:443/api`, [], [REC])).toBe(true);
    expect(secureAddressUsable(`https://${CLOUD}/api`, [], [REC])).toBe(true);
    // internet adı sabitin portuyla açılmaz
    expect(secureAddressUsable(`https://${CLOUD}:4443/api`, [PIN], [REC])).toBe(false);
    expect(secureAddressUsable(`https://${CLOUD}:443/api`, [{ ...PIN, port: 443 }], [])).toBe(false);
    // sabitli adres internet kaydıyla açılmaz
    expect(secureAddressUsable('https://192.168.1.10:443/api', [], [{ ...REC, host: '192.168.1.10' }])).toBe(false);
    expect(secureAddressUsable('https://192.168.1.10:4443/api', [PIN], [])).toBe(true);
    expect(secureAddressUsable(`http://${CLOUD}:443/api`, [], [REC])).toBe(false);
  });
  it('native sabitli uç internet adını kapsamaz (sistem doğrulaması)', () => {
    expect(nativePinState([{ ...PIN, port: 443 }], { scheme: 'https', host: CLOUD, port: '443' }).endpoints).toEqual([]);
    expect(nativePinState([PIN], { scheme: 'https', host: '192.168.1.10', port: '4443' }).endpoints).toEqual(['192.168.1.10:4443']);
  });
});

describe('internet kaydı', () => {
  it('kip dışına düşen kayıt okunmaz; aynı ad yenisiyle değişir', () => {
    const raw = JSON.stringify([REC, { ...REC, host: '192.168.1.10' }, { host: 1 }]);
    expect(parseInternetServers(raw)).toEqual([REC]);
    expect(parseInternetServers('bozuk')).toEqual([]);
    expect(withInternetServer([REC], { ...REC, installationId: 'x' })).toEqual([{ ...REC, installationId: 'x' }]);
    expect(internetServerFor(`https://${CLOUD}:443/api`, [REC])).toEqual(REC);
    expect(internetServerFor(`https://${CLOUD}:8443/api`, [REC])).toBeNull();
  });
  it('ekleme: onay + kurulum kimliği + izinli ad şart', () => {
    const o = { host: CLOUD, port: 443, installationId: IID, companyName: 'Örnek' };
    expect(decideInternetPair({ observed: o, confirmed: true, now: NOW })).toEqual({ ok: true, record: REC, baseUrl: `https://${CLOUD}:443` });
    expect(decideInternetPair({ observed: o, confirmed: false, now: NOW }).ok).toBe(false);
    expect(decideInternetPair({ observed: { ...o, installationId: null }, confirmed: true, now: NOW }).ok).toBe(false);
    expect(decideInternetPair({ observed: { ...o, host: '203.0.113.7' }, confirmed: true, now: NOW }).ok).toBe(false);
  });
  it('kimlik değişimi engeli', () => {
    expect(internetIdentityChanged(REC, 'baska')).toBe(true);
    expect(internetIdentityChanged(REC, IID)).toBe(false);
    expect(internetIdentityChanged(REC, null)).toBe(false);
  });
  it('hata sınıfları ayrı metin taşır', () => {
    const t = (['clock_behind', 'clock_ahead', 'untrusted', 'name', 'network', 'tls'] as const).map((k) => webPkiFailureText(k, CLOUD));
    expect(new Set(t).size).toBe(6);
    expect(t[0]).toMatch(/saat/);
    expect(t[2]).toMatch(/denetliyor/);
    expect(t[2]).toContain(CLOUD);
  });
});

describe('bekçi: izinli üst alan literal olarak tek yerde', () => {
  it('src altında test dışı dosyalarda tırnaklı üst alan yalnız internet-tls.ts', () => {
    const root = resolve(__dirname, '..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) {
          const lines = readFileSync(p, 'utf8').split('\n');
          lines.forEach((l, i) => {
            if (/['"][^'"\n]*etkiliyazilim\.com/.test(l)) hits.push(`${p.slice(root.length + 1)}:${i + 1}`);
          });
        }
      }
    };
    walk(root);
    expect(hits).toEqual([expect.stringMatching(/^lib\/internet-tls\.ts:\d+$/)]);
  });
});
