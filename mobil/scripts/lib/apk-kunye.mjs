// =============================================================================
// TABLET APK KÜNYESİ — imzalı yayın künyesi (`typ: tekserp-apk`) · yayın makinesi tarafı (node:crypto)
// =============================================================================
// `apk/surum.json` imzasızdı: tablet `indirmeUrl`i koşulsuz izliyor, sha256'yı hiç ölçmüyordu. Künye artık
// aynı dosyada `tekserp: {v: 1, bildirim: <JWS>}` bloğu taşır (panelin latest.yml bloğuyla aynı kalıp; eski tablet
// bilmediği alanı yok sayar ve `indirmeUrl` ile bugünkü gibi indirir). JWS kuralları panel/lisans aynası
// (`Electron/electron/guncelleme/kunye-jws.mjs`). Tabletin doğrulayıcısı bağımlılıksız TS'tir
// (`mobil/src/services/apkKunye.ts`, saf JS Ed25519 + SHA-256); bu dosya imza aracı ve yayın kapısı içindir.
// Kâhin: `mobil/src/test/apkKunye.test.ts` — bu dosyanın imzaladığını tabletin doğrulayıcısı kabul eder.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import {
  anchorLookup, checkProductionAnchor, fail, isPlainObject, isSignerKid, ok, parseJws, signJwsCompact, verifyJwsWithAnchor,
} from '../../../Electron/electron/guncelleme/kunye-jws.mjs';

export const APK_RELEASE_TYP = 'tekserp-apk';
export const APK_KUNYE_ALANI = 'tekserp';
export const APK_DOC_VERSION = 1;
export const APK_PRODUCT = 'tablet';
export const APK_PLATFORM = 'android-arm64';
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const APK_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const ANCHOR_MAX = 16;

export const apkDosyaAdi = (versionName, versionCode) => `TeksERP-${versionName}-vc${versionCode}.apk`;

/** Künye yükü (v:1) — bilinen alanlar katı, bilinmeyen alan YOK SAYILIR (ileri uyum, panel kuralı). */
export function decodeApkDoc(p) {
  if (!isPlainObject(p)) return fail('BELGE_SEMA', 'Künye bir JSON nesnesi değil');
  if (p.v !== APK_DOC_VERSION) return fail('BELGE_SURUM', `Desteklenmeyen künye sürümü: ${String(p.v)}`);
  const a = isPlainObject(p.paket) ? p.paket : null;
  const bad = [];
  if (p.urun !== APK_PRODUCT) bad.push('urun');
  if (p.platform !== APK_PLATFORM) bad.push('platform');
  if (typeof p.kanal !== 'string' || !CHANNEL_PATTERN.test(p.kanal)) bad.push('kanal');
  if (!Number.isSafeInteger(p.versionCode) || p.versionCode < 1 || p.versionCode > 999999999) bad.push('versionCode');
  if (typeof p.versionName !== 'string' || !VERSION_PATTERN.test(p.versionName)) bad.push('versionName');
  if (typeof p.commit !== 'string' || !COMMIT_PATTERN.test(p.commit)) bad.push('commit');
  if (typeof p.yayinZamani !== 'string' || !ISO_PATTERN.test(p.yayinZamani) || Number.isNaN(Date.parse(p.yayinZamani))) bad.push('yayinZamani');
  if (!Array.isArray(p.capa) || p.capa.length === 0 || p.capa.length > ANCHOR_MAX || !p.capa.every(isSignerKid) || new Set(p.capa).size !== p.capa.length) bad.push('capa');
  if (!a) bad.push('paket');
  else {
    if (typeof a.ad !== 'string' || a.ad !== apkDosyaAdi(p.versionName, p.versionCode)) bad.push('paket.ad');
    if (!Number.isSafeInteger(a.boyut) || a.boyut < 1 || a.boyut > APK_MAX_BYTES) bad.push('paket.boyut');
    if (typeof a.sha256 !== 'string' || !SHA256_HEX.test(a.sha256)) bad.push('paket.sha256');
  }
  if (bad.length) return fail('BELGE_SEMA', `Künye alanları geçersiz: ${bad.join(', ')}`);
  return ok({
    v: APK_DOC_VERSION,
    urun: APK_PRODUCT,
    platform: APK_PLATFORM,
    kanal: p.kanal,
    versionCode: p.versionCode,
    versionName: p.versionName,
    commit: p.commit,
    yayinZamani: p.yayinZamani,
    paket: { ad: a.ad, boyut: a.boyut, sha256: a.sha256 },
    capa: [...p.capa],
  });
}

/** Künyeyi kurar ve AYNI şemadan geçirir (doğrulayan ne kabul ediyorsa imzalayan yalnız onu üretir). */
export function buildApkDoc({ kanal, versionCode, versionName, commit, yayinZamani, paket, capa }) {
  const d = decodeApkDoc({
    v: APK_DOC_VERSION, urun: APK_PRODUCT, platform: APK_PLATFORM, kanal, versionCode, versionName, commit, yayinZamani,
    paket: isPlainObject(paket) ? { ad: paket.ad, boyut: paket.boyut, sha256: paket.sha256 } : paket, capa,
  });
  if (!d.ok) throw new Error(`buildApkDoc: ${d.message}`);
  return d.value;
}

export function signApkDoc({ doc, kid, privateKey }) {
  const d = decodeApkDoc(doc);
  if (!d.ok) throw new Error(`signApkDoc: ${d.message}`);
  return signJwsCompact({ typ: APK_RELEASE_TYP, kid, payload: d.value, privateKey });
}

/**
 * surum.json'ın İMZASIZ alanları (eski tabletin okuduğu) künyeyle birebir mi? Ayrışırsa eski tablet başka
 * dosyayı indirirdi, yeni tablet reddederdi — iki kuşak aynı yayında farklı şey görmesin.
 */
export function checkApkSurumJson(doc, s) {
  const off = [];
  if (s.versionCode !== doc.versionCode) off.push('versionCode');
  if (s.versionName !== doc.versionName) off.push('versionName');
  if (s.dosya !== doc.paket.ad) off.push('dosya');
  if (s.sha256 !== doc.paket.sha256) off.push('sha256');
  if (s.boyut !== doc.paket.boyut) off.push('boyut');
  return off.length ? fail('KUNYE_DOSYA', `surum.json alanları imzalı künyeyle uyuşmuyor: ${off.join(', ')}`) : ok(true);
}

/** surum.json (nesne) → doğrulanmış künye + imzalayan kid. Sıra: blok → çapa → JWS → şema → kanal → bağ. */
export function verifyApkSurumJson(s, { keys, channel }) {
  const anchor = anchorLookup(keys);
  if (!anchor.ok) return anchor;
  if (!isPlainObject(s)) return fail('KUNYE_BICIM', 'surum.json bir JSON nesnesi değil');
  const block = s[APK_KUNYE_ALANI];
  if (block === undefined || block === null) return fail('KUNYE_YOK', 'surum.json imzalı künye taşımıyor');
  if (!isPlainObject(block) || Object.keys(block).some((k) => k !== 'v' && k !== 'bildirim') || typeof block.bildirim !== 'string') {
    return fail('KUNYE_BICIM', 'Künye bloğu biçimsiz');
  }
  if (block.v !== APK_DOC_VERSION) return fail('BELGE_SURUM', `Desteklenmeyen künye bloğu sürümü: ${String(block.v)}`);
  const j = verifyJwsWithAnchor(block.bildirim, { typ: APK_RELEASE_TYP, keys });
  if (!j.ok) return j;
  const d = decodeApkDoc(j.value.payload);
  if (!d.ok) return d;
  if (d.value.kanal !== channel) return fail('KUNYE_KANAL', `Künye "${d.value.kanal}" kanalının, hedef "${channel}"`);
  const b = checkApkSurumJson(d.value, s);
  return b.ok ? ok({ doc: d.value, kid: j.value.header.kid }) : b;
}

/** Künye bloğunu surum.json nesnesine yazar (varsa değiştirir). */
export function withApkBlock(s, token) {
  const { [APK_KUNYE_ALANI]: _eski, ...geri } = s;
  return { ...geri, [APK_KUNYE_ALANI]: { v: APK_DOC_VERSION, bildirim: token } };
}

// ── Yayın kapısı yüklemleri (`deploy/mobil-yayinla.mjs`) ─────────────────────
/** Tabletin JS paketine gömülen çapa — depo köküne göre. */
export const APK_CAPA_REL = 'mobil/src/lib/apk-imza-capasi.json';

/** Ağacın tablet çapası (`[{kid, x}]`); okunamaz/biçimsizse ATAR — çağıran ÖLÇÜLEMEDİ der. */
export function apkCapasiOku(kok) {
  const j = JSON.parse(fs.readFileSync(path.join(kok, APK_CAPA_REL), 'utf8'));
  if (!isPlainObject(j) || !Array.isArray(j.anahtarlar)) throw new Error(`${APK_CAPA_REL}: anahtarlar dizisi yok`);
  return j.anahtarlar;
}

/** Çapanın durumu: `bos` (anahtar kararı bekliyor) · `uyumlu` (üretim biçiminde) · `ihlal`. */
export function apkCapaDenetimi(liste) {
  if (liste.length === 0) {
    return { sonuc: 'bos', satirlar: [`${APK_CAPA_REL} BOŞ — bu JS'li tabletler hiçbir APK güncellemesini doğrulayamaz (kurmaz)`] };
  }
  const c = checkProductionAnchor(liste);
  return c.ok
    ? { sonuc: 'uyumlu', satirlar: [`tablet imza çapası: ${liste.map((k) => k.kid).join(', ')}`] }
    : { sonuc: 'ihlal', satirlar: [`tablet imza çapası kullanılamaz (${c.code}): ${c.message}`] };
}

/**
 * JS paketinde (Hermes bayt kodu ya da düz JS — ASCII dizeler bitişik durur) çapanın her satırı (kid + x) var mı?
 * Eksik kid'leri döner: boş değilse paket ağacın çapasıyla DERLENMEMİŞ (bayat paket).
 */
export function apkCapaGomuluFarki(bundleMetni, liste) {
  return liste.filter((k) => !bundleMetni.includes(k.kid) || !bundleMetni.includes(k.x)).map((k) => k.kid);
}

/**
 * ROTASYON KİLİDİ — sahadaki tablet sonraki APK'yı KENDİ gömülü çapasıyla doğrular. Yayındaki surum.json künyeliyse
 * yeni imzalayan onun `capa`sında olmalı. Yayındaki dosya ayrıştırılamazsa ATAR (ÖLÇÜLEMEDİ).
 */
export function apkRotasyonDenetimi({ yayindaki, yeniKid }) {
  if (yayindaki === null || yayindaki.trim() === '') return { sonuc: 'uyumlu', satirlar: ['kanalda APK yayını yok — rotasyon kısıtı yok'] };
  let s;
  try {
    s = JSON.parse(yayindaki);
  } catch {
    throw new Error('yayındaki apk/surum.json ayrıştırılamadı');
  }
  const blok = isPlainObject(s) ? s[APK_KUNYE_ALANI] : undefined;
  if (blok === undefined || blok === null) {
    return { sonuc: 'uyumlu', satirlar: [`yayındaki vc ${String(s?.versionCode)} künyesiz (imza denetlemeyen tablet) — ilk imzalı APK ona normal gelir`] };
  }
  const j = parseJws(isPlainObject(blok) ? blok.bildirim : null);
  const capa = j.ok && Array.isArray(j.value.payload.capa) ? j.value.payload.capa : null;
  if (!capa) throw new Error(`yayındaki vc ${String(s.versionCode)} künyesinin çapa listesi okunamadı`);
  if (!capa.includes(yeniKid)) {
    return {
      sonuc: 'ihlal',
      satirlar: [
        `yayındaki vc ${String(s.versionCode)} tabletleri yalnız [${capa.join(', ')}] anahtarlarını tanır; ${yeniKid} ile imzalanan APK'yı KURMAZLAR`,
        'Rotasyon: yeni kid önce çapaya eklenir, OTA + ESKİ anahtarla imzalı APK ile sahaya çıkar; ancak sonra yeni anahtarla imzalanır.',
      ],
    };
  }
  return { sonuc: 'uyumlu', satirlar: [`rotasyon: ${yeniKid} yayındaki vc ${String(s.versionCode)} çapasında`] };
}
