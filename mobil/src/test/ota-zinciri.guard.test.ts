// =============================================================================
// BEKÇİ: OTA sertifika zinciri (K-2 / I5) — kök/yaprak profili + withOtaZinciri eklentisi
// =============================================================================
// APK'ya OTA KÖKÜ gömülür, manifesti yaprak imzalar (docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.1).
// Tören ve bekçi AYNI openssl argv'sini kullanır; burada üretilen zincir ATILACAKTIR (geçici dizin, depoya girmez).
// openssl yoksa beyanlı atlanır; TEKSERP_STRICT=1 atlamayı yasaklar.
// =============================================================================

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const KOK = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Z = require(path.join(KOK, 'scripts/lib/ota-zinciri.cjs'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const eklenti = require(path.join(KOK, 'plugins/withOtaZinciri.js'));

let opensslVar = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  opensslVar = false;
}
const strict = process.env.TEKSERP_STRICT === '1';
if (!opensslVar && strict) throw new Error('TEKSERP_STRICT=1: openssl yok — OTA zinciri bekçisi ölçülemedi');
const d = opensslVar ? describe : describe.skip;

d('OTA zinciri — tören profili (openssl, atılacak zincir)', () => {
  let gecici = '';
  let z: { kokPem: string; yaprakPem: string; yollar: { kokSertifika: string; yaprakSertifika: string } };
  beforeAll(() => {
    gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-ota-zinciri-'));
    z = Z.denemeZinciriUret(path.join(gecici, 'z'));
  });
  afterAll(() => fs.rmSync(gecici, { recursive: true, force: true }));

  it('kök profili OTA kökü, yaprak profili köke bağlı imzacı', () => {
    expect(Z.kokHatalari(z.kokPem)).toEqual([]);
    expect(Z.yaprakHatalari(z.yaprakPem, z.kokPem, { esikGun: Z.OTA_YAPRAK_ESIK_GUN })).toEqual([]);
    expect(Z.istemciZinciri([z.yaprakPem, z.kokPem]).subject).toMatch(/OTA Yaprak/);
  });

  it('SONDA: kök tek başına imzacı OLAMAZ (EKU yok) · yaprak kök olarak gömülemez', () => {
    expect(() => Z.istemciZinciri([z.kokPem])).toThrow(/kod imzalama sertifikası değil/);
    expect(Z.kokHatalari(z.yaprakPem).join('\n')).toMatch(/CA DEĞİL[\s\S]*EKU taşıyor/);
  });

  it('withOtaZinciri.kokSorunu: kök geçer; yaprak, eksik dosya ve tanımsız yol DURUR', () => {
    const goreli = (p: string) => path.relative(gecici, p);
    expect(eklenti.kokSorunu(gecici, goreli(z.yollar.kokSertifika))).toBeNull();
    expect(eklenti.kokSorunu(gecici, goreli(z.yollar.yaprakSertifika))).toMatch(/OTA KÖKÜ DEĞİL/);
    expect(eklenti.kokSorunu(gecici, 'yok/certificate.pem')).toMatch(/OTA kökü sertifikası yok/);
    expect(eklenti.kokSorunu(gecici, undefined)).toMatch(/tanımlı değil/);
  });

  // `openssl ca -startdate/-enddate` LibreSSL ve OpenSSL 3.0'da da var: saniye kaymalı yaprak her platformda basılır.
  const caIleYaprak = (ad: string, omurSn: number): string => {
    const d0 = path.join(gecici, `ca-${ad}`);
    fs.mkdirSync(d0);
    fs.writeFileSync(path.join(d0, 'index.txt'), '');
    fs.writeFileSync(path.join(d0, 'serial'), '01\n');
    const cfg = path.join(d0, 'ca.cnf');
    fs.writeFileSync(cfg, `[ ca ]\ndefault_ca = d\n[ d ]\ndatabase = ${d0}/index.txt\nnew_certs_dir = ${d0}\nserial = ${d0}/serial\n` +
      'default_md = sha256\npolicy = p\nunique_subject = no\n[ p ]\ncommonName = supplied\n');
    const bas = new Date(Math.floor(Date.now() / 1000) * 1000 - 86_400_000);
    const zaman = (t: Date) => `${t.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
    const cikti = path.join(d0, 'yaprak.pem');
    const y = (z as unknown as { yollar: Record<string, string> }).yollar;
    execFileSync('openssl', ['ca', '-batch', '-notext', '-config', cfg, '-cert', y.kokSertifika, '-keyfile', y.kokAnahtar, '-passin', 'pass:deneme',
      '-in', y.csr, '-out', cikti, '-startdate', zaman(bas), '-enddate', zaman(new Date(bas.getTime() + omurSn * 1000)),
      '-extfile', y.profil, '-extensions', 'ota_yaprak'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return fs.readFileSync(cikti, 'utf8');
  };

  it('yaprak ömrü tavanı saniye kaymasına toleranslı: 395 gün + 1 sn KABUL, 396 gün RED', () => {
    expect(Z.yaprakHatalari(caIleYaprak('kayma', Z.OTA_YAPRAK_GUN * 86_400 + 1), z.kokPem)).toEqual([]);
    expect(Z.yaprakHatalari(caIleYaprak('uzun', (Z.OTA_YAPRAK_GUN + 1) * 86_400), z.kokPem).join('\n')).toMatch(/OTA yaprağı ömrü 396\.0 gün/);
  });

  it('basım bayrakları başlangıç ve bitişi TEK andan türetir (açık tarih) ya da -days\'e düşer', () => {
    const bas = new Date('2026-10-09T05:35:38.999Z');
    expect(Z.gecerlilikBayraklari(395, bas, true)).toEqual(['-not_before', '20261009053538Z', '-not_after', '20271108053538Z']);
    expect(Z.gecerlilikBayraklari(395, bas, false)).toEqual(['-days', '395']);
  });
});

describe('withOtaZinciri.zincirMetaYaz', () => {
  const manifest = () => ({
    manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [] as object[] }] },
  });
  const zincirOgeleri = (m: ReturnType<typeof manifest>) =>
    (m.manifest.application[0]['meta-data'] as { $: Record<string, string> }[]).filter((x) => x.$['android:name'] === Z.ZINCIR_META);

  it('zincir meta-data\'sını true yazar ve İDEMPOTENT (ikinci koşum çift öğe üretmez)', () => {
    const m = eklenti.zincirMetaYaz(eklenti.zincirMetaYaz(manifest()));
    const o = zincirOgeleri(m);
    expect(o).toHaveLength(1);
    expect(o[0].$['android:value']).toBe('true');
  });

  it('meta-data adı expo-updates 29 UpdatesConfiguration anahtarıdır', () => {
    expect(Z.ZINCIR_META).toBe('expo.modules.updates.CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN');
    const kaynak = fs.readFileSync(require.resolve('expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt', { paths: [KOK] }), 'utf8');
    expect(kaynak).toContain(`"${Z.ZINCIR_META}"`);
  });
});
