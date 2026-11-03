// =============================================================================
// BEKÇİ: ML Kit belge tarayıcısı köprüsü (mobil/modules/teks-erp-belge-tarayici)
// =============================================================================
// Native kaynak jest'te koşmaz; sözleşmenin taşıyıcı seçenekleri metinden ölçülür: galeriden içe aktarma AÇIK (kullanıcı kararı 2026-11-02)
// (aynı fotoğrafı sayfa özeti eler), çıktı JPEG, ML Kit sürümü TAM SABİT, uygunluk modül inmemişse indirmeyi arka plana
// bırakır (tarama beklemez), JS'in çağırdığı modül adı + işlevler native tanımla aynı.
// =============================================================================
import fs from 'fs';
import path from 'path';

const MOD = path.join(__dirname, '..', '..', 'modules', 'teks-erp-belge-tarayici');
const kt = fs.readFileSync(path.join(MOD, 'android/src/main/java/com/tekserp/belgetarayici/TeksErpBelgeTarayiciModule.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(MOD, 'android/build.gradle'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'services', 'docScannerNative.ts'), 'utf8');

it('galeri içe aktarma açık, çıktı yalnız JPEG', () => {
  expect(kt).toMatch(/setGalleryImportAllowed\(true\)/);
  expect(kt).not.toMatch(/setGalleryImportAllowed\(false\)/);
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

// ── Cihazda OCR (S16c) ─────────────────────────────────────────────────────────────────────────────
const reader = fs.readFileSync(path.join(MOD, 'android/src/main/java/com/tekserp/belgetarayici/TextReader.kt'), 'utf8');
const ocrJs = fs.readFileSync(path.join(__dirname, '..', 'services', 'deviceOcr.ts'), 'utf8');

it('⭐ metin tanıma GÖMÜLÜ model ve TAM SABİT (Play Hizmetleri modeli/indirme yok; aralık/+ yok)', () => {
  const m = gradle.match(/com\.google\.mlkit:text-recognition:([^'"]+)['"]/);
  expect(m?.[1]).toBe('16.0.1');
  expect(gradle).not.toMatch(/play-services-mlkit-text-recognition/);
});

it('⭐ her kelime satır sırası (`l`), 4 köşe (`c`), güven (`p`) taşır; sayfa `rotation`; EXIF yönü uygulanır', () => {
  expect(reader).toMatch(/"t" to el\.text, "c" to wc, "l" to l, "p" to conf\(el\.confidence\)/);
  expect(reader).toMatch(/"rotation" to pass\.rotation/);
  expect(reader).toMatch(/ExifInterface\.TAG_ORIENTATION/);
  expect(reader).toMatch(/TextRecognizerOptions\.DEFAULT_OPTIONS/);
});

it('JS ↔ native: recognizeTextAsync(uri, timeoutMs) aynı modülde, süre kuyruğa girişten', () => {
  expect(kt).toContain('AsyncFunction("recognizeTextAsync") { uri: String, timeoutMs: Int');
  expect(kt).toMatch(/val deadline = SystemClock\.elapsedRealtime\(\) \+ timeoutMs/);
  expect(ocrJs).toMatch(/requireOptionalNativeModule<.*>\('TeksErpBelgeTarayici'\)/);
  expect(ocrJs).toMatch(/recognizeTextAsync\(page\.uri, timeoutMs\)/);
});
