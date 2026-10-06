// Bekçi: tabletin şifreli bağlantı kararları (docs/design/LAN-TLS.md §4c, §6).
// ⭐ Sabit yalnız QR'dan; QR bağlı sunucunun kimliği ve ilanıyla çapraz denetlenir.
// ⭐ Native zorlama katmanı yoksa sabit YAZILMAZ.
// ⭐ Sabit yoksa keşif adayları DEĞİŞMEZ; sabit varken HTTP'ye düşüş yok.
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  applyTlsRoute,
  buildTlsQr,
  decideQrPin,
  httpFallbackUrl,
  nativePinState,
  parseTlsPins,
  parseTlsQr,
  type TlsPin,
} from './lan-tls';

const FP = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const QR = buildTlsQr(IID, { port: 4443, fingerprint: FP });
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: 'qr', pinnedAt: '' };

const base = {
  qrText: QR,
  nativeAvailable: true,
  host: '192.168.1.50',
  serverInstallationId: IID,
  serverAdvert: { port: 4443, fingerprint: FP },
  now: '2026-10-06T00:00:00.000Z',
};

describe('QR ile sabitleme kararı', () => {
  it('eşleşen QR → sabit + https adresi', () => {
    const d = decideQrPin(base);
    expect(d).toEqual({ ok: true, pin: { ...PIN, pinnedAt: base.now }, baseUrl: 'https://192.168.1.50:4443' });
  });
  it('native katman yoksa sabit yazılmaz', () => {
    const d = decideQrPin({ ...base, nativeAvailable: false });
    expect(d.ok).toBe(false);
  });
  it('başka kurulumun QR\'ı reddedilir', () => {
    expect(decideQrPin({ ...base, serverInstallationId: '99999999-2222-3333-4444-555555555555' }).ok).toBe(false);
    expect(decideQrPin({ ...base, serverInstallationId: null }).ok).toBe(false);
  });
  it('ilan QR\'dan farklıysa (parmak izi ya da port) reddedilir', () => {
    expect(decideQrPin({ ...base, serverAdvert: { port: 4443, fingerprint: OTHER } }).ok).toBe(false);
    expect(decideQrPin({ ...base, serverAdvert: { port: 4444, fingerprint: FP } }).ok).toBe(false);
    expect(decideQrPin({ ...base, serverAdvert: null }).ok).toBe(false);
  });
  it('QR olmayan metin ve bağlantısız tablet reddedilir', () => {
    expect(decideQrPin({ ...base, qrText: 'TOP-12345' }).ok).toBe(false);
    expect(decideQrPin({ ...base, host: null }).ok).toBe(false);
  });
});

describe('keşifte kanal dağıtımı', () => {
  const c = (iid: string | null, tls: { port: number; fingerprint: string } | null) => ({
    baseUrl: 'http://192.168.1.50:4000',
    host: '192.168.1.50',
    port: 4000,
    identity: { installationId: iid },
    tls,
  });
  it('sabit yoksa adaylar aynen kalır (bugünkü davranış)', () => {
    const list = [c(IID, null), c(null, null)];
    expect(applyTlsRoute(list, [])).toEqual({ list, blocked: null });
  });
  it('sabitli kurulum → https adresine yükselir', () => {
    const r = applyTlsRoute([c(IID, { port: 4443, fingerprint: FP })], [PIN]);
    expect(r.list[0]).toMatchObject({ baseUrl: 'https://192.168.1.50:4443', port: 4443 });
  });
  it('sabitli kurulum TLS sunmuyor ya da kod farklı → aday DÜŞER, sebep döner', () => {
    expect(applyTlsRoute([c(IID, null)], [PIN]).list).toHaveLength(0);
    const r = applyTlsRoute([c(IID, { port: 4443, fingerprint: OTHER })], [PIN]);
    expect(r.list).toHaveLength(0);
    expect(r.blocked).toMatch(/192\.168\.1\.50/);
  });
  it('başka kurulumun adayı sabitten etkilenmez', () => {
    const other = c('99999999-2222-3333-4444-555555555555', null);
    expect(applyTlsRoute([other], [PIN]).list).toEqual([other]);
  });
});

describe('depo ve dönüş adresi', () => {
  it('bozuk kayıt boş listeye iner, geçersiz parmak izli satır atılır', () => {
    expect(parseTlsPins('{bozuk')).toEqual([]);
    expect(parseTlsPins(JSON.stringify([{ ...PIN, fingerprint: 'xx' }, PIN]))).toEqual([PIN]);
  });
  it('dönüş: aynı sunucunun son http adresi, yoksa varsayılan port', () => {
    expect(httpFallbackUrl('10.0.0.5', ['http://10.0.0.9:4000/api', 'http://10.0.0.5:4010/api'], 4000)).toBe('http://10.0.0.5:4010');
    expect(httpFallbackUrl('10.0.0.5', [], 4000)).toBe('http://10.0.0.5:4000');
  });
});

describe('native katmana itilen küme (D5)', () => {
  const https = { scheme: 'https' as const, host: '192.168.1.50', port: '4443' };
  it('parmak izleri tekil ve sıralı; sabit yoksa boş', () => {
    expect(nativePinState([], https)).toEqual({ fingerprints: [], endpoints: [] });
    const p2 = { ...PIN, installationId: null, fingerprint: OTHER };
    expect(nativePinState([p2, PIN, PIN], https).fingerprints).toEqual([FP, OTHER]);
  });
  it('sabitli uç yalnız https + sabitin portu; host küçük harfe iner', () => {
    expect(nativePinState([PIN], https).endpoints).toEqual(['192.168.1.50:4443']);
    expect(nativePinState([PIN], { ...https, host: 'SUNUCU' }).endpoints).toEqual(['sunucu:4443']);
    expect(nativePinState([PIN], { ...https, scheme: 'http' }).endpoints).toEqual([]);
    expect(nativePinState([PIN], { ...https, port: '4444' }).endpoints).toEqual([]);
    expect(nativePinState([PIN], { ...https, host: ' ' }).endpoints).toEqual([]);
  });
});

// İKİZ: mobil Electron'u import edemez; aynı adlı işlevler metin olarak aynı kalmalı.
const ELECTRON = resolve(__dirname, '../../../Electron/shared/lan-tls.ts');
const TWINS = [
  'normalizeFingerprint',
  'formatFingerprintGroups',
  'parseTlsAdvert',
  'httpsBaseUrlOf',
  'pinsForInstallation',
  'routeFor',
  'withPin',
  'buildTlsQr',
  'parseTlsQr',
];

function fnText(src: string, name: string): string | null {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) return null;
  const end = src.indexOf('\n}\n', start);
  return end < 0 ? null : src.slice(start, end + 2);
}

/** Biçim farkını (tırnak, boşluk, sondaki virgül) eler; anlam farkı kalır. */
function norm(t: string): string {
  return t.replace(/"/g, "'").replace(/,(\s*[)\]}])/g, '$1').replace(/\s+/g, '');
}

describe('ikiz: Electron/shared/lan-tls.ts', () => {
  const present = existsSync(ELECTRON);
  it('Electron kaynağı bulunur (yoksa GÜRÜLTÜLÜ düşer)', () => {
    expect(present).toBe(true);
  });
  const mob = readFileSync(resolve(__dirname, 'lan-tls.ts'), 'utf8');
  const ele = present ? readFileSync(ELECTRON, 'utf8') : '';
  it.each(TWINS)('%s iki yüzde aynı', (name) => {
    const a = fnText(mob, name);
    const b = fnText(ele, name);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(norm(a!)).toBe(norm(b!));
  });
  it('QR öneki ve parmak izi kalıbı aynı', () => {
    expect(ele).toContain('export const TLS_QR_PREFIX = "teks-erp-tls:1:";');
    expect(ele).toContain('const HEX64 = /^[0-9a-f]{64}$/;');
  });
  it('panelin ürettiği QR biçimi tablette ayrışır', () => {
    expect(parseTlsQr(`teks-erp-tls:1:${IID}:${FP}:4443`)).toEqual({ installationId: IID, advert: { port: 4443, fingerprint: FP } });
  });
});
