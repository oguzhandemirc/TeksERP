// Bekçi: tabletin lisans kararları SAF — kapı hatası sınıflandırması, uyarı metni,
// gözlemde sıfır fark (bant/K5 YOK), modül adı aynası (backend MODULE_SETTING_KEYS)
// ve QR yanıt süzgeci. Sözleşme: docs/design/LISANS-PROTOKOLU.md §14.
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  MODULE_LABELS,
  bannerToShow,
  classifyLicenseError,
  isLicenseBlocked,
  isLicenseNotified,
  isLoginSuspended,
  isSuspendedStatus,
  licenseScanStep,
  licenseBlockToast,
  licenseSummaryRows,
  moduleLabel,
  normalizeScannedResponse,
  type LicenseStatusSummary,
} from './license';
import { splitIntoQrParts } from './qr-parca';

function status(over: Partial<LicenseStatusSummary> = {}): LicenseStatusSummary {
  return {
    ayrinti: true,
    kip: 'zorla',
    kademe: 'NORMAL',
    bant: null,
    ekSureKalanGun: null,
    kisitlamaKalanGun: null,
    guncellemeIzni: true,
    sinif: 'URETIM',
    lisansNo: 'TKS-2026-0001',
    lisansSahibi: { musteri: 'Örnek Tekstil', tesis: 'Merkez' },
    surum: '2.12.0',
    ...over,
  };
}

describe('§1 classifyLicenseError — yalnız 403 + lisans kapı kodu', () => {
  it('dört kapı kodu dört türe', () => {
    expect(classifyLicenseError(403, { code: 'LICENSE_RESTRICTED', kademe: 'KISITLI' })).toEqual({ kind: 'restricted' });
    expect(classifyLicenseError(403, { code: 'LICENSE_SUSPENDED' })).toEqual({ kind: 'suspended' });
    expect(classifyLicenseError(403, { code: 'LICENSE_GATE' })).toEqual({ kind: 'gate' });
    expect(classifyLicenseError(403, { code: 'LICENSE_MODULE', modul: 'finance.enabled' })).toEqual({
      kind: 'module',
      moduleKey: 'finance.enabled',
    });
    expect(classifyLicenseError(403, { code: 'LICENSE_MODULE' })).toEqual({ kind: 'module', moduleKey: null });
  });

  it('başka durum / başka kod / ayrıntısız → null (kapı üretmedi)', () => {
    expect(classifyLicenseError(409, { code: 'LICENSE_RESTRICTED' })).toBeNull();
    expect(classifyLicenseError(403, { code: 'MODULE_DISABLED' })).toBeNull();
    expect(classifyLicenseError(403, { code: 'LICENSE_UPDATES_FROZEN' })).toBeNull();
    expect(classifyLicenseError(403, undefined)).toBeNull();
    expect(classifyLicenseError(undefined, { code: 'LICENSE_GATE' })).toBeNull();
  });

  it('isLicenseBlocked sarılmış istemci hatasını (status + details) okur', () => {
    expect(isLicenseBlocked({ status: 403, details: { code: 'LICENSE_RESTRICTED' } })).toBe(true);
    expect(isLicenseBlocked({ status: 403, details: { code: 'FORBIDDEN' } })).toBe(false);
    expect(isLicenseBlocked(null)).toBe(false);
  });
});

describe('§2 licenseBlockToast — tek uyarı metni', () => {
  it('kısıtlı kip metni sabit', () => {
    expect(licenseBlockToast({ kind: 'restricted' })?.text1).toBe('Lisans kısıtlı kipte — yeni kayıt yapılamaz');
  });
  it('kapalı modül modül adını söyler (DB anahtarı da API alanı da)', () => {
    expect(licenseBlockToast({ kind: 'module', moduleKey: 'finance.enabled' })?.text1).toBe(
      'Ön muhasebe modülü lisansınızda kapalı',
    );
    expect(licenseBlockToast({ kind: 'module', moduleKey: 'depoMultiEnabled' })?.text1).toBe(
      'Çoklu depo modülü lisansınızda kapalı',
    );
    expect(licenseBlockToast({ kind: 'module', moduleKey: null })?.text1).toBe('Bu modül lisansınızda kapalı');
  });
  it('K5 (tam ekran) ve kimliksiz kapı (ayrıntısız) toast ÜRETMEZ', () => {
    expect(licenseBlockToast({ kind: 'suspended' })).toBeNull();
    expect(licenseBlockToast({ kind: 'gate' })).toBeNull();
  });
});

describe('§3 bant ve K5 — gözlem kipinde SIFIR FARK', () => {
  const bant = { metin: 'Ödeme bekleniyor', ton: 'uyari' as const };
  it('zorlamada backend bandı çizilir', () => {
    expect(bannerToShow(status({ bant }))).toEqual(bant);
  });
  it('gözlemde bant gelse bile çizilmez; K5 sayılmaz', () => {
    expect(bannerToShow(status({ kip: 'gozlem', bant }))).toBeNull();
    expect(isSuspendedStatus(status({ kip: 'gozlem', kademe: 'DURDURULMUS' }))).toBe(false);
  });
  it('bant yok / boş metin / kimliksiz yanıt / veri yok → null', () => {
    expect(bannerToShow(status())).toBeNull();
    expect(bannerToShow(status({ bant: { metin: '   ', ton: 'bilgi' } }))).toBeNull();
    expect(bannerToShow({ ayrinti: false })).toBeNull();
    expect(bannerToShow(undefined)).toBeNull();
  });
  it('K5 yalnız zorlamada DURDURULMUS', () => {
    expect(isSuspendedStatus(status({ kademe: 'DURDURULMUS' }))).toBe(true);
    expect(isSuspendedStatus(status({ kademe: 'KISITLI' }))).toBe(false);
    expect(isSuspendedStatus({ ayrinti: false })).toBe(false);
  });
});

describe('§4 licenseSummaryRows — görünür filigran', () => {
  it('no · sahip · sürüm; NORMAL ve gözlemde kademe satırı yok', () => {
    expect(licenseSummaryRows(status()).map((r) => r.label)).toEqual(['Lisans no', 'Lisans sahibi', 'Sunucu sürümü']);
    expect(licenseSummaryRows(status({ kip: 'gozlem', kademe: 'KISITLI' })).map((r) => r.label)).not.toContain('Durum');
  });
  it('zorlamada NORMAL dışı kademe görünür; etkinleşmemiş kurulum söylenir', () => {
    const rows = licenseSummaryRows(status({ kademe: 'KISITLI', lisansNo: null, lisansSahibi: null }));
    expect(rows).toContainEqual({ label: 'Durum', value: 'Kısıtlı kip' });
    expect(rows[0]).toEqual({ label: 'Lisans no', value: 'Etkinleştirilmemiş' });
    expect(licenseSummaryRows({ ayrinti: false })).toEqual([]);
  });
});

describe('§5 normalizeScannedResponse — yanlış QR sunucuya gitmez', () => {
  const json = JSON.stringify({ v: 1, kira: 'eyJhbGciOiJFZERTQSJ9.e30.sig' });
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  it('JSON ve base64url(JSON) geçer (kırpılır)', () => {
    expect(normalizeScannedResponse(`  ${json}\n`)).toBe(json);
    expect(normalizeScannedResponse(b64)).toBe(b64);
  });
  it('top barkodu, adres, yarım JSON, dev metin reddedilir', () => {
    expect(normalizeScannedResponse('R-000123')).toBeNull();
    expect(normalizeScannedResponse('https://lisans.example.com/q#abc')).toBeNull();
    expect(normalizeScannedResponse('{"v":1,"kira":"x"')).toBeNull();
    expect(normalizeScannedResponse('A'.repeat(64 * 1024 + 1))).toBeNull();
  });
});

describe('§6 modül adı aynası — backend MODULE_SETTING_KEYS ile birebir', () => {
  const file = resolve(__dirname, '../../../Teks-Erp/src/constants/module-flags.ts');
  const haveBackend = existsSync(file);
  if (!haveBackend) {
    it.skip('⚠️ backend kaynağı yok (mobil tek başına klonlanmış) — ayna ÖLÇÜLMEDİ', () => undefined);
    return;
  }
  it('her modül anahtarının Türkçe adı var, fazlası yok', () => {
    const src = readFileSync(file, 'utf8');
    const block = /export const MODULE_SETTING_KEYS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
    expect(block).not.toBeNull();
    const keys = [...(block?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(MODULE_LABELS).sort()).toEqual(keys);
  });
  it('bilinmeyen anahtar ham döner (bilgi kaybolmaz)', () => {
    expect(moduleLabel('patron-bulut')).toBe('patron-bulut');
    expect(moduleLabel(null)).toBeNull();
  });
});

describe('§7 isLicenseNotified — ekran toast\'ı yalnız interceptor SÖYLEDİYSE susar', () => {
  it('kısıtlı kip · modül · K5 → söylendi; kimliksiz kapı ve lisans dışı 403 → söylenmedi', () => {
    expect(isLicenseNotified({ status: 403, details: { code: 'LICENSE_RESTRICTED' } })).toBe(true);
    expect(isLicenseNotified({ status: 403, details: { code: 'LICENSE_MODULE', modul: 'finance.enabled' } })).toBe(true);
    expect(isLicenseNotified({ status: 403, details: { code: 'LICENSE_SUSPENDED' } })).toBe(true);
    expect(isLicenseNotified({ status: 403, details: { code: 'LICENSE_GATE' } })).toBe(false);
    expect(isLicenseNotified({ status: 403, details: { code: 'FORBIDDEN' } })).toBe(false);
    expect(isLicenseNotified(new Error('ağ'))).toBe(false);
  });
});

describe('§8 isLoginSuspended — giriş öncesi K5 yalnız TAZE sinyalle', () => {
  it('taze + true → K5; bayat disk değeri, false ve eski backend (alan yok) → giriş açık', () => {
    expect(isLoginSuspended({ lisansDurduruldu: true }, true)).toBe(true);
    expect(isLoginSuspended({ lisansDurduruldu: true }, false)).toBe(false);
    expect(isLoginSuspended({ lisansDurduruldu: false }, true)).toBe(false);
    expect(isLoginSuspended({}, true)).toBe(false);
    expect(isLoginSuspended(undefined, true)).toBe(false);
    expect(isLoginSuspended({ lisansDurduruldu: 'true' }, true)).toBe(false);
  });
});

describe('§9 licenseScanStep — çok parçalı yanıt QR\'ı', () => {
  const yanit = JSON.stringify({ v: 1, hak: 'x'.repeat(1500), kira: 'y'.repeat(1500) });
  const parts = splitIntoQrParts(yanit)!;
  it('parçalar toplanır, son parçada TEK metin gönderilir', () => {
    const a = licenseScanStep(null, parts[1]);
    expect(a).toMatchObject({ kind: 'parca', received: 1, total: parts.length });
    const state = a.kind === 'parca' ? a.state : null;
    expect(licenseScanStep(state, parts[1])).toMatchObject({ kind: 'tekrar', received: 1 });
    let st = state;
    for (const p of [parts[0], parts[2]]) {
      const r = licenseScanStep(st, p);
      if (r.kind === 'parca') st = r.state;
      else expect(r).toEqual({ kind: 'gonder', yanit });
    }
  });
  it('tek parça eski biçim doğrudan gider; yabancı QR ve bozuk parça reddedilir', () => {
    expect(licenseScanStep(null, `  ${yanit} `)).toEqual({ kind: 'gonder', yanit });
    expect(licenseScanStep(null, 'R-000123')).toMatchObject({ kind: 'ret', reset: false });
    expect(licenseScanStep(null, parts[0].replace(/.$/, '#'))).toMatchObject({ kind: 'ret', reset: false });
  });
  it('birleşen metin lisans yanıtına benzemiyorsa gönderilmez, küme sıfırlanır', () => {
    const junk = splitIntoQrParts('düz metin '.repeat(200))!;
    let st = null;
    let last = licenseScanStep(st, junk[0]);
    for (const p of junk.slice(1)) {
      if (last.kind === 'parca') st = last.state;
      last = licenseScanStep(st, p);
    }
    expect(last).toMatchObject({ kind: 'ret', reset: true });
  });
});
