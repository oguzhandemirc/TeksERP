// Sunucu ekleme kararları (K3): adres yalnız şifreli, kod onaysız sabit yok, QR + adres iz/port/kimlik tutmalı.
// Doğrulama kodu biçimi kurulum (ps1) · backend durum sayfası · panel · tablet arasında birebir.
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  INSECURE_ADDRESS_REASON,
  LAN_TLS_DEFAULT_PORT,
  buildTlsQr,
  decideCodePin,
  decideQrAddressPin,
  formatFingerprintGroups,
  pairViaQrHosts,
  parsePairAddress,
  parseTlsQr,
  parseTlsPins,
  secureAddressUsable,
  type TlsPin,
} from './lan-tls';

const FP = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const NOW = '2026-10-08T00:00:00.000Z';
const OBS = { host: '192.168.1.50', port: 4443, fingerprint: FP, installationId: IID };

describe('parsePairAddress', () => {
  it('http:// Türkçe gerekçeyle reddedilir', () => {
    expect(parsePairAddress('http://192.168.1.10:4000')).toEqual({ ok: false, reason: INSECURE_ADDRESS_REASON });
    expect(INSECURE_ADDRESS_REASON).toMatch(/yalnız şifreli/);
  });
  it('port yoksa 4443; https öneki ve /api soyulur; port korunur', () => {
    expect(LAN_TLS_DEFAULT_PORT).toBe(4443);
    expect(parsePairAddress('192.168.1.10')).toEqual({ ok: true, host: '192.168.1.10', port: 4443 });
    expect(parsePairAddress(' https://SRV-1:8443/api/ ')).toEqual({ ok: true, host: 'srv-1', port: 8443 });
    expect(parsePairAddress('10.0.0.5', 9443)).toEqual({ ok: true, host: '10.0.0.5', port: 9443 });
  });
  it('boş, yol içeren, yabancı şema ve aralık dışı port reddedilir', () => {
    for (const x of ['', '   ', '1.2.3.4/x', 'ftp://1.2.3.4', 'a b', '1.2.3.4:0', '1.2.3.4:70000']) {
      expect(parsePairAddress(x).ok).toBe(false);
    }
  });
});

describe('decideCodePin (IP + doğrulama kodu)', () => {
  it('onaysız sabit yazılmaz', () => {
    const d = decideCodePin({ observed: OBS, confirmed: false, now: NOW });
    expect(d.ok).toBe(false);
  });
  it('okunamayan iz reddedilir', () => {
    expect(decideCodePin({ observed: { ...OBS, fingerprint: 'xx' }, confirmed: true, now: NOW }).ok).toBe(false);
  });
  it('onayla: via kod, https adres', () => {
    expect(decideCodePin({ observed: OBS, confirmed: true, now: NOW })).toEqual({
      ok: true,
      pin: { installationId: IID, fingerprint: FP, port: 4443, via: 'kod', pinnedAt: NOW },
      baseUrl: 'https://192.168.1.50:4443',
    });
  });
});

describe('decideQrAddressPin (QR + elle adres)', () => {
  const qrText = buildTlsQr(IID, { port: 4443, fingerprint: FP });
  it('iz, port ya da kimlik tutmazsa red', () => {
    expect(decideQrAddressPin({ qrText, observed: { ...OBS, fingerprint: OTHER }, now: NOW }).ok).toBe(false);
    expect(decideQrAddressPin({ qrText, observed: { ...OBS, port: 4444 }, now: NOW }).ok).toBe(false);
    expect(decideQrAddressPin({ qrText, observed: { ...OBS, installationId: 'baska' }, now: NOW }).ok).toBe(false);
    expect(decideQrAddressPin({ qrText: 'rastgele', observed: OBS, now: NOW }).ok).toBe(false);
  });
  it('tutarsa via qr, https adres', () => {
    const d = decideQrAddressPin({ qrText, observed: OBS, now: NOW });
    expect(d).toEqual({ ok: true, pin: { installationId: IID, fingerprint: FP, port: 4443, via: 'qr', pinnedAt: NOW }, baseUrl: 'https://192.168.1.50:4443' });
  });
});

describe('QR v2: sunucu adresleri', () => {
  const ADV = { port: 4443, fingerprint: FP };
  it('adressiz QR bugünkü v1 dizesinin aynısı (eski tablet okur)', () => {
    expect(buildTlsQr(IID, ADV)).toBe(`teks-erp-tls:1:${IID}:${FP}:4443`);
    expect(buildTlsQr(IID, ADV, [])).toBe(`teks-erp-tls:1:${IID}:${FP}:4443`);
    expect(parseTlsQr(buildTlsQr(IID, ADV))?.hosts).toEqual([]);
  });
  it('adresli QR v2: tekilleşir, küçük harfe iner, geçersiz adres girmez, en çok 6', () => {
    const qr = buildTlsQr(IID, ADV, ['192.168.1.50', 'SahinSrv', '192.168.1.50', 'http://x', 'a b', '::1', '10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5']);
    expect(qr.startsWith('teks-erp-tls:2:')).toBe(true);
    expect(parseTlsQr(qr)).toEqual({ installationId: IID, advert: ADV, hosts: ['192.168.1.50', 'sahinsrv', '10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'] });
  });
  it('v2 sonraki alanları yok sayar; bozuk adres listesi bütün QR\'ı düşürür', () => {
    const base = `teks-erp-tls:2:${IID}:${FP}:4443`;
    expect(parseTlsQr(`${base}:192.168.1.50:yeni-alan`)?.hosts).toEqual(['192.168.1.50']);
    for (const bad of [base, `${base}:`, `${base}:192.168.1.50,`, `${base}:HOST`, `${base}:http//x`, `${base}:${'1.1.1.1,'.repeat(6)}1.1.1.1`]) {
      expect(parseTlsQr(bad)).toBeNull();
    }
  });
  it('eski (vc60) okuyucu v2\'yi tanımaz — panel bu yüzden v1\'i de gösterir', () => {
    const eskiOkuyucu = (t: string) => t.startsWith('teks-erp-tls:1:') && t.slice(15).split(':').length === 3;
    expect(eskiOkuyucu(buildTlsQr(IID, ADV))).toBe(true);
    expect(eskiOkuyucu(buildTlsQr(IID, ADV, ['192.168.1.50']))).toBe(false);
  });
});

describe('pairViaQrHosts: adresler sırayla, güven izde', () => {
  const qrText = buildTlsQr(IID, { port: 4443, fingerprint: FP }, ['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  const now = () => NOW;
  it('cevapsız ve izi tutmayan adres atlanır; ilk tutan sabitlenir', async () => {
    const seen: string[] = [];
    const probe = async (host: string, port: number) => {
      seen.push(`${host}:${port}`);
      if (host === '10.0.0.1') return null;
      if (host === '10.0.0.2') return { ...OBS, host, fingerprint: OTHER };
      return { ...OBS, host };
    };
    const d = await pairViaQrHosts({ qrText, probe, now });
    expect(seen).toEqual(['10.0.0.1:4443', '10.0.0.2:4443', '10.0.0.3:4443']);
    expect(d).toEqual({ ok: true, pin: { installationId: IID, fingerprint: FP, port: 4443, via: 'qr', pinnedAt: NOW }, baseUrl: 'https://10.0.0.3:4443' });
  });
  it('hiçbiri tutmazsa null (ağ aramasına düşülür); başka kurulumun sunucusu da tutmaz', async () => {
    const d = await pairViaQrHosts({ qrText, probe: async (host) => ({ ...OBS, host, installationId: '99999999-2222-3333-4444-555555555555' }), now });
    expect(d).toBeNull();
  });
  it('adressiz (v1) QR yoklama yapmaz; vazgeçilince durur', async () => {
    const probe = jest.fn(async (host: string) => ({ ...OBS, host }));
    expect(await pairViaQrHosts({ qrText: buildTlsQr(IID, { port: 4443, fingerprint: FP }), probe, now })).toBeNull();
    expect(await pairViaQrHosts({ qrText, probe, now, stillWanted: () => false })).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('secureAddressUsable ve sabit deposu', () => {
  const pin: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: 'kod', pinnedAt: NOW };
  it('yalnız https + sabitli port kullanılabilir', () => {
    expect(secureAddressUsable('https://192.168.1.50:4443/api', [pin])).toBe(true);
    expect(secureAddressUsable('https://192.168.1.50:4444/api', [pin])).toBe(false);
    expect(secureAddressUsable('http://192.168.1.50:4443/api', [pin])).toBe(false);
    expect(secureAddressUsable('https://192.168.1.50/api', [pin])).toBe(false);
    expect(secureAddressUsable('https://192.168.1.50:4443/api', [])).toBe(false);
  });
  it("via 'kod' depodan geri okunur", () => {
    expect(parseTlsPins(JSON.stringify([pin]))).toEqual([pin]);
  });
});

describe('doğrulama kodu biçimi kurulum · backend · tablet arasında birebir', () => {
  const kok = resolve(__dirname, '../../..');
  it('backend durum sayfası ile aynı gövde', () => {
    const be = readFileSync(resolve(kok, 'Teks-Erp/src/lib/lan-tls/store.ts'), 'utf8');
    const mob = readFileSync(resolve(__dirname, 'lan-tls.ts'), 'utf8');
    const govde = (src: string) => /export function formatFingerprintGroups\(hex: string\): string \{\n\s*(.*)\n\}/.exec(src)?.[1]?.replace(/"/g, "'") ?? null;
    expect(govde(mob)).not.toBeNull();
    expect(govde(be)).toBe(govde(mob));
  });
  it("kurulumun ParmakIziGrupla'sı 4'lü büyük harf, tek boşluk", () => {
    const ps = readFileSync(resolve(kok, 'deploy/kurulum/kurulum-ortak.ps1'), 'utf8');
    const fn = /function ParmakIziGrupla\(\[string\]\$hex\) \{([\s\S]*?)\n\}/.exec(ps)?.[1] ?? '';
    expect(fn).toContain('$hex.ToUpperInvariant()');
    expect(fn).toContain('$i += 4');
    expect(fn).toContain('-join " "');
  });
  it('64 hane → 16 grup', () => {
    const k = formatFingerprintGroups('0123456789abcdef'.repeat(4));
    expect(k.split(' ')).toHaveLength(16);
    expect(k.startsWith('0123 4567 89AB CDEF')).toBe(true);
  });
});
