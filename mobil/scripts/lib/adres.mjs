// =============================================================================
// TeksERP Mobil — sunucu adresi çözümü (TEK KAYNAK)
// =============================================================================
// Hem `build-apk.mjs` (kurulum dosyası) hem `yayinla-ota.mjs` (uzaktan
// güncelleme paketi) bu dosyayı kullanır.
//
// ⚠️ NEDEN TEK KAYNAK: iki script farklı sırayla adres çözseydi, aynı gün
// derlenen APK ile yayınlanan paket FARKLI sunucuya bakabilirdi. Bu ayrışma
// hiçbir hata üretmez — tablet çalışır, güncelleme hiç gelmez ya da paket
// yanlış sunucuya konuşur. Adres çözümü bu projede iki kez ısırmış bir yerdir
// (bkz. build-apk.mjs başlığı); ikinci bir kopya üçüncü ısırığın davetidir.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

/** `.env*` dosyasını ayrıştırır (tırnak soyar, yorum/boş satır atlar). */
export function envDosyasiOku(dosya) {
  const sonuc = new Map();
  let icerik;
  try {
    icerik = fs.readFileSync(dosya, 'utf8');
  } catch {
    return sonuc;
  }
  for (const ham of icerik.split(/\r?\n/)) {
    const satir = ham.trim();
    if (!satir || satir.startsWith('#')) continue;
    const esitlik = satir.indexOf('=');
    if (esitlik < 0) continue;
    const anahtar = satir.slice(0, esitlik).trim().replace(/^export\s+/, '');
    let deger = satir.slice(esitlik + 1).trim();
    if (
      (deger.startsWith('"') && deger.endsWith('"')) ||
      (deger.startsWith("'") && deger.endsWith("'"))
    ) {
      deger = deger.slice(1, -1);
    }
    sonuc.set(anahtar, deger);
  }
  return sonuc;
}

/**
 * `.env*` dosyaları — Expo'nun kendi öncelik sırası (@expo/env:
 * `.env.<mode>.local` → `.env.local` → `.env.<mode>` → `.env`).
 * Release/export'ta mode = production.
 */
export const ENV_DOSYALARI = ['.env.production.local', '.env.local', '.env.production', '.env'];

/**
 * Adresi çözer: CLI argümanı → ortam değişkeni → `.env*` dosyaları.
 * @param {string|undefined} cliDeger `--api-url` ile verilen değer (varsa)
 * @param {string} projeKok proje kökü (mobil/)
 */
export function adresiCoz(cliDeger, projeKok) {
  if (cliDeger && cliDeger.trim()) {
    return { deger: cliDeger.trim(), kaynak: '--api-url argümanı' };
  }

  const envDeger = process.env.EXPO_PUBLIC_API_URL;
  if (envDeger && envDeger.trim()) {
    return { deger: envDeger.trim(), kaynak: 'EXPO_PUBLIC_API_URL ortam değişkeni' };
  }

  for (const ad of ENV_DOSYALARI) {
    const deger = envDosyasiOku(path.join(projeKok, ad)).get('EXPO_PUBLIC_API_URL');
    if (deger && deger.trim()) return { deger: deger.trim(), kaynak: `${ad} dosyası` };
  }

  return { deger: null, kaynak: null };
}

/** `http://10.0.0.5:4000/api` → `http://10.0.0.5:4000` (app.config.js ile AYNI kural). */
export function kokAdres(apiUrl) {
  return String(apiUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
}

/** Güncelleme manifest yolunun TEK yazımı — app.config.js ile eşleşmeli. */
export const UPDATE_PATH = '/api/mobile/updates/manifest';

/* ================================================================== *
 * GÜNCELLEME KANALI — API ADRESİNDEN AYRI
 * ================================================================== *
 * Sabitler `feed.cjs`te yaşar ve buradan yeniden dışa açılır.
 *
 * ⚠️ NEDEN CommonJS: `app.config.js` (Expo yapılandırması) CommonJS'tir ve bir
 * `.mjs` dosyasını `require` EDEMEZ. Sabiti oraya kopyalamak "iki kaynak"
 * demekti — ve bu dosyanın başındaki uyarının (üçüncü ısırık) tam olarak
 * anlattığı hata. `.cjs` dosyasını hem CommonJS `require` edebilir hem ESM
 * `import` — tek kaynak korunur.
 * ================================================================== */

export {
  YAYIN_KOKU,
  musteriOku,
  feedUrl,
  MOBIL_FEED_URL,
  MULTIPART_BOUNDARY,
  normalizeFeed,
  guncellemeAdresiCoz,
  manifestUrl,
  apkKunyeUrl,
} from './feed.cjs';
