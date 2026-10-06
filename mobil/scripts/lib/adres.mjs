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
 * Adresi çözer: CLI argümanı → ortam değişkeni → KANAL KAYDI → `.env*` dosyaları.
 * Kanal verildiğinde `.env*` okunmaz: kanalın ERP adresi kayıt defterindedir
 * (`deploy/kanallar.json`); açık verilen değer onunla eşit olmak zorundadır (çağıran ölçer).
 * @param {string|undefined} cliDeger `--api-url` ile verilen değer (varsa)
 * @param {string} projeKok proje kökü (mobil/)
 * @param {{ kod: string, erpAdresi: string }} [kanal] derlenen kanal
 */
export function adresiCoz(cliDeger, projeKok, kanal) {
  if (cliDeger && cliDeger.trim()) {
    return { deger: cliDeger.trim(), kaynak: '--api-url argümanı' };
  }

  const envDeger = process.env.EXPO_PUBLIC_API_URL;
  if (envDeger && envDeger.trim()) {
    return { deger: envDeger.trim(), kaynak: 'EXPO_PUBLIC_API_URL ortam değişkeni' };
  }

  if (kanal?.erpAdresi) {
    return { deger: kanal.erpAdresi, kaynak: `kanal kaydı "${kanal.kod}" (deploy/kanallar.json)` };
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

/**
 * Bir JS bundle'ının (Hermes; `latin1` okunmuş) taşıdığı ERP adresleri — "beklenen
 * adres var mı, yanında BAŞKA bir sayısal-IP sunucu var mı" sorusunun TEK ölçümü.
 * APK derlemesi, OTA üretimi ve yayın kapısı aynı yüklemi kullanır.
 *
 * ⚠️ Hermes dizeleri UÇ UCA paketler (sonlandırıcı yok): "/api'den sonra harf
 * gelmesin" sondajı gerçek adresi bile eler — bu yüzden lookahead YOK.
 * ⚠️ Yalnız ASCII aranır (Türkçe karakterli dizeler UTF-16 tablosuna gider).
 */
export function bundleAdresOlcumu(metin, beklenenAdres) {
  const gecenSayi = beklenenAdres ? metin.split(beklenenAdres).length - 1 : 0;
  const bulunanlar = [...new Set(metin.match(/https?:\/\/[A-Za-z0-9._-]+(?::\d{2,5})?\/api/g) ?? [])];
  // Sayısal IP taşıyan FARKLI bir /api adresi = bayat ya da başka kanalın sunucusu.
  const yabanciIp = bulunanlar.filter(
    (u) => u !== beklenenAdres && /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/.test(u),
  );
  return { gecenSayi, bulunanlar, yabanciIp };
}

/**
 * Ortak paketin bundle'ında ERP adresi YOK: sayısal IP'li, portlu ya da tailnet (`.ts.net`) bir `/api`
 * adresi = bir fabrikanın sunucusu gömülmüş (bayat .env, ortam sızıntısı). Yerel geri dönüş
 * (localhost) bugün koddadır ve sunucu bulma ekranı gelene dek (O8) bilgi olarak geçer.
 */
const YEREL_HOSTLAR = new Set(['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2']);
export function ortakBundleAdresleri(metin) {
  const { bulunanlar } = bundleAdresOlcumu(metin, null);
  const gomulu = bulunanlar.filter((u) => {
    const m = /^https?:\/\/([A-Za-z0-9._-]+)(:\d{2,5})?\/api$/.exec(u);
    if (!m || YEREL_HOSTLAR.has(m[1].toLowerCase())) return false;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(m[1]) || Boolean(m[2]) || /\.ts\.net$/i.test(m[1]);
  });
  return { gomulu, diger: bulunanlar.filter((u) => !gomulu.includes(u)) };
}

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
