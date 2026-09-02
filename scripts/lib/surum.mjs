// =============================================================================
// TeksERP — sürüm numarası: taban GİT ETİKETİ, doğrulama YAYIN SUNUCUSU
// =============================================================================
// İki yayın kanalı (panel · tablet) aynı soruyu soruyor: "bu turda hangi
// numarayı çıkaracağım?" Cevap tek yerde yaşasın diye buraya alındı.
//
// ⚠️ TABAN GİT ETİKETİDİR, yerel dosya ya da yayın sunucusu DEĞİL.
// Numara KODA aittir, kanala değil. Taban sunucudan okunsaydı her müşteri
// kendi sayısını üretirdi ve iki farklı kod aynı numarayı taşıyabilirdi —
// "panel 1.1.1'de şu hata var" cümlesi anlamını yitirirdi. Yerel dosyadan
// okunsaydı komutun her koşumu numarayı atlatırdı (yayın komutu bir turda
// birden çok kez koşar: not kapısı kırmızı, derleme düşer, ağ kopar).
//
// ⚠️ AMA ETİKET DEFTERİ BAYATLAYABİLİR (başka makineden yayın yapıldı,
// etiket itilmedi, depo yeniden klonlandı). O yüzden hesaplanan numara
// yayındakiyle KIYASLANIR: yayındaki daha büyükse durulur. Etiket KARAR
// verir, sunucu DOĞRULAR — ikisi ayrı iş.
//
//   yalnız YAMA hanesi otomatiktir. Küçük/büyük hane bir KARARDIR
//   (sözleşme kırıldı mı, sahaya ne anlatılacak) ve komuta elle yazılır.
// =============================================================================

import { execFileSync } from 'node:child_process';

/* ------------------------------------------------------------------ *
 * semver aritmetiği
 * ------------------------------------------------------------------ */

/** "1.2.3" → [1,2,3]; biçim tutmazsa null. */
export function ayristir(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** semver kıyası: a<b → -1, a===b → 0, a>b → 1. Ayrıştırılamayan taraf null. */
export function karsilastir(a, b) {
  const x = ayristir(a);
  const y = ayristir(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/** "1.0.0" → "1.0.1". Ayrıştırılamazsa null. */
export function yamaArtir(s) {
  const v = ayristir(s);
  return v ? `${v[0]}.${v[1]}.${v[2] + 1}` : null;
}

/* ------------------------------------------------------------------ *
 * Git etiketi — sürüm çizgisinin defteri
 * ------------------------------------------------------------------ */

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** `panel` → `panel-v1.1.1`. Ad üretimi ve okuma TEK kalıptan. */
export function etiketAdi(onEk, surum) {
  return `${onEk}-v${surum}`;
}

/**
 * Bu çizginin EN YÜKSEK etiketi.
 *
 * ⚠️ Sıralama SAYISAL. Sözlüksel bir sıra `v1.1.9`u `v1.1.10`dan büyük
 * gösterir ve sonraki numara GERİ giderdi.
 *
 * @returns {{surum: string, commit: string|null} | null}
 */
export function sonEtiket(onEk) {
  let satirlar;
  try {
    satirlar = git('tag', '--list', `${onEk}-v*`).split('\n').filter(Boolean);
  } catch {
    return null; // git yok / depo değil
  }
  let enIyi = null;
  for (const t of satirlar) {
    const surum = t.slice(`${onEk}-v`.length);
    if (!ayristir(surum)) continue;
    if (!enIyi || karsilastir(surum, enIyi) > 0) enIyi = surum;
  }
  if (!enIyi) return null;
  let commit = null;
  try {
    commit = git('rev-list', '-n', '1', etiketAdi(onEk, enIyi));
  } catch {
    /* commit çözülemedi — sürüm yine kullanılabilir */
  }
  return { surum: enIyi, commit };
}

/** HEAD'in commit'i. Depo değilse null. */
export function basCommit() {
  try {
    return git('rev-parse', 'HEAD');
  } catch {
    return null;
  }
}

/**
 * Bu turda kullanılacak sürüm.
 *
 * ⚠️ "HEAD etiketin üstündeyse KORU" kuralı iki işi birden görüyor:
 *  ① İDEMPOTENSİ — komut bir turda birden çok kez koşar; her koşumda artıran
 *    bir kural numaraları atlatır (operatör 1.1.1 için not yazarken sistem
 *    1.1.3'e geçmiş olur).
 *  ② AYNI TURDA İKİNCİ MÜŞTERİ — yayın adresi pakete derleme anında
 *    gömüldüğü için her müşteri AYRI derleme ister; ama ikisi de AYNI kodun
 *    yayınıdır, yani aynı numarayı taşımalıdır. Yayından hemen sonra HEAD
 *    hâlâ etiketin üstündedir → numara korunur.
 *
 * Kod ilerlediği anda (yeni commit) HEAD etiketten ayrılır ve numara artar.
 *
 * @returns {{surum: string|null, artti: boolean, gerekce: string}}
 */
export function sonrakiSurumEtiketten(onEk) {
  const etiket = sonEtiket(onEk);
  if (!etiket) {
    return {
      surum: null,
      artti: false,
      gerekce: `'${onEk}-v*' kalıbında hiç etiket yok`,
    };
  }
  const bas = basCommit();
  if (etiket.commit && bas && etiket.commit === bas) {
    return {
      surum: etiket.surum,
      artti: false,
      gerekce: `HEAD ${etiketAdi(onEk, etiket.surum)} etiketinde — aynı tur, numara korundu`,
    };
  }
  const yeni = yamaArtir(etiket.surum);
  if (!yeni) {
    return { surum: null, artti: false, gerekce: `son etiket okunamadı (${etiket.surum})` };
  }
  return { surum: yeni, artti: true, gerekce: `son etiket ${etiket.surum} → ${yeni}` };
}

/**
 * ETİKET DEFTERİ BAYAT MI — hesaplanan numara yayındakinden büyük olmalı.
 *
 * Bayatlığın gerçek yolu var: başka bir makineden yayın yapıldı ve etiket
 * itilmedi; ya da depo yeniden klonlandı. O durumda taban geride kalır ve
 * YAYINDAKİ BİR NUMARANIN ÜSTÜNE yazılır — `latest.yml` sahadakinden ESKİ bir
 * paketi gösterir ve filo takılır.
 *
 * ⚠️ Yayın okunamazsa (internet yok) SESSİZ GEÇİLİR: bu bir doğrulama, kapı
 * değil. Kapıya çevirmek, internetsiz ortamda paketlemeyi imkânsız kılardı.
 *
 * ⚠️ EŞİTLİK AYRI BİR DURUMDUR, 'bayat' değil. İki farklı sebebi olabilir ve
 * ikisi de meşrudur: (a) son yayından beri hiçbir şey değişmedi, (b) yükleme
 * yarıda kaldı, aynı sürüm tekrar deneniyor. İkisini de "defter bayat" diye
 * anlatmak yanlış teşhis olurdu — mesajlar ayrı, davranış aynı: DUR. Aynı
 * numaranın üstüne farklı kod yazmak, düzeltmeye çalıştığımız arızanın ta
 * kendisidir. Çıkış yolu sürümü elle vermek.
 *
 * @returns {{durum: 'temiz'|'zaten-yayinda'|'bayat'|'olculemedi', yayinda: string|null}}
 */
export function etiketDefteriKiyasla(hesaplanan, yayinda) {
  if (!yayinda || !ayristir(yayinda)) return { durum: 'olculemedi', yayinda };
  const k = karsilastir(hesaplanan, yayinda);
  if (k === null) return { durum: 'olculemedi', yayinda };
  if (k > 0) return { durum: 'temiz', yayinda };
  return { durum: k === 0 ? 'zaten-yayinda' : 'bayat', yayinda };
}

/**
 * Yayın BİTTİKTEN sonra etiketi atar.
 *
 * ⚠️ BEST-EFFORT: yayın zaten yapıldı. Etiketleme düşerse hata değil UYARI —
 * başarılı bir yayını "etiket atılamadı" diye başarısız göstermek, operatörü
 * yayını tekrarlamaya iter.
 *
 * ⚠️ VAR OLAN ETİKETE DOKUNULMAZ (aynı turda ikinci müşteri): `-f` ile
 * taşımak, etiketin işaret ettiği kodu sessizce değiştirir.
 *
 * @returns {{durum: 'atildi'|'zaten-var'|'basarisiz', ad: string, not?: string}}
 */
export function etiketAt(onEk, surum) {
  const ad = etiketAdi(onEk, surum);
  try {
    if (git('tag', '--list', ad)) return { durum: 'zaten-var', ad };
    git('tag', '-a', ad, '-m', `${onEk} ${surum}`);
  } catch (e) {
    return { durum: 'basarisiz', ad, not: e?.message ?? String(e) };
  }
  // Uzağa itmek ayrı ve yine best-effort: etiket yerelde durduğu sürece bir
  // sonraki tur doğru sayar; uzak yalnız paylaşım/ikinci makine içindir.
  try {
    git('push', 'origin', ad);
  } catch {
    return { durum: 'atildi', ad, not: `uzağa itilemedi — git push origin ${ad}` };
  }
  return { durum: 'atildi', ad };
}

/* ------------------------------------------------------------------ *
 * Yayındaki sürümü okuma (yalnız DOĞRULAMA için)
 * ------------------------------------------------------------------ */

const ZAMAN_ASIMI_MS = 12_000;

/** Önbellek kırıcı — CF kenarı eski cevabı tutuyor olabilir. */
function tazeUrl(url) {
  return url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now();
}

async function getir(url, basliklar = {}) {
  const kontrol = new AbortController();
  const zamanlayici = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const y = await fetch(tazeUrl(url), { signal: kontrol.signal, headers: basliklar });
    if (!y.ok) return null;
    return await y.text();
  } catch {
    return null;
  } finally {
    clearTimeout(zamanlayici);
  }
}

/**
 * Expo manifest gövdesinden (`multipart/mixed`) sürümü çıkarır.
 *
 * ⚠️ "İlk `{` ile son `}` arası" kestirmesi ÇALIŞMAZ: gövde İKİ parça taşır
 * (`manifest` + `extensions`) ve ikisini tek JSON sanıp ayrıştırma hatası
 * verir (ölçüldü). Ham gövdede regex ile "version" aramak da yanlış olurdu —
 * `expoClient` içinde `sdkVersion` ve `runtimeVersion` de var.
 */
export function manifestGovdesindenSurum(govde) {
  if (!govde) return null;
  const parcalar = govde.split(/\r?\n?--[A-Za-z0-9'()+_,./:=?-]+(?:--)?\r?\n/);
  const manifestParcasi = parcalar.find((p) => /name="manifest"/.test(p)) ?? parcalar[0];
  if (!manifestParcasi) return null;
  const bas = manifestParcasi.indexOf('{');
  if (bas < 0) return null;
  try {
    const manifest = JSON.parse(manifestParcasi.slice(bas).trim());
    const v = manifest?.extra?.expoClient?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Panelin yayındaki sürümü — `latest.yml` içindeki `version:` satırı. */
export async function yayindakiPanelSurumu(kanalKoku) {
  const govde = await getir(kanalKoku.replace(/\/?$/, '/') + 'latest.yml');
  if (!govde) return null;
  const m = /^version:\s*(\S+)\s*$/m.exec(govde);
  return m ? m[1].replace(/^['"]|['"]$/g, '') : null;
}

/** Tabletin yayındaki paket sürümü — OTA manifestinin `extra.expoClient`i. */
export async function yayindakiTabletSurumu(manifestUrl, runtimeVersion) {
  return manifestGovdesindenSurum(
    await getir(manifestUrl, {
      'expo-runtime-version': String(runtimeVersion),
      'expo-platform': 'android',
      accept: 'multipart/mixed',
    }),
  );
}

/** Yayındaki KURULUM DOSYASININ (APK) künyesi. Hiç yayınlanmadıysa null. */
export async function yayindakiApkKunyesi(kanalKoku) {
  const govde = await getir(kanalKoku.replace(/\/?$/, '/') + 'apk/surum.json');
  if (!govde) return null;
  try {
    return JSON.parse(govde);
  } catch {
    return null;
  }
}
