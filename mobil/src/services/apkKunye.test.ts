// =============================================================================
// BEKÇİ: tablet APK künyesi (G6) — künye doğrulayıcısı + yayın aracıyla çapraz kâhin (kripto: lib/kripto/kripto.test.ts)
// =============================================================================
// ⚠️ NEDEN: imzasız `apk/surum.json` ile güncelleme sunucusuna yazabilen biri sahadaki tabletlere keyfi APK
// kurdurabilirdi. Künye kuralları yayın tarafıyla AYNI olmalı: çapraz kâhin yayın aracının modülünü
// (`mobil/scripts/lib/apk-kunye.mjs`) ayrı node sürecinde koşar ve iki yön birbirini kabul/ret eder.
// =============================================================================
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { verifyApkFile, apkDownloadUrl, verifyApkRelease, b64uDecode, feedChannel, type AnchorKey, type ApkDoc } from './apkKunye';

const FEED = 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/';

function anahtar(kid: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x as string;
  return { kid, privateKey, capa: { kid, x } as AnchorKey };
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

function jws(o: { kid: string; privateKey: crypto.KeyObject; payload: unknown; typ?: string; baslik?: Record<string, unknown> }): string {
  const bas = b64({ alg: 'EdDSA', typ: o.typ ?? 'tekserp-apk', kid: o.kid, ...o.baslik });
  const yuk = b64(o.payload);
  const imza = crypto.sign(null, Buffer.from(`${bas}.${yuk}`), o.privateKey).toString('base64url');
  return `${bas}.${yuk}.${imza}`;
}

const APK = crypto.randomBytes(300_001);
const APK_SHA = crypto.createHash('sha256').update(APK).digest('hex');

function belge(ek: Record<string, unknown> = {}) {
  return {
    v: 1, urun: 'tablet', platform: 'android-arm64', kanal: 'adnansahin', versionCode: 57, versionName: '1.0.16',
    commit: 'abcdef1', yayinZamani: '2026-10-01T10:00:00.000Z',
    paket: { ad: 'TeksERP-1.0.16-vc57.apk', boyut: APK.length, sha256: APK_SHA }, capa: ['panel-2099'], ...ek,
  };
}

function surumJson(token: string | null, ek: Record<string, unknown> = {}) {
  const s: Record<string, unknown> = {
    versionCode: 57, versionName: '1.0.16', dosya: 'TeksERP-1.0.16-vc57.apk', sha256: APK_SHA, boyut: APK.length,
    zorunlu: false, notlar: '', yayinTarihi: '2026-10-01T10:00:00.000Z', indirmeUrl: 'https://kotu.example/x.apk', ...ek,
  };
  if (token !== null) s.tekserp = { v: 1, bildirim: token };
  return s;
}

const IMZA = anahtar('panel-2099');
const YABANCI = anahtar('panel-2097');

describe('APK künyesi doğrulayıcısı', () => {
  const capa = [IMZA.capa];
  const dogru = () => surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge() }));

  it('pozitif: imzalı + bu kanalın + surum.json ile bağlı künye kabul edilir', () => {
    const r = verifyApkRelease(dogru(), { keys: capa, channel: 'adnansahin' });
    expect(r.ok && r.value.paket.sha256).toBe(APK_SHA);
  });

  const red = (s: unknown, kod: string, keys: readonly AnchorKey[] = capa, kanal: string | null = 'adnansahin') => {
    const r = verifyApkRelease(s, { keys, channel: kanal });
    expect(r.ok ? 'KABUL' : r.code).toBe(kod);
    if (!r.ok) expect(r.message).toMatch(/kurulmadı|doğrulanamadı/);
  };

  it('imzasız künye (bugünkü yayın) → KUNYE_YOK', () => red(surumJson(null), 'KUNYE_YOK'));
  it('boş çapa → CAPA_BOS (fail-closed)', () => red(dogru(), 'CAPA_BOS', []));
  it('bozuk çapa / hazırlık anahtarı → CAPA_GECERSIZ', () => {
    red(dogru(), 'CAPA_GECERSIZ', [{ kid: 'panel-2099', x: 'kisa' }]);
    red(dogru(), 'CAPA_GECERSIZ', [{ kid: 'paket-hazirlik-1', x: IMZA.capa.x }]);
    red(dogru(), 'CAPA_GECERSIZ', [IMZA.capa, IMZA.capa]);
  });
  it('başka typ (panel künyesi aynı anahtarla) → JWS_TYP', () =>
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge(), typ: 'tekserp-panel' })), 'JWS_TYP'));
  it('çapada olmayan kid → JWS_KID', () =>
    red(surumJson(jws({ kid: YABANCI.kid, privateKey: YABANCI.privateKey, payload: belge() })), 'JWS_KID'));
  it('bilinen kid ama yabancı anahtar → JWS_IMZA', () =>
    red(surumJson(jws({ kid: IMZA.kid, privateKey: YABANCI.privateKey, payload: belge() })), 'JWS_IMZA'));
  it('başlıkta fazla alan → JWS_BASLIK; alg none → JWS_ALG', () => {
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge(), baslik: { jku: 'https://x' } })), 'JWS_BASLIK');
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge(), baslik: { alg: 'none' } })), 'JWS_ALG');
  });
  it('yük değiştirilmiş (imza eski) → JWS_IMZA', () => {
    const [b, , s] = jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge() }).split('.');
    red(surumJson(`${b}.${b64(belge({ versionCode: 58 }))}.${s}`), 'JWS_IMZA');
  });
  it('başka kanalın künyesi → KUNYE_KANAL; kanal çözülemedi → KUNYE_KANAL', () => {
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge({ kanal: 'testfabrika' }) })), 'KUNYE_KANAL');
    red(dogru(), 'KUNYE_KANAL', capa, null);
  });
  it('surum.json imzasız alanı künyeden ayrışırsa (eski tablet başka dosya indirirdi) → KUNYE_DOSYA', () => {
    const t = jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge() });
    red(surumJson(t, { sha256: '0'.repeat(64) }), 'KUNYE_DOSYA');
    red(surumJson(t, { dosya: 'TeksERP-1.0.17-vc58.apk' }), 'KUNYE_DOSYA');
    red(surumJson(t, { versionCode: 58 }), 'KUNYE_DOSYA');
    red(surumJson(t, { boyut: 1 }), 'KUNYE_DOSYA');
  });
  it('şema: dosya adı sürümle bağlı, yol taşıyamaz; sürüm 2 tanınmaz', () => {
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge({ paket: { ad: '../x.apk', boyut: 1, sha256: APK_SHA } }) })), 'BELGE_SEMA');
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge({ v: 2 }) })), 'BELGE_SURUM');
    red(surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge({ capa: [] }) })), 'BELGE_SEMA');
  });
  it('blok biçimi: fazla anahtar / bildirim string değil → KUNYE_BICIM', () => {
    red({ ...dogru(), tekserp: { v: 1, bildirim: 'a.b.c', url: 'x' } }, 'KUNYE_BICIM');
    red({ ...dogru(), tekserp: { v: 1, bildirim: 5 } }, 'KUNYE_BICIM');
  });
  it('katı base64url: dolgu / kanonik olmayan kuyruk reddedilir', () => {
    expect(b64uDecode('QQ')).toEqual(new Uint8Array([65]));
    expect(b64uDecode('QR')).toBeNull();
    expect(b64uDecode('QQ==')).toBeNull();
  });

  it('kanal yalnız gömülü https kökünden; indirme adresi künyedeki indirmeUrl DEĞİL', () => {
    expect(feedChannel(FEED)).toBe('adnansahin');
    expect(feedChannel('http://guncelleme.etkiliyazilim.com/adnansahin/mobil/')).toBeNull();
    expect(feedChannel('https://h/adnansahin/mobil/ek/')).toBeNull();
    expect(feedChannel(null)).toBeNull();
    const r = verifyApkRelease(dogru(), { keys: capa, channel: 'adnansahin' });
    expect(r.ok && apkDownloadUrl(FEED, r.value)).toBe(`${FEED}apk/TeksERP-1.0.16-vc57.apk`);
  });
});

describe('indirilen dosyanın özeti', () => {
  const doc = { kanal: 'adnansahin', versionCode: 57, versionName: '1.0.16', capa: ['panel-2099'],
    paket: { ad: 'TeksERP-1.0.16-vc57.apk', boyut: APK.length, sha256: APK_SHA } } as ApkDoc;
  const okuyucu = (b: Uint8Array, parca = 65_536) => {
    let o = 0;
    return () => {
      const p = b.subarray(o, o + parca);
      o += p.length;
      return p;
    };
  };

  it('doğru dosya kabul, ilerleme 1e ulaşır', async () => {
    const oranlar: number[] = [];
    await expect(verifyApkFile(doc, okuyucu(APK), (x) => oranlar.push(x))).resolves.toEqual({ ok: true, value: true });
    expect(oranlar[oranlar.length - 1]).toBe(1);
  });
  it('tek bayt farklı → DOSYA_OZETI', async () => {
    const b = Buffer.from(APK);
    b[150_000] ^= 1;
    await expect(verifyApkFile(doc, okuyucu(b))).resolves.toMatchObject({ ok: false, code: 'DOSYA_OZETI' });
  });
  it('kısa / uzun dosya → DOSYA_OZETI', async () => {
    await expect(verifyApkFile(doc, okuyucu(APK.subarray(1)))).resolves.toMatchObject({ ok: false, code: 'DOSYA_OZETI' });
    await expect(verifyApkFile(doc, okuyucu(Buffer.concat([APK, Buffer.from([0])])))).resolves.toMatchObject({ ok: false, code: 'DOSYA_OZETI' });
  });
  it('okuma hatası → DOSYA_OKUNAMADI', async () => {
    await expect(verifyApkFile(doc, () => { throw new Error('io'); })).resolves.toMatchObject({ ok: false, code: 'DOSYA_OKUNAMADI' });
  });
});

describe('çapraz kâhin — yayın aracının modülü (apk-kunye.mjs) ↔ tabletin doğrulayıcısı', () => {
  const MODUL = path.resolve(__dirname, '../../scripts/lib/apk-kunye.mjs');
  /** Yayın tarafını AYRI node sürecinde koşar (jest .mjs dönüştürmez): imzalar ya da doğrular, JSON döner. */
  const yayinTarafi = (girdi: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
      import crypto from 'node:crypto';
      const m = await import(${JSON.stringify(`file://${MODUL}`)});
      const g = JSON.parse(process.env.GIRDI);
      if (g.islem === 'imzala') {
        const privateKey = crypto.createPrivateKey(g.pem);
        const doc = m.buildApkDoc(g.doc);
        const s = m.withApkBlock(g.surum, m.signApkDoc({ doc, kid: g.kid, privateKey }));
        process.stdout.write(JSON.stringify(s));
      } else {
        const r = m.verifyApkSurumJson(g.surum, { keys: g.keys, channel: g.kanal });
        process.stdout.write(JSON.stringify({ ok: r.ok, kod: r.ok ? null : r.code }));
      }
    `], { env: { ...process.env, GIRDI: JSON.stringify(girdi) }, encoding: 'utf8' })) as Record<string, unknown>;

  const { v: _v, urun: _u, platform: _p, ...docGirdisi } = belge();
  const surumAlanlari = { versionCode: 57, versionName: '1.0.16', dosya: 'TeksERP-1.0.16-vc57.apk', sha256: APK_SHA, boyut: APK.length };

  it('yayın aracının imzaladığını tablet KABUL eder; tabletin reddettiği bozulmayı yayın aracı da reddeder', () => {
    const pem = IMZA.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const s = yayinTarafi({ islem: 'imzala', pem, kid: IMZA.kid, doc: docGirdisi, surum: surumAlanlari });
    const r = verifyApkRelease(s, { keys: [IMZA.capa], channel: 'adnansahin' });
    expect(r.ok).toBe(true);
    for (const [bozuk, kod] of [
      [{ ...s, boyut: 1 }, 'KUNYE_DOSYA'],
      [{ ...s, tekserp: { v: 1, bildirim: `${String((s.tekserp as { bildirim: string }).bildirim)}x` } }, 'JWS_BICIM'],
    ] as const) {
      const t = verifyApkRelease(bozuk, { keys: [IMZA.capa], channel: 'adnansahin' });
      const y = yayinTarafi({ islem: 'dogrula', surum: bozuk, keys: [IMZA.capa], kanal: 'adnansahin' });
      expect(t.ok ? 'KABUL' : t.code).toBe(kod);
      expect(y.ok).toBe(false);
    }
  });

  it('testin imzaladığını (tablet biçimi) yayın aracı da KABUL eder; başka kanalı ikisi de reddeder', () => {
    const s = surumJson(jws({ kid: IMZA.kid, privateKey: IMZA.privateKey, payload: belge() }));
    expect(yayinTarafi({ islem: 'dogrula', surum: s, keys: [IMZA.capa], kanal: 'adnansahin' })).toEqual({ ok: true, kod: null });
    expect(yayinTarafi({ islem: 'dogrula', surum: s, keys: [IMZA.capa], kanal: 'testfabrika' })).toEqual({ ok: false, kod: 'KUNYE_KANAL' });
  });
});
