// =============================================================================
// TeksERP Mobil — Expo Updates manifest ÜRETİCİSİ (TEK KAYNAK)
// =============================================================================
// Manifest'i üreten TEK yer burasıdır. Sunucu (nginx ya da fabrika backend'i)
// yalnız üretilen baytları servis eder.
//
// ⚠️ NEDEN DONDURULUYOR — kod imzalama bunu ZORUNLU kılıyor:
// `expo-updates` imzayı gövdenin HAM BAYTLARI üzerinden doğrular
// (`codesigning/CodeSigningConfiguration.kt:93-96` → SHA256withRSA). Sunucu
// manifest'i her istekte yeniden üretseydi (alan sırası, boşluk, tarih biçimi)
// baytlar değişir ve imza tutmazdı. Bu yüzden manifest yayın anında üretilir,
// imzalanır ve bir daha DEĞİŞMEZ.
//
// ⚠️ Bu, "iki ayrı protokol implementasyonu" riskini de kapatır: eskiden
// backend manifest'i render ediyordu, artık etmiyor — o da bu dosyanın
// ürettiği dosyayı servis ediyor.
// =============================================================================

// Buffer açıkça import ediliyor: proje ESLint yapılandırması RN/tarayıcı
// global'lerini varsayar, Node global'i `Buffer`ı bilmez (no-undef).
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { MULTIPART_BOUNDARY } from './feed.cjs';

const require = createRequire(import.meta.url);
const { ZINCIR_PARCASI, istemciZinciri, pemAyir, yaprakHatalari } = require('./ota-zinciri.cjs');

/* ------------------------------------------------------------------ *
 * Hash biçimleri — protokolün beklediği hâller
 * ------------------------------------------------------------------ */

const base64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Varlık bütünlüğü: base64url(SHA-256). */
const varlikHash = (buf) => base64Url(crypto.createHash('sha256').update(buf).digest('base64'));

/** İstemcideki dosya adı: MD5 hex. */
const varlikKey = (buf) => crypto.createHash('md5').update(buf).digest('hex');

/**
 * SHA-256 hex → UUID. Manifest `id`si UUID OLMAK ZORUNDA.
 *
 * ⚠️ Kimlik metadata.json'un İÇERİĞİNDEN türer, tarihten/rastgeleden değil:
 * aynı paket yeniden yayınlanınca aynı id çıkar ve istemci onu "zaten bende
 * var" diye geçer (`Loader.kt:153-169`) — gereksiz 12 MB indirme olmaz.
 */
const hexToUuid = (h) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  json: 'application/json', txt: 'text/plain', lottie: 'application/json',
};
const mimeCoz = (ext) => MIME[String(ext).replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream';

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

/**
 * `expo export` çıktısından manifest nesnesi kurar.
 *
 * @param {object} a
 * @param {string} a.paketDizin  export çıktısının bulunduğu klasör
 * @param {string} a.runtimeVersion
 * @param {string} a.damga       yayın damgası (epoch ms) — createdAt ve URL'ler bundan
 * @param {string} a.varlikTabani varlık URL'lerinin öneki (sonu `/` DEĞİL)
 * @param {object|null} a.expoConfig `extra.expoClient` olarak taşınacak yapılandırma
 */
export function manifestKur({ paketDizin, runtimeVersion, damga, varlikTabani, expoConfig }) {
  const metadataYol = path.join(paketDizin, 'metadata.json');
  const metadataBuf = fs.readFileSync(metadataYol);
  const meta = JSON.parse(metadataBuf.toString('utf8'));
  const platformMeta = meta?.fileMetadata?.android;
  if (!platformMeta?.bundle) {
    throw new Error('metadata.json android bundle yolu taşımıyor');
  }

  const varlik = (relPath, ext) => {
    const buf = fs.readFileSync(path.join(paketDizin, relPath));
    const launch = ext === null;
    return {
      hash: varlikHash(buf),
      key: varlikKey(buf),
      contentType: launch ? 'application/javascript' : mimeCoz(ext),
      fileExtension: launch ? '.bundle' : `.${String(ext).replace(/^\./, '')}`,
      url: `${varlikTabani}/${relPath}`,
    };
  };

  return {
    id: hexToUuid(crypto.createHash('sha256').update(metadataBuf).digest('hex')),
    createdAt: new Date(Number(damga)).toISOString(),
    runtimeVersion,
    launchAsset: varlik(platformMeta.bundle, null),
    assets: (platformMeta.assets ?? []).map((x) => varlik(x.path, x.ext)),
    metadata: {},
    extra: expoConfig ? { expoClient: expoConfig } : {},
  };
}

/* ------------------------------------------------------------------ *
 * İmza
 * ------------------------------------------------------------------ */

/**
 * `expo-signature` başlığının değerini üretir.
 *
 * Biçim RFC 8941 structured-header sözlüğüdür ve alan adları
 * `codesigning/SignatureHeaderInfo.kt:6-8`'de sabittir: `sig` (tırnaklı
 * dize, ZORUNLU), `keyid`, `alg`.
 *
 * ⚠️ İmzalanan şey `govde`nin BİREBİR baytlarıdır. Çağıran, imzaladığı
 * baytların AYNISINI dosyaya yazmak zorundadır — yeniden `JSON.stringify`
 * etmek (alan sırası/boşluk değişebilir) imzayı geçersiz kılar.
 */
export function imzaBasligi(govde, privateKeyPem, keyid = 'main') {
  // `privateKeyPem`: PEM dizesi ya da (parolalı OTA yaprağında) açılmış KeyObject.
  const imza = crypto.sign('RSA-SHA256', Buffer.from(govde, 'utf8'), privateKeyPem);
  return `sig="${imza.toString('base64')}", keyid="${keyid}", alg="rsa-v1_5-sha256"`;
}

/* ------------------------------------------------------------------ *
 * multipart/mixed gövdesi
 * ------------------------------------------------------------------ */

/**
 * Donmuş `multipart/mixed` gövdesini kurar.
 *
 * ⚠️ CRLF'ler ve son sınırdaki `--` ZORUNLUDUR — eksik olursa istemcinin MIME
 * ayrıştırıcısı gövdeyi hiç göremez ve durum "hata" değil "güncelleme yok"
 * olarak görünür (sessiz arıza).
 *
 * ⚠️ Sınırlayıcı SABİTTİR (`feed.cjs`): `Content-Type` başlığını nginx basıyor;
 * yayın başına değişseydi her yayında sunucu yapılandırmasına dokunmak
 * gerekirdi.
 */
export function multipartKur({ manifest, imzaBasligiDegeri, sertifikaZinciri = null }) {
  const govde = JSON.stringify(manifest);

  // Zincirli kipte (ortak tablet, K-2) yaprak PEM'i `certificate_chain` parçasında gider; gömülü OTA kökü
  // zincirin son halkasıdır (expo-updates `CodeSigningConfiguration.kt:63-66`).
  const zincir = sertifikaZinciri == null ? null : pemAyir(sertifikaZinciri).join('\n');
  if (sertifikaZinciri != null && !zincir) throw new Error('Sertifika zinciri PEM sertifika taşımıyor — parça boş giderdi.');

  for (const [ad, icerik] of [['manifest', govde], [ZINCIR_PARCASI, zincir ?? '']]) {
    if (icerik.includes(MULTIPART_BOUNDARY)) {
      // Sınırlayıcı gövdede geçerse ayrıştırıcı gövdeyi ortadan böler ve paket
      // sessizce bozulur. Ölçülemeyen bir arızayı üretmektense yayını durdur.
      throw new Error(
        `Sınırlayıcı ("${MULTIPART_BOUNDARY}") ${ad} parçasında geçiyor — paket bozulurdu.`,
      );
    }
  }

  const parca = (ad, icerik, ekBaslik, tip = 'application/json; charset=utf-8') =>
    `--${MULTIPART_BOUNDARY}\r\n` +
    `content-disposition: form-data; name="${ad}"\r\n` +
    `content-type: ${tip}\r\n` +
    (ekBaslik ? `${ekBaslik}\r\n` : '') +
    `\r\n${icerik}\r\n`;

  return Buffer.from(
    parca('manifest', govde, imzaBasligiDegeri ? `expo-signature: ${imzaBasligiDegeri}` : null) +
      parca('extensions', JSON.stringify({ assetRequestHeaders: {} }), null) +
      (zincir ? parca(ZINCIR_PARCASI, zincir, null, 'application/x-pem-file') : '') +
      `--${MULTIPART_BOUNDARY}--\r\n`,
    'utf8',
  );
}

/**
 * Üretilen gövdeyi, istemcinin yaptığı işi taklit ederek DOĞRULAR.
 * Yayın script'i bunu her koşumda çağırır — imzalı ama doğrulanmamış bir paket
 * yayınlamak, imzasız yayınlamaktan daha kötüdür (sahada sessizce reddedilir).
 *
 * `zincir: true` (ortak tablet): `sertifikaPem` APK'ya gömülü OTA KÖKÜDÜR; imzacı `certificate_chain`
 * parçasındaki yapraktır ve zincir istemci aynasıyla (`ota-zinciri.cjs istemciZinciri`, cihaz saati = `simdi`)
 * denetlenir — kökle doğrudan imza, süresi geçmiş yaprak, yabancı kök RED.
 */
export function multipartDogrula(govdeBuf, sertifikaPem, { zincir = false, simdi = new Date() } = {}) {
  const metin = govdeBuf.toString('utf8');
  const parcalar = {};
  for (const blok of metin.split(`--${MULTIPART_BOUNDARY}`)) {
    const kesim = blok.indexOf('\r\n\r\n');
    if (kesim < 0) continue;
    const basliklar = blok.slice(0, kesim);
    const ad = /name="([^"]+)"/i.exec(basliklar)?.[1];
    if (!ad) continue;
    parcalar[ad] = {
      govde: blok.slice(kesim + 4).replace(/\r\n$/, ''),
      imza: /expo-signature:\s*(.+)/i.exec(basliklar)?.[1]?.trim() ?? null,
    };
  }

  if (!parcalar.manifest) throw new Error('Doğrulama: `manifest` parçası yok');
  const man = JSON.parse(parcalar.manifest.govde);

  if (sertifikaPem) {
    if (!parcalar.manifest.imza) throw new Error('Doğrulama: imza başlığı yok');
    const sig = /sig="([^"]+)"/.exec(parcalar.manifest.imza)?.[1];
    if (!sig) throw new Error('Doğrulama: imza başlığında `sig` alanı yok');
    let anahtar = sertifikaPem;
    if (zincir) {
      const halkalar = pemAyir(parcalar[ZINCIR_PARCASI]?.govde);
      try {
        anahtar = istemciZinciri([...halkalar, String(sertifikaPem)], { simdi }).publicKey;
      } catch (e) {
        throw new Error(`Doğrulama: SERTİFİKA ZİNCİRİ GEÇERSİZ (${e.message}) — tablet bu paketi reddederdi`);
      }
      // İstemciden KATI: zincir tam olarak tek OTA yaprağıdır (CA olmayan, ≤395 gün, köke doğrudan bağlı).
      const h = halkalar.length === 1 ? yaprakHatalari(halkalar[0], String(sertifikaPem), { simdi }) : [`zincir parçası ${halkalar.length} sertifika taşıyor — tam olarak 1 OTA yaprağı olmalı`];
      if (h.length) throw new Error(`Doğrulama: OTA YAPRAĞI GEÇERSİZ (${h.join('; ')})`);
    }
    const gecerli = crypto.verify(
      'RSA-SHA256',
      Buffer.from(parcalar.manifest.govde, 'utf8'),
      anahtar instanceof crypto.KeyObject && anahtar.type === 'public' ? anahtar : crypto.createPublicKey(anahtar),
      Buffer.from(sig, 'base64'),
    );
    if (!gecerli) throw new Error('Doğrulama: İMZA GEÇERSİZ — tablet bu paketi reddederdi');
  }

  return { manifest: man, imzali: !!parcalar.manifest.imza, zincirli: !!parcalar[ZINCIR_PARCASI] };
}

/**
 * ÇAPRAZ RED — imza verilen sertifikalardan HANGİLERİYLE doğrulanıyor? Her kanalın OTA anahtarı
 * ayrıysa başka hiçbir kanalın sertifikası kabul etmez; ederse iki kanal anahtar paylaşıyordur ve
 * yanlış klasöre yüklenen paketi o kanalın tabletleri de KABUL eder.
 * @param {Buffer} govdeBuf imzalı multipart gövde
 * @param {Record<string, string>} sertifikalar kanal kodu → sertifika (ya da açık anahtar) PEM
 * @returns {string[]} imzayı KABUL eden kodlar
 */
export function imzayiKabulEdenler(govdeBuf, sertifikalar) {
  return Object.entries(sertifikalar)
    .filter(([, pem]) => {
      try {
        multipartDogrula(govdeBuf, pem);
        return true;
      } catch {
        return false;
      }
    })
    .map(([kod]) => kod);
}
