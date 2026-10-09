// =============================================================================
// PAROLA KASASI — tören/imza parolaları macOS Anahtar Zinciri'nden, sorusuz (kullanıcı kararı 2026-10-08)
// =============================================================================
// TEK KAYNAK: katalog (hangi parola hangi hizmet adında), hesap, kayıt biçimi ve `security` çağrısı burada.
// TS araçlarının ortak girdisi (`Teks-Erp/scripts/lib/cli-girdi.ts` ve bayt-eşit satıcı aynası) aynı mantığın TEK TS
// kopyasını taşır (satıcı imajı repo kökünü görmez); eşitliği `scripts/test_parola_kasasi.mjs` ölçer.
// Değer argv'ye, ekrana, loga, hata iletisine ve ortam değişkenine GİRMEZ; yalnız sürecin belleğinde Buffer olarak döner.
// Ortam anahtarı TEKSERP_PAROLA_KASASI: boş → macOS'ta açık · `kapali` → hiç sorulmaz · `sahte:<geçici dizinde betik>`
// → yalnız bekçi (gerçek Anahtar Zinciri'ne giden yol o dalda yoktur).
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const KASA_ORTAM = 'TEKSERP_PAROLA_KASASI';
export const KASA_KOMUTU = '/usr/bin/security';
export const KASA_HESAP = 'tekserp';
export const KASA_ONEK = 'tekserp/';
/** Kayıt biçimi: `tkp1:` + UTF-8 baytlarının küçük harf hex'i — `security -w` ASCII dışı parolayı hex basar, belirsizlik kalmasın. */
export const KASA_BICIM = 'tkp1:';
/** `security find-generic-password` "kayıt yok" çıkışı (errSecItemNotFound). */
export const KASA_BULUNAMADI = 44;
export const KAYIT_KOMUTU = 'node scripts/parola-kaydet.mjs';

/** Hizmet adları kataloğu — `tekserp/<ad>`, hesap `tekserp`. Yeni ad yalnız buraya + TS kopyasındaki `KASA_ADLARI`na. */
export const KASA_KATALOGU = Object.freeze({
  kok: Object.freeze({ ad: 'Satıcı KÖK parolası (kok-*)', min: 12, kullanan: 'uretim-toren toren/donem · satıcı anahtar.ts · ota-zinciri (OTA kökü)' }),
  ara: Object.freeze({ ad: 'Ara imzacı parolası (dönem töreninin yeni ara-<yıl>-<n>)', min: 12, kullanan: 'uretim-toren donem · satıcı anahtar.ts ara-uret' }),
  paket: Object.freeze({ ad: 'PAKET (backend paketi) imza parolası (paket-* · pkt-*)', min: 12, kullanan: 'build-korumali-imza · backend-bildirim · backend-yayinla · uretim-toren donem --paket' }),
  istemci: Object.freeze({ ad: 'İSTEMCİ parolası (panel künyesi ist-* + tablet OTA yaprağı)', min: 12, kullanan: 'panel-imza · ota-zinciri · mobil-grup-yayinla · uretim-toren donem --istemci' }),
  yedek: Object.freeze({ ad: 'YEDEK anahtar parolası (istemci + paket yedeği, ortak)', min: 12, kullanan: 'uretim-toren donem / *-yedek-dogrula · araçlarda --kasa=yedek' }),
  'play-yukleme': Object.freeze({ ad: 'Google Play yükleme keystore parolası', min: 6, kullanan: 'mobil build-apk --aab (Gradle + keytool)' }),
});
export const KASA_ADLARI = Object.freeze(Object.keys(KASA_KATALOGU));

export class KasaHatasi extends Error {}

function tanim(ad) {
  const t = Object.hasOwn(KASA_KATALOGU, ad) ? KASA_KATALOGU[ad] : undefined;
  if (!t) throw new KasaHatasi(`Tanınmayan kasa adı: ${String(ad).slice(0, 40)} (bilinen: ${KASA_ADLARI.join(', ')})`);
  return t;
}

export const kasaHizmeti = (ad) => (tanim(ad), `${KASA_ONEK}${ad}`);

/** Kasada kayıt yokken basılan ipucu: kayıt komutunun ADI, değer değil. */
export const kasaIpucu = (ad) => `Anahtar Zinciri'nde ${kasaHizmeti(ad)} kayıtlı değil — kendi Terminal'inde kaydet: ${KAYIT_KOMUTU} ${ad}`;

/** Üretim kid'inden kasa adı; hazırlık/test kid'i ve tanınmayan aile → null (kasa sorulmaz). */
export function kasaAdiKid(kid) {
  if (/^kok-\d{4}-\d+$/.test(kid)) return 'kok';
  if (/^ara-\d{4}-\d+$/.test(kid)) return 'ara';
  if (/^(?:paket-\d{4}(?:-\d+)?|pkt-\d{4}-\d+)$/.test(kid)) return 'paket';
  if (/^ist-\d{4}-\d+$/.test(kid)) return 'istemci';
  return null;
}

/** `--kasa=<ad>|yok` bayrağı: yok → null; ad → o ad (katalogda olmalı); verilmemiş → varsayılan. */
export function kasaSecimi(bayrak, varsayilan) {
  if (bayrak === undefined) return varsayilan ?? null;
  if (bayrak === 'yok') return null;
  tanim(bayrak);
  return bayrak;
}

function sahteKomut(yol) {
  let gercek;
  try {
    gercek = fs.realpathSync(yol);
  } catch {
    throw new KasaHatasi(`${KASA_ORTAM}=sahte:… betiği bulunamadı`);
  }
  const tmp = fs.realpathSync(os.tmpdir());
  if (!path.isAbsolute(yol) || !gercek.startsWith(`${tmp}${path.sep}`)) {
    throw new KasaHatasi(`${KASA_ORTAM}=sahte:… yalnız geçici dizindeki bir betik olabilir (bekçi)`);
  }
  return gercek;
}

/** Kasaya giden komutun yolu; null = kasa kapalı (macOS dışı ya da `kapali`). */
export function kasaKomutu(env = process.env, platform = process.platform) {
  const s = env[KASA_ORTAM] ?? '';
  if (s === 'kapali') return null;
  if (s.startsWith('sahte:')) return sahteKomut(s.slice('sahte:'.length));
  if (s !== '') throw new KasaHatasi(`${KASA_ORTAM}: yalnız 'kapali' ya da 'sahte:<geçici dizindeki betik>' olabilir`);
  return platform === 'darwin' ? KASA_KOMUTU : null;
}

/** `tkp1:<hex>` → parola Buffer'ı (NFC). Biçim tanınmazsa değer basılmadan RED. */
export function kasaCoz(cikti, hizmet) {
  let son = cikti.length;
  while (son > 0 && (cikti[son - 1] === 0x0a || cikti[son - 1] === 0x0d)) son--;
  const metin = cikti.subarray(0, son).toString('latin1');
  const hex = metin.startsWith(KASA_BICIM) ? metin.slice(KASA_BICIM.length) : '';
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    throw new KasaHatasi(`${hizmet}: kayıt biçimi tanınmadı (değer basılmadı) — ${KAYIT_KOMUTU} ${hizmet.slice(KASA_ONEK.length)} ile yeniden kaydet`);
  }
  const ham = Buffer.from(hex, 'hex');
  const nfc = Buffer.from(ham.toString('utf8').normalize('NFC'), 'utf8');
  ham.fill(0);
  return nfc;
}

/** Parola Buffer'ı → kayıt biçimi (`tkp1:<hex>`). */
export const kasaKodla = (parola) => Buffer.from(`${KASA_BICIM}${parola.toString('hex')}`, 'latin1');

function kasaKos(komut, argv, girdi, env) {
  return spawnSync(komut, argv, { input: girdi, stdio: [girdi ? 'pipe' : 'ignore', 'pipe', 'pipe'], env, maxBuffer: 64 * 1024, timeout: 30_000 });
}

/**
 * Kasadan oku: Buffer (çağıran sıfırlar) · null (kasa kapalı ya da kayıt yok). Komut başarısızsa (kilitli Anahtar
 * Zinciri vb.) değer basılmadan KasaHatasi — sessizce isteme düşülmez.
 */
export function kasadanOku(ad, env = process.env) {
  const hizmet = kasaHizmeti(ad);
  const komut = kasaKomutu(env);
  if (!komut) return null;
  const r = kasaKos(komut, ['find-generic-password', '-s', hizmet, '-a', KASA_HESAP, '-w'], undefined, env);
  try {
    if (r.error) throw new KasaHatasi(`Anahtar Zinciri komutu çalışmadı (${hizmet})`);
    if (r.status === KASA_BULUNAMADI) return null;
    if (r.status !== 0) throw new KasaHatasi(`Anahtar Zinciri okunamadı (${hizmet}; security çıkış ${r.status ?? r.signal}) — Anahtar Zinciri kilitliyse Mac oturumunu açıp yeniden dene`);
    return kasaCoz(r.stdout, hizmet);
  } finally {
    r.stdout?.fill(0);
    r.stderr?.fill(0);
  }
}

/** Kayıt var mı (değer OKUNMAZ — `-w` yok). Kasa kapalıysa null. */
export function kasaKayitliMi(ad, env = process.env) {
  const hizmet = kasaHizmeti(ad);
  const komut = kasaKomutu(env);
  if (!komut) return null;
  const r = kasaKos(komut, ['find-generic-password', '-s', hizmet, '-a', KASA_HESAP], undefined, env);
  r.stdout?.fill(0);
  r.stderr?.fill(0);
  if (r.status === 0) return true;
  if (r.status === KASA_BULUNAMADI) return false;
  throw new KasaHatasi(`Anahtar Zinciri sorgulanamadı (${hizmet}; security çıkış ${r.status ?? r.signal})`);
}

/**
 * Kasaya yaz — YALNIZ `parola-kaydet.mjs`. Değer `security -i`nin STDIN'inden gider (komut satırı süreç listesine
 * düşmez); yazıldıktan sonra geri okunup sabit zamanlı kıyaslanır. Var olan kayıt `-U` ile GÜNCELLENMEZ (macOS izin
 * penceresi açtırıyor): önce silinir, sonra yeniden yazılır. Dönüş: `{ eskiSilindi }`.
 */
export function kasayaYaz(ad, parola, env = process.env) {
  const hizmet = kasaHizmeti(ad);
  const komut = kasaKomutu(env);
  if (!komut) throw new KasaHatasi(`Parola kasası kapalı (${KASA_ORTAM} ya da macOS dışı) — kayıt yapılmadı`);
  let eskiSilindi = false;
  if (kasaKayitliMi(ad, env)) {
    const s = kasaKos(komut, ['delete-generic-password', '-s', hizmet, '-a', KASA_HESAP], undefined, env);
    s.stdout?.fill(0);
    s.stderr?.fill(0);
    if (s.error || (s.status !== 0 && s.status !== KASA_BULUNAMADI)) {
      throw new KasaHatasi(`${hizmet}: eski kayıt silinemedi (security çıkış ${s.status ?? s.signal}) — kayıt DEĞİŞMEDİ, eski parola duruyor`);
    }
    eskiSilindi = s.status === 0;
  }
  const kayipNotu = eskiSilindi ? ` — ESKİ KAYIT SİLİNDİ, ${hizmet} şu an KAYITSIZ; hemen yeniden kaydet: ${KAYIT_KOMUTU} ${ad}` : '';
  const kod = kasaKodla(parola);
  const girdi = Buffer.concat([
    Buffer.from(`add-generic-password -s ${hizmet} -a ${KASA_HESAP} -l ${hizmet} -T ${KASA_KOMUTU} -w `, 'latin1'),
    kod,
    Buffer.from('\n', 'latin1'),
  ]);
  kod.fill(0);
  const r = kasaKos(komut, ['-i'], girdi, env);
  girdi.fill(0);
  r.stdout?.fill(0);
  r.stderr?.fill(0);
  if (r.error || r.status !== 0) throw new KasaHatasi(`Anahtar Zinciri'ne yazılamadı (${hizmet}; security çıkış ${r.status ?? r.signal})${kayipNotu}`);
  let geri = null;
  try {
    geri = kasadanOku(ad, env);
  } catch {
    // aşağıda "geri okunamadı" olarak raporlanır
  }
  const ayni = geri !== null && geri.length === parola.length && crypto.timingSafeEqual(geri, parola);
  geri?.fill(0);
  if (!ayni) throw new KasaHatasi(`${hizmet}: yazılan kayıt geri okunamadı ya da uyuşmadı — kayıt GÜVENİLMEZ, yeniden dene${eskiSilindi ? ' (eski kayıt silindi)' : ''}`);
  return { eskiSilindi };
}

const uyarilan = new Set();

/**
 * Araçların tek çağrısı: kasa açık ve kayıt varsa parola (istem YOK); yoksa null ve (bir kez) ipucu stderr'e.
 * `ad` null → kasa sorulmaz (hazırlık kid'i, `--kasa=yok`).
 */
export function kasadanAl(ad, env = process.env) {
  if (ad === null || ad === undefined) return null;
  const p = kasadanOku(ad, env);
  if (p === null && kasaKomutu(env) !== null && !uyarilan.has(ad)) {
    uyarilan.add(ad);
    process.stderr.write(`ℹ ${kasaIpucu(ad)}\n`);
  }
  return p;
}
