// =============================================================================
// BEKÇİ: ML Kit belge tarayıcısı köprüsü (mobil/modules/teks-erp-belge-tarayici)
// =============================================================================
// Native kaynak jest'te koşmaz; sözleşmenin taşıyıcı seçenekleri metinden ölçülür: galeriden içe aktarma KAPALI
// (yalnız kâğıt belge), çıktı JPEG, ML Kit sürümü TAM SABİT, uygunluk modül inmemişse indirmeyi arka plana
// bırakır (tarama beklemez), JS'in çağırdığı modül adı + işlevler native tanımla aynı.
// =============================================================================
import fs from 'fs';
import path from 'path';

const MOD = path.join(__dirname, '..', '..', 'modules', 'teks-erp-belge-tarayici');
const kt = fs.readFileSync(path.join(MOD, 'android/src/main/java/com/tekserp/belgetarayici/TeksErpBelgeTarayiciModule.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(MOD, 'android/build.gradle'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'services', 'docScannerNative.ts'), 'utf8');

it('galeri içe aktarma kapalı, çıktı yalnız JPEG', () => {
  expect(kt).toMatch(/setGalleryImportAllowed\(false\)/);
  expect(kt).not.toMatch(/setGalleryImportAllowed\(true\)/);
  expect(kt).toMatch(/setResultFormats\(GmsDocumentScannerOptions\.RESULT_FORMAT_JPEG\)/);
  expect(kt).not.toMatch(/RESULT_FORMAT_PDF/);
});

it('ML Kit tarayıcı bağımlılığı TAM SABİT (aralık/+ yok)', () => {
  const m = gradle.match(/play-services-mlkit-document-scanner:([^'"]+)['"]/);
  expect(m?.[1]).toBe('16.0.0');
});

it('modül hazır değilse indirme arka plana bırakılır ve "yok" denir (çevrimdışı tablet kameraya düşer)', () => {
  expect(kt).toMatch(/areModulesAvailable\(scanner\)/);
  expect(kt).toMatch(/deferredInstall\(scanner\)/);
  expect(kt).toMatch(/verdict\(false, "module_missing"\)/);
});

it('JS ↔ native adları eşit', () => {
  expect(kt).toMatch(/Name\("TeksErpBelgeTarayici"\)/);
  expect(js).toMatch(/requireOptionalNativeModule<.*>\('TeksErpBelgeTarayici'\)/);
  for (const fn of ['availabilityAsync', 'scanAsync']) expect(kt).toContain(`AsyncFunction("${fn}")`);
});
