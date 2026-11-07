// =============================================================================
// BEKÇİ: el terminali okuyucu köprüsü (mobil/modules/teks-erp-donanim-okuyucu)
// =============================================================================
// Native kaynak jest'te koşmaz; sözleşme metinden ölçülür: modül adı + JS'in beklediği işlevler native tanımla
// aynı, alıcı API 33+ RECEIVER_EXPORTED, ön/arka plan yayınları native yaşam döngüsünde gönderilir (JS askıdayken
// okuyucu önceki moduna dönmeli), sorgulanan paketler manifest <queries> ile aynı küme, QUERY_ALL_PACKAGES yok,
// ve donanım okuyucuda kamera açan yerel kod yok.
// NEGATİF SONDA (2026-11-07): Kotlin'de `OnActivityEntersBackground` gövdesinden `sendAll(backgroundBroadcasts)`
// silinince §3 kırmızı; QUERIED_PACKAGES'a paket eklenip manifeste eklenmeyince §4 kırmızı.
// =============================================================================
import fs from 'fs';
import path from 'path';

import { QUERIED_PACKAGES } from '../services/hardwareScanner/adapters';

const MOD = path.join(__dirname, '..', '..', 'modules', 'teks-erp-donanim-okuyucu');
const kt = fs.readFileSync(
  path.join(MOD, 'android/src/main/java/com/tekserp/donanimokuyucu/TeksErpDonanimOkuyucuModule.kt'),
  'utf8',
);
const manifest = fs.readFileSync(path.join(MOD, 'android/src/main/AndroidManifest.xml'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(MOD, 'expo-module.config.json'), 'utf8'));
const js = fs.readFileSync(path.join(__dirname, '..', 'services', 'hardwareScanner', 'native.ts'), 'utf8');

it('§1 JS ↔ native ad ve işlevler eşit', () => {
  expect(config.android.modules).toEqual(['com.tekserp.donanimokuyucu.TeksErpDonanimOkuyucuModule']);
  expect(kt).toMatch(/Name\("TeksErpDonanimOkuyucu"\)/);
  expect(kt).toMatch(/Events\("onIntent"\)/);
  expect(js).toMatch(/requireOptionalNativeModule<.*>\('TeksErpDonanimOkuyucu'\)/);
  for (const fn of ['getCapabilities', 'configure', 'sendBroadcast', 'startActivity', 'launchPackage']) {
    expect(kt).toContain(`Function("${fn}")`);
    expect(js).toContain(`'${fn}'`);
  }
});

it('§2 alıcı API 33+ RECEIVER_EXPORTED (okuyucu hizmeti ayrı süreç)', () => {
  expect(kt).toMatch(/SDK_INT >= 33\) ctx\.registerReceiver\(r, filter, Context\.RECEIVER_EXPORTED\)/);
});

it('§3 yaşam döngüsü: arka planda native geri yükler + alıcıyı kaldırır; ön planda yeniden kurar', () => {
  const bg = kt.match(/OnActivityEntersBackground \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  expect(bg).toContain('sendAll(backgroundBroadcasts)');
  expect(bg).toContain('unregister()');
  const fg = kt.match(/OnActivityEntersForeground \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  expect(fg).toContain('register()');
  expect(fg).toContain('sendAll(foregroundBroadcasts)');
});

it('§4 sorgulanan paketler = manifest <queries>; QUERY_ALL_PACKAGES yok', () => {
  const declared = [...manifest.matchAll(/<package android:name="([^"]+)"/g)].map((m) => m[1]).sort();
  expect(declared).toEqual([...QUERIED_PACKAGES].sort());
  expect(manifest).not.toMatch(/uses-permission[^>]*QUERY_ALL_PACKAGES/);
});

it('§5 köprü kamera açmaz, SDK jar paketlemez', () => {
  expect(kt).not.toMatch(/camera/i);
  expect(kt).not.toMatch(/device\.sdk/);
  expect(manifest).not.toMatch(/uses-library/);
});
