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
