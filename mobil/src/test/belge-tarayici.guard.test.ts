// =============================================================================
// BEKÇİ: ML Kit belge tarayıcısı köprüsü (mobil/modules/teks-erp-belge-tarayici)
// =============================================================================
// Native kaynak jest'te koşmaz; sözleşmenin taşıyıcı seçenekleri metinden ölçülür: galeriden içe aktarma AÇIK (kullanıcı kararı 2026-11-02)
// (aynı fotoğrafı sayfa özeti eler), çıktı JPEG, ML Kit sürümü TAM SABİT, uygunluk modül inmemişse indirmeyi hemen başlatır
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

it('modül hazır değilse indirme HEMEN başlatılır ve "yok" denir (çevrimdışı tablet kameraya düşer)', () => {
  expect(kt).toMatch(/areModulesAvailable\(scanner\)/);
  expect(kt).toMatch(/installModules\(ModuleInstallRequest\.newBuilder\(\)\.addApi\(scanner\)\.build\(\)\)/);
  expect(kt).not.toMatch(/deferredInstall\(/);
  expect(kt).toMatch(/verdict\(false, "module_missing"\)/);
});

it('JS ↔ native adları eşit', () => {
  expect(kt).toMatch(/Name\("TeksErpBelgeTarayici"\)/);
  expect(js).toMatch(/requireOptionalNativeModule<.*>\('TeksErpBelgeTarayici'\)/);
  for (const fn of ['availabilityAsync', 'scanAsync', 'enhancePageAsync']) expect(kt).toContain(`AsyncFunction("${fn}")`);
  expect(js).toMatch(/m\.enhancePageAsync\(uri, \{ longEdge: req\.longEdge, maxBytes: req\.maxBytes, quality \}\)/);
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
  // Tel dönüştürücüsü ortak (`wire`, canlı kare de kullanır): sayfanın seçilen dönüşü ona geçer ve aynen yazılır.
  expect(reader).toMatch(/wire\(pass\.text, pass\.width, pass\.height, pass\.rotation, ms\)/);
  expect(reader).toMatch(/"rotation" to rotation/);
  expect(reader).toMatch(/ExifInterface\.TAG_ORIENTATION/);
  expect(reader).toMatch(/TextRecognizerOptions\.DEFAULT_OPTIONS/);
});

it('JS ↔ native: recognizeTextAsync(uri, timeoutMs) aynı modülde, süre kuyruğa girişten', () => {
  expect(kt).toContain('AsyncFunction("recognizeTextAsync") { uri: String, timeoutMs: Int');
  expect(kt).toMatch(/val deadline = SystemClock\.elapsedRealtime\(\) \+ timeoutMs/);
  expect(ocrJs).toMatch(/requireOptionalNativeModule<.*>\('TeksErpBelgeTarayici'\)/);
  expect(ocrJs).toMatch(/recognizeTextAsync\(page\.uri, timeoutMs\)/);
});

// ── Sayfa iyileştirme + tarayıcı sayfası okuma (ölçüm 2026-11-04 arşiv notu) ───────────────────────────
const enhance = fs.readFileSync(path.join(MOD, 'android/src/main/java/com/tekserp/belgetarayici/PageEnhance.kt'), 'utf8');

it('⭐ ML Kit tarayıcı sayfası `tarayici-` önekiyle yazılır ve OCR öncesi yumuşatılır; kendi kamera sayfası dokunulmaz', () => {
  expect(reader).toMatch(/const val SCANNER_PAGE_PREFIX = "tarayici-"/);
  expect(kt).toMatch(/writePage\(context, bitmap, scan\.maxBytes, scan\.quality, TextReader\.SCANNER_PAGE_PREFIX\)/);
  expect(kt).toMatch(/File\(cacheDir\(context\), "\$prefix\$\{UUID\.randomUUID\(\)\}\.jpg"\)/);
  expect(reader).toMatch(/val upright = if \(isScannerPage\(uri\)\) softened\(loaded\) else loaded/);
  expect(reader).toMatch(/PageEnhance\.softenForOcr\(px, w, h\)/);
});

it('⭐ iyileştirme sabitleri ölçülmüş değerde: beyaz 250, siyah tavanı 60, ara ton gaması 1.8', () => {
  expect(enhance).toMatch(/const val WHITE_POINT = 250\b/);
  expect(enhance).toMatch(/const val MAX_BLACK_POINT = 60\b/);
  expect(enhance).toMatch(/const val MID_GAMMA = 1\.8\b/);
  expect(enhance).toMatch(/fun levelsLut\(black: Int, white: Int = WHITE_POINT, gamma: Double = MID_GAMMA\)/);
});

// ── Canlı kamera feneri ────────────────────────────────────────────────────────────────────────────
const liveView = fs.readFileSync(path.join(MOD, 'android/src/main/java/com/tekserp/belgetarayici/LiveCameraView.kt'), 'utf8');
const liveJs = fs.readFileSync(path.join(__dirname, '..', 'services', 'liveCamera.ts'), 'utf8');

it('⭐ canlı kamera `torch` özelliği: flaş yoksa sessiz, bağlanınca yeniden uygulanır, kapanışta söner', () => {
  expect(kt).toMatch(/Prop\("torch"\) \{ view: LiveCameraView, value: Boolean ->\s*view\.setTorch\(value\)/);
  expect(liveView).toMatch(/if \(c\.cameraInfo\.hasFlashUnit\(\)\) c\.cameraControl\.enableTorch\(on\)/);
  expect(liveView).toMatch(/bindToLifecycle[\s\S]*?if \(torch\) applyTorch\(true\)/);
  expect(liveView).toMatch(/private fun stop\(\) \{[\s\S]*?applyTorch\(false\)[\s\S]*?camera = null/);
  // Fener düğmesi yalnız `torch` bilen APK'da çizilir: native sürüm ≥ JS eşiği.
  const nativeVer = Number(kt.match(/LIVE_CAMERA_VERSION = (\d+)/)?.[1]);
  const torchVer = Number(liveJs.match(/LIVE_CAMERA_TORCH_VERSION = (\d+)/)?.[1]);
  expect(nativeVer).toBeGreaterThanOrEqual(torchVer);
});
