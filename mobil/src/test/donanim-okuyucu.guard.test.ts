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

// §6 (D2) Donanım yüzleri kamerayı bağlamaz: Point Mobile kamera açılınca okuyucuyu kapatır.
const SRC = path.join(__dirname, '..');
const HW_SURFACES = [
  'components/HardwareScanPanel.tsx',
  'components/HardwareTriggerHint.tsx',
  'screens/Modules/HizliIsEmri/wizard/HardwareRollsTable.tsx',
];
it('§6 donanım yüzleri kamera bileşeni içe aktarmaz; modal kamerayı yalnız donanım dışı dalda çizer', () => {
  for (const rel of HW_SURFACES) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect({ rel, camera: /from 'expo-camera'|import \{[^}]*\bBarcodeScannerView\b[^}]*\} from/.test(src) }).toEqual({
      rel,
      camera: false,
    });
  }
  const modal = fs.readFileSync(path.join(SRC, 'components/BarcodeScannerModal.tsx'), 'utf8');
  expect(modal).toMatch(/\{hardware \? \(\s*<HardwareScanPanel[\s\S]*?\) : \(\s*<View style=\{styles\.cameraLayer\}>\s*<BarcodeScannerView/);
});

// §7 (D2b) Tek amaçlı ekranlar: OKUT görünürken kapalı tarayıcı tuşu dinler (listenWhileHidden) ve donanımda
// kamera düğmesi yerine tuş bandı/hardwareListening çizer. Liste dışı (bilinçli modal-yalnız): lisans/eşleme QR'ları.
// Bakım hattı (Adnan 1.0.x): Muayene, Çuvalsız sevk ve Gelen Belge ekranları bu ağaçta yok, listeden çıktı.
const SINGLE_PURPOSE = [
  'screens/Modules/Depo/DepoScreen.tsx',
  'screens/Modules/KartelaSevk/KartelaSevkScreen.tsx',
  'screens/Modules/HizliIsEmri/NewWorkOrderView.tsx',
  'screens/Modules/KursunQc/KursunQcScreen.tsx',
  'screens/Modules/IadeGirisi/IadeGirisiScreen.tsx',
  'screens/Modules/TartiPaket/PaketlemeScreen.tsx',
  'screens/Modules/TartiPaket/HizliSiparisScreen.tsx',
  'screens/Modules/FasonKabul/FasonKabulScreen.tsx',
  'screens/Modules/HizliIsEmri/WorkOrderAddBatchSheet.tsx',
  'screens/Auth/LoginScreen.tsx',
];
it('§7 tek amaçlı ekranlar kapalı tarayıcıyla tuşu dinler ve donanım dalı çizer', () => {
  for (const rel of SINGLE_PURPOSE) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect({
      rel,
      listens: /<(BarcodeScannerModal|LooseScanner)\b(?:(?!\/>)[\s\S]){0,1500}?\blistenWhileHidden\b/.test(src),
      hardwareBranch: /\buseHardwareScanMode\(\)|\bhardwareListening\b/.test(src),
    }).toEqual({ rel, listens: true, hardwareBranch: true });
  }
});

it('§7 AppModal açık pencere işaretini koyar ve içeriğine kapsama bağlamını verir (en üstteki pencere kuralı)', () => {
  const modal = fs.readFileSync(path.join(SRC, 'components/AppModal.tsx'), 'utf8');
  expect(modal).toMatch(/if \(!visible \|\| scanPassThrough\) return;\s*return openScanOverlay\(overlayId\);/);
  expect(modal).toMatch(/<ScanOverlayContext\.Provider value=\{within\}>\{children\}<\/ScanOverlayContext\.Provider>/);
});

// §8 (D3) Çok amaçlı ekranlar: tuş "en üstteki pencere / adımın hedefi" kuralıyla tek bir dinleyiciye gider.
// Varsayılan dinleyici kapalı tarayıcıdır; ikincil okutmalar (Kesme, Çıkan Toplar, Taşı, Etiket doğrulama)
// kendi görünür panelini açar ve üstte olduğu için okumayı o alır.
// Bakım hattı: KK1 tezgah etiketi bandı, Levent Sarım okutması ve Dokuma levent bandı bu ağaçta yok.
const MULTI_PURPOSE = [
  'screens/Modules/Tambur/TamburScreen.tsx',
  'screens/Modules/Tambur/TamburBringRollModal.tsx',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx',
  'screens/Modules/TartiPaket/CuvalDuzeltScreen.tsx',
  'components/session/PlaceConfirmView.tsx',
];
it('§8 çok amaçlı ekranlar varsayılan dinleyiciyi kurar ve donanım dalı çizer', () => {
  for (const rel of MULTI_PURPOSE) {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect({
      rel,
      listens: /<BarcodeScannerModal\b(?:(?!\/>)[\s\S]){0,1500}?\blistenWhileHidden\b/.test(src),
      hardwareBranch: /\buseHardwareScanMode\(\)|\bhardwareListening\b/.test(src),
    }).toEqual({ rel, listens: true, hardwareBranch: true });
  }
});

it('§8 ekran durumuna göre yönlenen ekran: Fason Sevk (kart ↔ top)', () => {
  const fason = fs.readFileSync(path.join(SRC, 'screens/Modules/FasonSevk/FasonSevkScreen.tsx'), 'utf8');
  expect(fason).toMatch(/visible=\{cardScannerOpen\}\s*listenWhileHidden=\{!workOrderId\}/);
  expect(fason).toMatch(/visible=\{rollScannerOpen\}\s*listenWhileHidden=\{!!workOrderId && !!stepId\}/);
});
