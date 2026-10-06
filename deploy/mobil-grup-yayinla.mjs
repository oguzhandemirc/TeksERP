#!/usr/bin/env node
/**
 * TeksERP Tablet — TEK ORTAK PAKETİ bir güncelleme grubuna yayınlar / terfi ettirir (OTA paketi ve APK).
 *
 * Eski kanal yayıncısı EMEKLİ (`eski-kanal-son` etiketinde; acil yol docs/ops/ESKI-KANAL-ACIL.md) ve bu betik onun yerine geçmez: grup
 * yayını yalnız dağıtım kaydındaki gruplara (`deploy/dagitim.json`: test → oncu → genel) gider; eski kanal kodu hedef
 * olamaz. Panelin ikizi: `deploy/electron-grup-yayinla.sh` (terfi hükmü `scripts/lib/grup-yayin.mjs`, ortak kitaplık).
 *
 * Kullanım:
 *   node deploy/mobil-grup-yayinla.mjs --grup=test  --paket=mobil/ota-cikti/ortak/<rv>/<damga> [--ota-anahtar=<dosya>]
 *   node deploy/mobil-grup-yayinla.mjs --grup=test  --apk=<APK> [--anahtar=<tablet künye imza anahtarı>]
 *   node deploy/mobil-grup-yayinla.mjs --grup=oncu  --paket=… | --apk=…     # test'te yayında + onay etiketi (terfi)
 *   node deploy/mobil-grup-yayinla.mjs --grup=genel --paket=… | --apk=…     # K-6: AYRI ikinci onay etiketi
 *   … --kuru                       # AĞ YOK — yerel kapılar + plan (imza anahtarı yoksa SAHTE anahtarla denenir, yazılmaz)
 *   … --dogrula                    # YÜKLEME YOK — grubun yayınını (OTA manifesti + APK künyesi) denetle
 *   … --terfi-atla="<cümle>"       # terfi kaçışı · --profil-matrisi-atla="<cümle>" profil matrisi kaçışı
 *
 * ⚠️ MANİFEST VE KÜNYE HEDEF GRUPLA ÜRETİLİR: OTA manifesti grup başına yeniden kurulur (varlık adresleri
 * `<kök><grup>/mobil/ota/<rv>/<damga>/…`) ve ortak OTA anahtarıyla imzalanır; APK künyesi (`apk/surum.json`) `kanal` = grup
 * ile imzalanır. Paket baytı (bundle · varlıklar · APK) gruplar arasında AYNI kalır; terfide kaynak grubun artefakt özeti
 * ile yüklenecek özet eşit olmalıdır. Ortak OTA anahtarı yoksa imza adımı fail-closed durur (kuru: sahte anahtarla denenir).
 * ⚠️ YÜKLEME SIRASI pazarlık dışı: paket/varlıklar ÖNCE, manifest/künye EN SON (yayını açan adım). Cloudflare proxy AÇIK kalır.
 * ⚠️ OTA turunda `versionCode`a dokunulmaz; grubun APK künyesindekiyle farklıysa DURUR.
 * ⚠️ GERÇEK YAYIN kullanıcı onayıyla yapılır. Hedef YALNIZ dağıtım kaydından türer; ssh/dizin/adres ezmesi RED.
 * Reçete: docs/kurallar/surum-yayin.md · docs/design/TEK-ORTAK-PAKET.md §3.5 · profil matrisi kapısı:
 * `scripts/profil-matrisi-kapisi.mjs` (kök grup muaf).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { ortakBundleAdresleri } from '../mobil/scripts/lib/adres.mjs';
import { ApkOlculemedi, apkKimligi, sertifikaParmakIzi } from '../mobil/scripts/lib/apk-kimlik.mjs';
import { APK_CAPA_REL, apkCapaDenetimi, apkCapaGomuluFarki, apkCapasiOku, apkRotasyonDenetimi, verifyApkSurumJson, withApkBlock } from '../mobil/scripts/lib/apk-kunye.mjs';
import { GRUP_ALT_DIZINI, OrtakOtaIhlali, grupManifestiUret, ortakImzaAnahtari, ortakPaketDenetimi } from '../mobil/scripts/lib/ortak-ota.mjs';
import { zipGirdisiOku } from '../mobil/scripts/lib/zip.mjs';
import { PANEL_KUNYE_ADI, apkKunyeYolu, derlemeBagiDenetimi, derlemeKunyesiOku, dosyaOzeti, temizAgacDenetimi } from '../scripts/lib/derleme-bagi.mjs';
import { GrupIhlali, TABLET_ARTEFAKT_GORELI, grupCoz, grupHedefi, grupTerfiKapisi, uzakSha256 } from '../scripts/lib/grup-yayin.mjs';
import { Olculemedi, terfiKaynagi } from '../scripts/lib/dagitim.mjs';
import { etiketAt } from '../scripts/lib/surum.mjs';
import { cumleDenetle, istanbulSaati, terfiAtlaKaydi, terfiAtlaMesaji, terfiRaporu } from '../scripts/lib/terfi.mjs';
import { yayinSonrasiBildir } from '../scripts/lib/yayin-bildirim.mjs';
import { BelirtecYok, belirtecOku, belirtecliFetch, sshOku } from '../scripts/lib/yayin-okuma.mjs';
import { SURUM_BICIMI, ezmeSatirlari, uzakDegerDenetle, yayinEzmeleri } from '../scripts/lib/yayin-hedefi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(HERE, '..');
const MOBIL = path.join(KOK, 'mobil');
const require = createRequire(import.meta.url);
const { ortakKimlik } = require('../mobil/scripts/lib/ortak-kimlik.cjs');

const BAR = '='.repeat(72);
const baslik = (m) => console.log(`\n${BAR}\n  ${m}\n${BAR}`);
const bilgi = (m) => console.log(`  ${m}`);
const uyari = (m) => console.log(`\n  ⚠  ${m}\n`);
function dur(b, ...satirlar) {
  console.error(`\n${BAR}\n  ✖ HATA — ${b}\n${BAR}`);
  for (const s of satirlar.flat()) console.error(`  ${s}`);
  console.error(`${BAR}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Argümanlar — bilinmeyen seçenek RED (ezme yüzeyi kapalı)
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const arg = (ad) => {
  const e = argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
  if (e === undefined) return undefined;
  return e.includes('=') ? e.slice(e.indexOf('=') + 1) : '';
};
const BILINEN = ['grup', 'paket', 'apk', 'kuru', 'dogrula', 'anahtar', 'ota-anahtar', 'terfi-atla', 'profil-matrisi-atla', 'zorunlu', 'notlar'];
for (const a of argv) {
  const ad = a.replace(/^--/, '').split('=')[0];
  if (a === '--musteri' || a.startsWith('--musteri=')) dur('--musteri emekli eski kanal yayıncısının argümanıdır (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md)', 'Grup yayını --grup=<test|oncu|genel> alır.');
  if (!a.startsWith('--') || !BILINEN.includes(ad)) {
    if (!yayinEzmeleri({ argv: [a] }).length) dur(`Tanınmayan seçenek: ${a}`, `Bilinenler: ${BILINEN.map((x) => `--${x}`).join(' ')}`);
  }
}
{
  const ezmeler = yayinEzmeleri({ argv, env: process.env });
  if (ezmeler.length) dur('YAYIN HEDEFİ EZİLEMEZ — hiçbir şey yüklenmedi', ...ezmeSatirlari(ezmeler));
}
const KURU = arg('kuru') !== undefined;
const DOGRULA = arg('dogrula') !== undefined;
const GRUP = arg('grup');
const PAKET = arg('paket');
const APK = arg('apk');
const TERFI_ATLA = arg('terfi-atla');
const PROFIL_ATLA = arg('profil-matrisi-atla');
const APK_ANAHTAR = arg('anahtar') || process.env.TEKSERP_TABLET_IMZA_ANAHTARI || '';
const OTA_ANAHTAR = arg('ota-anahtar') || process.env.TEKSERP_OTA_IMZA_ANAHTARI || '';

if (!GRUP) dur('HANGİ GRUBA YAYINLANIYOR?', '--grup=<test|oncu|genel> zorunlu.', 'Örnek: node deploy/mobil-grup-yayinla.mjs --grup=test --paket=<ortak OTA paketi>');
if (KURU && DOGRULA) dur('--kuru ile --dogrula birlikte verilemez (--dogrula yayına bakar, --kuru hiç ağa çıkmaz).');
if (DOGRULA && (TERFI_ATLA !== undefined || PROFIL_ATLA !== undefined)) dur('--terfi-atla / --profil-matrisi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez).');
if (!DOGRULA && !PAKET && !APK) dur('Ne yayınlanacağı belirtilmedi', '--paket=<ortak OTA paketi klasörü> ve/veya --apk=<ortak APK>');
if (PAKET !== undefined && !PAKET) dur('--paket boş');
if (APK !== undefined && !APK) dur('--apk boş');

/* ------------------------------------------------------------------ *
 * Grup + hedef — hiçbir ağ/ssh işinden ÖNCE; yalnız dağıtım kaydından
 * ------------------------------------------------------------------ */

let HEDEF;
let KIMLIK;
try {
  grupCoz(GRUP);
  HEDEF = grupHedefi(GRUP, 'tablet');
  KIMLIK = ortakKimlik();
} catch (e) {
  if (e instanceof GrupIhlali) dur(e.message, ...e.satirlar);
  if (e instanceof Olculemedi) dur('ÖLÇÜLEMEDİ — yayın hedefi/kimliği çözülemedi (deploy/dagitim.json)', e.message);
  dur('ÖLÇÜLEMEDİ — ortak kimlik çözülemedi', String(e?.message ?? e));
}
const SSH_HEDEF = HEDEF.ssh;
const UZAK_KOK = HEDEF.vds;
const FEED = `${HEDEF.feed}/`;

/* ------------------------------------------------------------------ *
 * Kabuk/ağ yardımcıları (tek yer; --kuru ağa çıkmaz)
 * ------------------------------------------------------------------ */

function uzakDeger(ad, v) {
  try {
    return uzakDegerDenetle(ad, v);
  } catch (e) {
    return dur('UZAK KOMUT DEĞERİ BİÇİMSİZ — gönderilmedi', e.message);
  }
}
function kos(komut, argumanlar, aciklama) {
  bilgi(aciklama);
  if (KURU) return void bilgi(`    [kuru] ${komut} ${argumanlar.join(' ')}`);
  const r = spawnSync(komut, argumanlar, { stdio: 'inherit' });
  if (r.error) dur(`${aciklama} — komut çalıştırılamadı`, String(r.error.message));
  if (r.status !== 0) dur(`${aciklama} — başarısız (çıkış ${r.status})`);
}
function uzakBetik(betik, degerler, aciklama, { zorunlu = true } = {}) {
  const a = degerler.map((v, i) => uzakDeger(`${aciklama} (değer ${i + 1})`, v));
  bilgi(aciklama);
  if (KURU) {
    bilgi(`    [kuru] ssh ${SSH_HEDEF} bash -s -- ${a.join(' ')}`);
    return { status: 0 };
  }
  const r = spawnSync('ssh', ['-T', SSH_HEDEF, 'bash', '-s', '--', ...a], { input: betik, stdio: ['pipe', 'inherit', 'inherit'] });
  if (zorunlu && (r.error || r.status !== 0)) dur(`${aciklama} — başarısız`, r.error ? String(r.error.message) : `çıkış ${r.status}`);
  return r;
}
const scp = (kaynaklar, uzakYol, aciklama) => kos('scp', ['-s', '-r', ...kaynaklar, `${SSH_HEDEF}:${uzakDeger('scp hedefi', uzakYol)}`], aciklama);

function belirtecGerekli() {
  try {
    belirtecOku(FEED);
  } catch (e) {
    if (!(e instanceof BelirtecYok)) throw e;
    dur('YAYIN BELİRTECİ YOK — hiçbir şey yüklenmedi, anonim okumaya düşülmez', ...e.message.split('\n').map((x) => x.trim()));
  }
}

/** Dışarıdan dosya doğrulaması: önbellek / yok / yarım yükleme ayrımı (boyut kıyası YETMEZ ama yarım yüklemeyi yakalar). */
async function dosyaDogrula(url, { yerelBoyut } = {}) {
  const tazeUrl = `${url}${url.includes('?') ? '&' : '?'}onbellek-atla=${process.pid}`;
  const temiz = await belirtecliFetch(url, { method: 'HEAD' });
  const taze = await belirtecliFetch(tazeUrl, { method: 'HEAD' });
  if (temiz.status !== 200) {
    if (taze.status === 200) dur('ÖNBELLEK SORUNU — dosya sunucuda VAR ama adres eski yanıtı döndürüyor', `Adres: ${url}`, 'Yeniden yüklemek ÇÖZMEZ: Cloudflare → Caching → Purge by URL.');
    dur('DOSYA YAYINDA DEĞİL', `Adres: ${url}`, `HTTP ${temiz.status} (önbelleksiz ${taze.status}) — yükleme adımını tekrarla.`);
  }
  const uzunluk = Number(temiz.headers.get('content-length') ?? '0');
  if (yerelBoyut && uzunluk && uzunluk !== yerelBoyut) dur('DOSYA EKSİK YÜKLENMİŞ', `Adres: ${url}`, `yerel ${yerelBoyut} bayt · yayında ${uzunluk} bayt`);
}
async function iste(url) {
  const r = await belirtecliFetch(url, { method: 'GET', redirect: 'follow' });
  return { durum: r.status, basliklar: Object.fromEntries(r.headers.entries()), govde: await r.text() };
}

/* ------------------------------------------------------------------ *
 * Ortak kapılar
 * ------------------------------------------------------------------ */

function surumNotuKapisi(surum) {
  const bekci = path.join(KOK, 'scripts', 'check-surum-notlari.mjs');
  const r = spawnSync(process.execPath, [bekci, `--tablet=${surum}`], { stdio: 'inherit' });
  if (r.error) dur('SÜRÜM NOTU KAPISI ÖLÇÜLEMEDİ', `Bekçi çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) dur('SÜRÜM NOTU KAPISI KIRMIZI', `${surum} için operatör notu yok ya da not kuralları ihlal edilmiş.`);
}

function temizAgacKapisi() {
  const a = temizAgacDenetimi();
  if (a.sonuc !== 'temiz') dur(a.sonuc === 'kirli' ? 'ÇALIŞMA AĞACI TEMİZ DEĞİL — yükleme yapılmadı' : 'ÖLÇÜLEMEDİ — çalışma ağacı okunamadı', ...a.satirlar);
  bilgi(a.satirlar[0]);
}

/** Künye ↔ artefakt ↔ HEAD (ortak paket kanalsızdır: künye kanal = null; terfi etiketi ayrı kapıda ölçülür). */
function derlemeBagi({ kunyeYolu, urun, surum, dosyaYolu, ek = {} }) {
  let h;
  try {
    const kunye = derlemeKunyesiOku(kunyeYolu);
    h = derlemeBagiDenetimi({ kunye, kunyeYolu, beklenen: { urun, kanal: null, surum }, ozet: dosyaOzeti(dosyaYolu), terfiUrunu: null });
    const ekFark = kunye ? Object.entries(ek).filter(([a, v]) => kunye[a] !== v).map(([a, v]) => `künye ${a} ${kunye[a]} — artefakt ${v}`) : [];
    if (ekFark.length && h.sonuc !== 'olculemedi') h = { sonuc: 'ihlal', satirlar: [...(h.sonuc === 'ihlal' ? h.satirlar : []), ...ekFark] };
  } catch (e) {
    if (!(e instanceof Olculemedi)) throw e;
    h = { sonuc: 'olculemedi', satirlar: [e.message] };
  }
  if (h.sonuc !== 'uyumlu') dur(h.sonuc === 'olculemedi' ? 'ÖLÇÜLEMEDİ — derleme bağı' : "DERLEME BAĞI KOPUK — yüklenen bayt HEAD'e bağlanmıyor", ...h.satirlar);
  bilgi(h.satirlar[0]);
}

/** Terfi kapısı — oncu/genel: etiket + kaynak grupta yayın + özet eşitliği (+ genel için K-6); test etiketsiz. */
function terfiKapisi(surum, artefakt) {
  const h = grupTerfiKapisi({ grup: GRUP, urun: 'tablet', surum, atla: TERFI_ATLA, kuru: KURU, artefakt });
  const satirlar = terfiRaporu(h, { kod: GRUP, urun: 'tablet', surum });
  if (h.sonuc === 'uyumlu') {
    for (const s of satirlar) bilgi(s);
    return h;
  }
  return dur(satirlar[0].replace(/^✖ /, ''), ...satirlar.slice(1).map((s) => s.trim()),
    h.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>"' : 'Ölçülemeyen şart geçmiş şart değildir.');
}

/** Profil matrisi kapısı: kök grup muaf; diğerlerinde commit'in matris raporu yeşil olmalı (rapor yoksa ÖLÇÜLEMEDİ = DUR). */
function profilMatrisiKapisi() {
  const ek = PROFIL_ATLA !== undefined ? [`--profil-matrisi-atla=${PROFIL_ATLA}`] : [];
  const r = spawnSync(process.execPath, [path.join(KOK, 'scripts', 'profil-matrisi-kapisi.mjs'), `--grup=${GRUP}`, ...ek], { stdio: 'inherit' });
  if (r.error || r.status !== 0) dur('Profil matrisi kapısı geçilmedi — yükleme yapılmadı');
}

/** Tablet imza çapası (APK künyesi çapası) JS paketinde gömülü mü; boş çapa: OTA'da uyarı, APK'da DUR. */
function tabletCapaKapisi(bundleMetni, kaynak, { apk }) {
  let liste;
  try {
    liste = apkCapasiOku(KOK);
  } catch (e) {
    dur('ÖLÇÜLEMEDİ — tablet imza çapası okunamadı', `${APK_CAPA_REL}: ${e.message}`);
  }
  const d = apkCapaDenetimi(liste);
  if (d.sonuc === 'ihlal') dur('TABLET İMZA ÇAPASI GEÇERSİZ', ...d.satirlar);
  if (d.sonuc === 'bos') {
    if (apk) dur('TABLET İMZA ÇAPASI BOŞ — APK yayınlanmaz', ...d.satirlar, 'İmzalı künye olmadan tablet APK\'yı kurmaz (docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md).');
    uyari(`${d.satirlar[0]}\n     OTA kanalı etkilenmez; çapalı bir sonraki OTA ile APK güncellemesi açılır.`);
    return liste;
  }
  const eksik = apkCapaGomuluFarki(bundleMetni, liste);
  if (eksik.length) dur('PAKET AĞACIN TABLET İMZA ÇAPASINI TAŞIMIYOR', `kaynak: ${kaynak}`, `eksik : ${eksik.join(', ')} (${APK_CAPA_REL})`, 'Paket çapa eklenmeden ÖNCE derlenmiş (bayat) — yeniden üret.');
  bilgi(`tablet çapası  : ${liste.map((k) => k.kid).join(', ')} — pakette gömülü`);
  return liste;
}

function ortakSertifikaIzi() {
  const yol = path.join(MOBIL, KIMLIK.otaSertifika);
  let iz = null;
  try {
    iz = sertifikaParmakIzi(fs.readFileSync(yol, 'utf8'));
  } catch {
    iz = null;
  }
  return { iz, yol };
}

function uzakOku(yol) {
  const r = sshOku(yol, { hedef: SSH_HEDEF });
  if (r.durum === 'yok') return null;
  if (r.durum !== 'var') dur('Uzak dosya okunamadı — ölçülemeyen şart geçmiş şart değildir, yükleme yapılmadı', r.neden);
  return r.govde;
}

/** Grubun APK künyesindeki versionCode (yayın yoksa null; okunamazsa DUR). OTA ve APK kapıları aynı değeri kullanır. */
function grupApkKunyesi() {
  const g = uzakOku(`${UZAK_KOK}/apk/surum.json`);
  if (g === null) return null;
  try {
    return JSON.parse(g);
  } catch {
    return dur('Grubun apk/surum.json künyesi ayrıştırılamadı — versionCode kapısı ÖLÇÜLEMEDİ');
  }
}

/* ------------------------------------------------------------------ *
 * Yayın sonrası: defter · etiket · bildirim
 * ------------------------------------------------------------------ */

function defterYaz(surum, ozet16, boyut, tur) {
  const kim = `${process.env.USER ?? '?'}@${process.env.HOSTNAME ?? 'yerel'}`.replace(/[^A-Za-z0-9._@-]/g, '_');
  const alanlar = [istanbulSaati(), `tablet-${surum}-${tur}`, kim, ozet16, String(boyut)];
  const atla = TERFI_ATLA !== undefined ? Buffer.from(cumleDenetle(TERFI_ATLA).cumle ?? '', 'utf8').toString('base64') : null;
  const r = uzakBetik(`d="$1"; shift
mkdir -p "$(dirname "$d")" || exit 1
if [ -n "\${5:-}" ]; then printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" "$5" "terfi-atlandi: $(printf '%s' "$6" | base64 -d)" >> "$d"; else printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$1" "$2" "$3" "$4" "$5" >> "$d"; fi
`, [HEDEF.defter, ...alanlar, ...(atla ? [atla] : [])], '  yayın defteri', { zorunlu: false });
  if (!KURU) bilgi(r.status === 0 ? '  ✓ yayın defterine yazıldı' : '  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi)');
}

async function yayinSonrasi(surum, ayrinti) {
  const cumle = TERFI_ATLA !== undefined ? cumleDenetle(TERFI_ATLA).cumle : '';
  const t = etiketAt('tablet', surum, cumle ? { mesaj: terfiAtlaMesaji({ kod: GRUP, urun: 'tablet', surum, cumle }) } : {});
  console.log(`\n${{ atildi: `  ✓ sürüm etiketi atıldı: ${t.ad}`, 'zaten-var': `  · sürüm etiketi zaten var: ${t.ad}`, basarisiz: `  ⚠️ sürüm etiketi atılamadı: ${t.ad} (yayın etkilenmedi)` }[t.durum]}${t.not ? ` — ${t.not}` : ''}`);
  if (cumle) {
    const k = terfiAtlaKaydi({ kod: GRUP, urun: 'tablet', surum, cumle });
    console.log(`${{ atildi: `  ✓ terfi atlama kaydı atıldı: ${k.ad}`, 'zaten-var': `  · terfi etiketi zaten var: ${k.ad}`, basarisiz: `  ⚠️ terfi atlama etiketi atılamadı: ${k.ad}` }[k.durum]}`);
  }
  const terfiEtiketi = TERFI_ATLA === undefined && grupTerfiKaynagiVar() ? `terfi/${GRUP}/tablet-v${surum}` : undefined;
  await yayinSonrasiBildir({ urun: 'tablet', kanal: GRUP, surum, ayrinti, terfiAtla: TERFI_ATLA, terfiEtiketi });
}

function grupTerfiKaynagiVar() {
  return Boolean(terfiKaynagi(grupCoz(GRUP).kayit, GRUP));
}

/* ------------------------------------------------------------------ *
 * OTA paketi
 * ------------------------------------------------------------------ */

async function otaYayinla(paketDizin) {
  baslik(`ORTAK OTA PAKETİ → '${GRUP}' GRUBU`);
  let d;
  try {
    d = ortakPaketDenetimi(paketDizin, KIMLIK);
  } catch (e) {
    if (e instanceof OrtakOtaIhlali) dur(`ÖLÇÜLEMEDİ — ${e.message}`, ...e.satirlar);
    throw e;
  }
  if (d.hatalar.length) dur('PAKET ORTAK PAKET DEĞİL — yüklenmez', ...d.hatalar.map((x) => `• ${x}`));
  const { kunye, expoConfig, bundleYolu } = d;
  const surum = String(kunye.uygulamaSurumu ?? '');
  if (!SURUM_BICIMI.test(surum)) dur('Paket künyesinde sürüm yok/biçimsiz', `uygulamaSurumu: "${surum}"`);
  bilgi(`sürüm ${surum} · runtimeVersion ${kunye.runtimeVersion} · damga ${kunye.damga} · hedef ${SSH_HEDEF}:${UZAK_KOK}/ota/${kunye.runtimeVersion}`);
  tabletCapaKapisi(fs.readFileSync(bundleYolu).toString('latin1'), bundleYolu, { apk: false });
  surumNotuKapisi(surum);
  temizAgacKapisi();
  derlemeBagi({ kunyeYolu: path.join(paketDizin, PANEL_KUNYE_ADI), urun: 'tablet-ota', surum, dosyaYolu: path.join(paketDizin, 'metadata.json') });
  const goreli = TABLET_ARTEFAKT_GORELI.ota({ rv: kunye.runtimeVersion, damga: kunye.damga, bundle: kunye.bundle });
  terfiKapisi(surum, { yerel: bundleYolu, goreli });
  profilMatrisiKapisi();

  // İMZA — ortak OTA anahtarı; yoksa fail-closed (kuru: sahte anahtar, hiçbir şey yazılmaz).
  let uretim;
  try {
    const anahtar = ortakImzaAnahtari(KIMLIK, MOBIL, { kuru: KURU, anahtarYolu: OTA_ANAHTAR || undefined });
    uretim = grupManifestiUret({ paketDizin, kunye, expoConfig, feed: FEED, anahtar });
  } catch (e) {
    if (e instanceof OrtakOtaIhlali) dur(e.message, ...e.satirlar);
    throw e;
  }
  bilgi(`manifest      : '${GRUP}' grubunun varlık adresleriyle üretildi · keyid "${uretim.imzalayan.keyid}" · imza sertifikayla doğrulandı${uretim.imzalayan.sahte ? ' (KURU: SAHTE ANAHTAR — yazılmaz)' : ''}`);

  if (KURU) {
    bilgi(`[kuru] sıra       : 1) ${paketDizin} içeriği (manifest hariç) → ${UZAK_KOK}/ota/${kunye.runtimeVersion}/${kunye.damga}/  2) manifest + manifest-${kunye.damga} (EN SON)`);
    bilgi(`[kuru] yayın adresi: ${FEED}ota/${kunye.runtimeVersion}/manifest · defter ${HEDEF.defter}`);
    bilgi('[kuru] versionCode kapısı · değişmezlik · dış doğrulama · etiket · bildirim ATLANDI (ağ gerektirir)');
    return console.log(`\nKURU — ortak OTA paketi '${GRUP}' grubuna hazır; yükleme yapılmadı.`);
  }

  // versionCode kapısı: OTA, tabletin kurulu-APK sürüm bilgisini taşır; grubun APK künyesiyle aynı olmalı.
  const gk = grupApkKunyesi();
  if (gk && typeof gk.versionCode === 'number' && kunye.versionCode !== gk.versionCode) {
    dur('versionCode GRUBUN APK KÜNYESİYLE UYUŞMUYOR', `paket: ${kunye.versionCode} · '${GRUP}' APK künyesi: ${gk.versionCode}`,
      'OTA paketi bu değeri de taşır ve tablet onu KURULU sürümü sanar; farklı gönderilirse gerçek APK güncellemesi bir daha teklif edilmez.');
  }
  if (!gk) uyari(`'${GRUP}' grubunda APK künyesi yok — versionCode kapısı atlandı.`);

  // Değişmezlik: aynı bundle zaten varsa AYNI baytlar olmalı.
  const uzakBundle = `${UZAK_KOK}/${goreli}`;
  const yerelOzet = dosyaOzeti(bundleYolu).sha256;
  const uz = uzakSha256(uzakBundle, { hedef: SSH_HEDEF });
  if (uz.durum === 'olculemedi') dur('Uzaktaki bundle özeti ÖLÇÜLEMEDİ — yükleme yapılmadı', uz.neden);
  if (uz.durum === 'var' && uz.sha256 !== yerelOzet) dur('DEĞİŞMEZLİK İHLALİ — aynı damga/yolda FARKLI baytlar', `sunucu ${uz.sha256}`, `yerel  ${yerelOzet}`);
  const atlaYukleme = uz.durum === 'var';
  if (atlaYukleme) bilgi('↷ paket dosyaları grupta AYNI baytlarla zaten var — yükleme atlanıyor (yalnız manifest).');

  const manifestDizini = path.join(paketDizin, GRUP_ALT_DIZINI, GRUP);
  fs.rmSync(manifestDizini, { recursive: true, force: true });
  fs.mkdirSync(manifestDizini, { recursive: true });
  const manifestYol = path.join(manifestDizini, 'manifest');
  const damgaliYol = path.join(manifestDizini, `manifest-${kunye.damga}`);
  fs.writeFileSync(manifestYol, uretim.govde);
  fs.writeFileSync(damgaliYol, uretim.govde);

  const uzakSurum = `${UZAK_KOK}/ota/${kunye.runtimeVersion}`;
  if (!atlaYukleme) {
    uzakBetik('mkdir -p -- "$1"\n', [`${uzakSurum}/${kunye.damga}`], '(1/3) uzak klasör hazırlanıyor');
    const icerik = fs.readdirSync(paketDizin).filter((ad) => ad !== GRUP_ALT_DIZINI && ad !== PANEL_KUNYE_ADI && !ad.startsWith('manifest')).map((ad) => path.join(paketDizin, ad));
    scp(icerik, `${uzakSurum}/${kunye.damga}/`, '(2/3) paket dosyaları yükleniyor');
  }
  scp([manifestYol, damgaliYol], `${uzakSurum}/`, '(3/3) manifest yükleniyor (yayını AÇAN adım)');

  baslik('DOĞRULAMA — dışarıdan, gerçek HTTPS ile');
  const url = `${FEED}ota/${kunye.runtimeVersion}/manifest`;
  await dosyaDogrula(url);
  const y = await iste(url);
  const sorunlar = [];
  if (y.durum !== 200) sorunlar.push(`HTTP ${y.durum} (beklenen 200)`);
  if (y.basliklar['expo-protocol-version'] !== '1') sorunlar.push('`expo-protocol-version: 1` başlığı YOK — nginx kuralı eksik');
  if (!/multipart\/mixed;\s*boundary=/i.test(y.basliklar['content-type'] ?? '')) sorunlar.push('`content-type` multipart/mixed + boundary taşımıyor — nginx kuralı eksik');
  if (y.govde !== uretim.govde.toString('utf8')) sorunlar.push("Kenardaki manifest yerelde üretilen manifest DEĞİL (bayat önbellek ya da yarım yükleme)");
  if (sorunlar.length) dur('YAYIN AÇIK DEĞİL', ...sorunlar.map((x) => `• ${x}`));
  await dosyaDogrula(`${FEED}${goreli}`, { yerelBoyut: fs.statSync(bundleYolu).size });
  bilgi(`✔ '${GRUP}' grubunda OTA yayında (manifest id ${uretim.manifest.id}); tabletler sonraki açılışta ya da ön plana dönünce alır.`);

  defterYaz(surum, yerelOzet.slice(0, 16), fs.statSync(bundleYolu).size, 'ota');
  await yayinSonrasi(surum, { tur: 'ota', sha16: yerelOzet.slice(0, 16), boyut: String(fs.statSync(bundleYolu).size) });
}

/* ------------------------------------------------------------------ *
 * APK
 * ------------------------------------------------------------------ */

function apkicindekiBundle(apkYol) {
  let r;
  try {
    r = zipGirdisiOku(apkYol, 'assets/index.android.bundle');
  } catch (e) {
    r = { hata: String(e?.message ?? e) };
  }
  if (r.hata || !r.veri) dur('ÖLÇÜLEMEDİ — APK içindeki JS bundle okunamadı', r.hata ?? '', 'ERP adresi ölçülemeyen APK yüklenmez.');
  return r.veri.toString('latin1');
}

/** Grup künyesi: ortak APK'nın bilgisiyle kurulur; imzalıysa korunur, değilse imza aracı çağrılır (parola TTY'den). */
function grupApkKunyesiImzala({ kunye, kunyeYol, apkYol, capa }) {
  const dogrula = (o) => verifyApkSurumJson(o, { keys: capa, channel: GRUP });
  let yazilacak = kunye;
  try {
    const mevcut = JSON.parse(fs.readFileSync(kunyeYol, 'utf8'));
    const aday = typeof mevcut?.tekserp?.bildirim === 'string' ? withApkBlock(kunye, mevcut.tekserp.bildirim) : null;
    if (aday && dogrula(aday).ok) yazilacak = aday;
  } catch {
    // künye yok ya da okunamadı: imzasız başlanır
  }
  fs.writeFileSync(kunyeYol, `${JSON.stringify(yazilacak, null, 2)}\n`);
  let v = dogrula(yazilacak);
  if (!v.ok && KURU) {
    bilgi(`[kuru] künye     : '${GRUP}' adıyla İMZASIZ — gerçek yayında imzalanır (--anahtar=<dosya> + parola)`);
    return null;
  }
  if (!v.ok) {
    if (!APK_ANAHTAR) dur('APK KÜNYESİ İMZASIZ ve imza anahtarı verilmedi — yükleme yapılmadı', '--anahtar=<istemci yayın anahtarı dosyası> (ya da TEKSERP_TABLET_IMZA_ANAHTARI); parola TTY\'den sorulur.');
    const r = spawnSync('npx', ['tsx', 'scripts/panel-imza.ts', 'apk-imzala', `--musteri=${GRUP}`, `--apk=${apkYol}`, `--kunye=${kunyeYol}`, `--anahtar=${APK_ANAHTAR}`], { cwd: path.join(KOK, 'Teks-Erp'), stdio: 'inherit' });
    if (r.error || r.status !== 0) dur('APK künyesi imzalanamadı — yükleme yapılmadı', r.error ? r.error.message : `imza aracı çıkış ${r.status}`);
    const imzali = JSON.parse(fs.readFileSync(kunyeYol, 'utf8'));
    const ayrisan = ['versionCode', 'versionName', 'dosya', 'sha256', 'boyut'].filter((k) => imzali?.[k] !== kunye[k]);
    if (ayrisan.length) dur("İmzalanan künye ölçülen APK'dan ayrışıyor — yükleme yapılmadı", `alanlar: ${ayrisan.join(', ')}`);
    v = dogrula(imzali);
    if (!v.ok) dur('İmzalanan künye kapıdan geçmedi — yükleme yapılmadı', `${v.code}: ${v.message}`);
  }
  bilgi(`künye          : imzalı · kanal ${GRUP} · kid ${v.value.kid}`);
  return v.value.kid;
}

async function apkYayinla(apkYolu) {
  baslik(`ORTAK APK → '${GRUP}' GRUBU`);
  if (!fs.existsSync(apkYolu)) dur('APK bulunamadı', apkYolu);
  let a;
  try {
    a = apkKimligi(apkYolu);
  } catch (e) {
    if (!(e instanceof ApkOlculemedi)) throw e;
    dur('ÖLÇÜLEMEDİ — APK kimliği okunamadı', e.message, 'Kimliği ölçülemeyen APK yüklenmez.');
  }
  const { iz: beklenenIz, yol: sertYol } = ortakSertifikaIzi();
  if (!beklenenIz) dur('ÖLÇÜLEMEDİ — ortak OTA sertifikası okunamadı', sertYol, 'keystore/ git dışıdır; sertifikası ölçülmeyen APK yüklenmez (tören: mobil/scripts/lib/ortak-kimlik.cjs anahtarToreniKomutu).');
  const sorunlar = [];
  if (a.paket !== KIMLIK.androidPaket) sorunlar.push(`paket adı "${a.paket}" ≠ ortak "${KIMLIK.androidPaket}"`);
  if (a.guncellemeAcik !== 'true') sorunlar.push(`expo-updates ENABLED "${a.guncellemeAcik ?? 'yok'}" (beklenen true)`);
  if (a.guncellemeAdresi !== KIMLIK.guncellemeUrl) sorunlar.push(`EXPO_UPDATE_URL "${a.guncellemeAdresi ?? 'yok'}" ≠ "${KIMLIK.guncellemeUrl}"`);
  if (!a.sertifikaPem || sertifikaParmakIzi(a.sertifikaPem) !== beklenenIz) sorunlar.push('gömülü OTA sertifikası ortak paketinki değil');
  if (sorunlar.length) dur('APK ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR — yüklenmez', ...sorunlar.map((x) => `• ${x}`), 'Eski kanal APK\'sı bu yoldan yüklenmez (eski yol emekli: docs/ops/ESKI-KANAL-ACIL.md).');
  if (!a.surumAdi || !SURUM_BICIMI.test(a.surumAdi) || !Number.isInteger(a.surumKodu) || a.surumKodu < 1) {
    dur('ÖLÇÜLEMEDİ — APK sürümü okunamadı', `versionName: ${a.surumAdi ?? '(yok)'} · versionCode: ${a.surumKodu ?? '(yok)'}`);
  }
  const surum = a.surumAdi;
  const vc = a.surumKodu;
  bilgi(`APK sürümü    : ${surum} (versionCode ${vc}) — APK dosyasından · paket ${a.paket}`);
  const bundle = apkicindekiBundle(apkYolu);
  const { gomulu } = ortakBundleAdresleri(bundle);
  if (gomulu.length) dur("APK'NIN BUNDLE'INDA ERP ADRESİ VAR — yüklenmez", gomulu.slice(0, 3).join(', '));
  const capa = tabletCapaKapisi(bundle, `${apkYolu} › assets/index.android.bundle`, { apk: true });
  surumNotuKapisi(surum);
  temizAgacKapisi();
  derlemeBagi({ kunyeYolu: apkKunyeYolu(apkYolu), urun: 'tablet-apk', surum, dosyaYolu: apkYolu, ek: { versionCode: vc } });
  const goreli = TABLET_ARTEFAKT_GORELI.apk({ surum, vc });
  terfiKapisi(surum, { yerel: apkYolu, goreli });
  profilMatrisiKapisi();

  const ad = goreli.slice('apk/'.length);
  if (!/^[\x20-\x7E]+$/.test(ad) || /\s/.test(ad)) dur('APK dosya adı ASCII ve boşluksuz olmalı', ad);
  const icerik = fs.readFileSync(apkYolu);
  const sha256 = crypto.createHash('sha256').update(icerik).digest('hex');
  const kunye = {
    versionCode: vc, versionName: surum, dosya: ad, sha256, boyut: icerik.length, zorunlu: arg('zorunlu') !== undefined,
    notlar: arg('notlar') ?? null, yayinTarihi: new Date().toISOString(), indirmeUrl: `${FEED}apk/${ad}`,
  };
  const kunyeDizini = path.join(path.dirname(apkYolu), GRUP_ALT_DIZINI, GRUP);
  fs.mkdirSync(kunyeDizini, { recursive: true });
  const kunyeYol = path.join(kunyeDizini, 'surum.json');
  const imzalayan = grupApkKunyesiImzala({ kunye, kunyeYol, apkYol: apkYolu, capa });

  if (KURU) {
    bilgi(`[kuru] sıra       : 1) ${ad} → ${UZAK_KOK}/apk/  2) surum.json ('${GRUP}' künyeli, EN SON)`);
    bilgi('[kuru] rotasyon kilidi · değişmezlik · dış doğrulama · etiket · bildirim ATLANDI (ağ gerektirir)');
    return console.log(`\nKURU — ortak APK '${GRUP}' grubuna hazır; yükleme yapılmadı.`);
  }

  let rot;
  try {
    rot = apkRotasyonDenetimi({ yayindaki: uzakOku(`${UZAK_KOK}/apk/surum.json`), yeniKid: imzalayan });
  } catch (e) {
    dur('Rotasyon kilidi ÖLÇÜLEMEDİ — yükleme yapılmadı', e.message);
  }
  if (rot.sonuc !== 'uyumlu') dur('ROTASYON KİLİDİ — yükleme yapılmadı', ...rot.satirlar);
  for (const x of rot.satirlar) bilgi(x);

  const uz = uzakSha256(`${UZAK_KOK}/${goreli}`, { hedef: SSH_HEDEF });
  if (uz.durum === 'olculemedi') dur('Uzaktaki APK özeti ÖLÇÜLEMEDİ — yükleme yapılmadı', uz.neden);
  if (uz.durum === 'var' && uz.sha256 !== sha256) dur('DEĞİŞMEZLİK İHLALİ — aynı sürüm/vc FARKLI baytlarla duruyor', 'Sürüm numarasını ARTIR ve yeniden derle.');
  uzakBetik('mkdir -p -- "$1"\n', [`${UZAK_KOK}/apk`], '(1/3) uzak klasör hazırlanıyor');
  if (uz.durum === 'var') bilgi('↷ APK grupta AYNI baytlarla zaten var — yükleme atlanıyor.');
  else kos('scp', ['-s', apkYolu, `${SSH_HEDEF}:${uzakDeger('scp hedefi', `${UZAK_KOK}/apk/${ad}`)}`], '(2/3) APK yükleniyor');
  scp([kunyeYol], `${UZAK_KOK}/apk/`, '(3/3) künye yükleniyor (yayını AÇAN adım)');

  const y = await iste(`${FEED}apk/surum.json`);
  if (y.durum !== 200 || y.govde !== fs.readFileSync(kunyeYol, 'utf8')) dur('Künye yayında değil, bayat ya da yerel imzalı dosyadan farklı', `HTTP ${y.durum}`);
  bilgi('künye          : yayındaki surum.json yerel imzalı dosyayla bayt-eşit');
  await dosyaDogrula(kunye.indirmeUrl, { yerelBoyut: icerik.length });
  bilgi(`✔ '${GRUP}' grubunda kurulum dosyası yayında.`);
  defterYaz(surum, sha256.slice(0, 16), icerik.length, 'apk');
  await yayinSonrasi(surum, { tur: 'apk', vc: String(vc), sha16: sha256.slice(0, 16), boyut: String(icerik.length) });
}

/* ------------------------------------------------------------------ *
 * Salt denetim
 * ------------------------------------------------------------------ */

async function dogrula() {
  baslik(`YAYIN DENETİMİ — '${GRUP}' grubu (yükleme yok)`);
  belirtecGerekli();
  const m = await iste(`${FEED}ota/${KIMLIK.runtimeVersion}/manifest`);
  bilgi(`OTA manifesti : HTTP ${m.durum} · protokol ${m.basliklar['expo-protocol-version'] ?? '(yok)'} · ${m.basliklar['content-type'] ?? '(tip yok)'}`);
  const k = await iste(`${FEED}apk/surum.json`);
  bilgi(`APK künyesi   : HTTP ${k.durum}`);
  if (k.durum === 200) {
    try {
      const j = JSON.parse(k.govde);
      bilgi(`  sürüm ${j.versionName} (vc ${j.versionCode}) · ${j.dosya}`);
      const capa = apkCapasiOku(KOK);
      const v = verifyApkSurumJson(j, { keys: capa, channel: GRUP });
      bilgi(v.ok ? `  ✔ künye imzalı · kanal ${GRUP} · kid ${v.value.kid}` : `  ⚠️ künye doğrulanamadı (${v.code}): ${v.message}`);
    } catch (e) {
      bilgi(`  ⚠️ künye ayrıştırılamadı: ${e.message}`);
    }
  }
  if (m.durum !== 200 && k.durum !== 200) dur(`'${GRUP}' grubunda ne OTA manifesti ne APK künyesi okunabildi`);
  console.log(`\n  ✔ Denetim tamam (OTA ${m.durum} · APK künyesi ${k.durum}).\n`);
}

/* ------------------------------------------------------------------ */

try {
  if (DOGRULA) {
    await dogrula();
  } else {
    // Belirteç yükleme ÖNCESİ ölçülür (kenar doğrulaması yapılamayan yayın açılmaz); kuru ağa çıkmaz.
    if (!KURU) belirtecGerekli();
    if (PAKET) await otaYayinla(path.resolve(PAKET));
    if (APK) await apkYayinla(path.resolve(APK));
  }
} catch (e) {
  if (e instanceof GrupIhlali) dur(e.message, ...e.satirlar);
  if (e instanceof Olculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, 'Ölçülemeyen şart geçmiş şart değildir.');
  dur('Beklenmeyen hata', e?.stack ?? String(e));
}
