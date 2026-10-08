#!/usr/bin/env node
/**
 * TeksERP Tablet — TEK ORTAK PAKETİN OTA (JS) güncellemesini bir güncelleme grubuna yayınlar / terfi ettirir.
 *
 * K-14: ortak tablet APK'sı siteye YAYINLANMAZ — kurulum ve native güncelleme yalnız Google Play gizli yayınından
 * (`cd mobil && npm run build:aab` → Play Console). `--apk` hiçbir şey yapılmadan REDDEDİLİR.
 *
 * Eski kanal yayıncısı EMEKLİ (`eski-kanal-son` etiketinde; acil yol docs/ops/ESKI-KANAL-ACIL.md) ve bu betik onun yerine geçmez: grup
 * yayını yalnız dağıtım kaydındaki gruplara (`deploy/dagitim.json`: test → oncu → genel) gider; eski kanal kodu hedef
 * olamaz. Panelin ikizi: `deploy/electron-grup-yayinla.sh` (terfi hükmü `scripts/lib/grup-yayin.mjs`, ortak kitaplık).
 *
 * Kullanım:
 *   node deploy/mobil-grup-yayinla.mjs --grup=test  --paket=mobil/ota-cikti/ortak/<rv>/<damga> --ota-anahtar=<yaprak anahtarı>
 *   node deploy/mobil-grup-yayinla.mjs --grup=oncu  --paket=…     # test'te yayında + onay etiketi (terfi)
 *   node deploy/mobil-grup-yayinla.mjs --grup=genel --paket=…     # K-6: AYRI ikinci onay etiketi
 *   … --kuru                       # AĞ YOK — yerel kapılar + plan (imza anahtarı yoksa SAHTE anahtarla denenir, yazılmaz)
 *   … --dogrula                    # YÜKLEME YOK — grubun OTA manifestini denetle
 *   … --terfi-atla="<cümle>"       # terfi kaçışı · --profil-matrisi-atla="<cümle>" profil matrisi kaçışı
 *
 * ⚠️ MANİFEST HEDEF GRUPLA ÜRETİLİR: OTA manifesti grup başına yeniden kurulur (varlık adresleri
 * `<kök><grup>/mobil/ota/<rv>/<damga>/…`) ve OTA YAPRAĞIYLA imzalanır; yaprak `certificate_chain` parçasında gider,
 * tablet onu APK'ya gömülü OTA KÖKÜNE zincirler (K-2, docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.1). Paket baytı
 * (bundle · varlıklar) gruplar arasında AYNI kalır; terfide kaynak grubun artefakt özeti ile yüklenecek özet eşit olmalıdır.
 * Yaprak anahtarı parolalıdır (TTY'de gizli istem, değilse stdin satırı; argümandan/ortamdan ASLA). Malzeme yoksa, yaprak
 * köke bağlı değilse ya da bitişine 30 günden az kaldıysa imza adımı fail-closed durur (kuru: atılacak deneme zinciri).
 * `--ota-anahtar=<dosya>` (ya da TEKSERP_OTA_IMZA_ANAHTARI) yaprağı seçer — yıllık dönem töreninin
 * `~/.tekserp/satici-uretim/donemler/<damga>/istemci/ota-yaprak/private-key.pem`i ya da yedeği (docs/ops/URETIM-SATICI-TOREN.md §9);
 * verilmezse gerçek yayın DURUR (depoda varsayılan yaprak yok). Yaprak sertifikası o anahtarın yanındaki `certificate.pem`dir.
 * ⚠️ YÜKLEME SIRASI pazarlık dışı: paket/varlıklar ÖNCE, manifest EN SON (yayını açan adım). Cloudflare proxy AÇIK kalır.
 * ⚠️ OTA turunda `versionCode`a dokunulmaz (native sürüm Play'dedir; native değiştiyse runtimeVersion artar → AAB → Play).
 * ⚠️ GERÇEK YAYIN kullanıcı onayıyla yapılır. Hedef YALNIZ dağıtım kaydından türer; ssh/dizin/adres ezmesi RED.
 * Reçete: docs/kurallar/surum-yayin.md · docs/design/TEK-ORTAK-PAKET.md §3.5 · profil matrisi kapısı:
 * `scripts/profil-matrisi-kapisi.mjs` (kök grup muaf).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { GRUP_ALT_DIZINI, OrtakOtaIhlali, grupManifestiUret, ortakAnahtarParolali, ortakImzaAnahtari, ortakImzaYollari, ortakPaketDenetimi } from '../mobil/scripts/lib/ortak-ota.mjs';
import { PANEL_KUNYE_ADI, derlemeBagiDenetimi, derlemeKunyesiOku, dosyaOzeti, temizAgacDenetimi } from '../scripts/lib/derleme-bagi.mjs';
import { GrupIhlali, TABLET_ARTEFAKT_GORELI, grupCoz, grupHedefi, grupTerfiKapisi, uzakSha256 } from '../scripts/lib/grup-yayin.mjs';
import { Olculemedi, terfiKaynagi } from '../scripts/lib/dagitim.mjs';
import { etiketAt } from '../scripts/lib/surum.mjs';
import { cumleDenetle, istanbulSaati, terfiAtlaKaydi, terfiAtlaMesaji, terfiRaporu } from '../scripts/lib/terfi.mjs';
import { yayinSonrasiBildir } from '../scripts/lib/yayin-bildirim.mjs';
import { BelirtecYok, belirtecOku, belirtecliFetch } from '../scripts/lib/yayin-okuma.mjs';
import { SURUM_BICIMI, ezmeSatirlari, uzakDegerDenetle, yayinEzmeleri } from '../scripts/lib/yayin-hedefi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(HERE, '..');
const MOBIL = path.join(KOK, 'mobil');
/** K-14: ortak tablet APK'sı yalnız Google Play'den; site yolu kapalı. */
const APK_RED = [
  "ORTAK TABLET APK'SI SİTEYE YAYINLANMAZ — Google Play gizli yayını (K-14)",
  'Native/büyük güncelleme: runtimeVersion artır (deploy/dagitim.json urun.tablet) → cd mobil && npm run build:aab → Play Console (kapalı test / gizli yayın).',
  'JS güncellemesi: bu betik --paket=<ortak OTA paketi> ile.',
];
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
const BILINEN = ['grup', 'paket', 'kuru', 'dogrula', 'ota-anahtar', 'terfi-atla', 'profil-matrisi-atla'];
for (const a of argv) {
  const ad = a.replace(/^--/, '').split('=')[0];
  if (a === '--musteri' || a.startsWith('--musteri=')) dur('--musteri emekli eski kanal yayıncısının argümanıdır (eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md)', 'Grup yayını --grup=<test|oncu|genel> alır.');
  if (a === '--apk' || a.startsWith('--apk=')) dur(APK_RED[0], ...APK_RED.slice(1));
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
const TERFI_ATLA = arg('terfi-atla');
const PROFIL_ATLA = arg('profil-matrisi-atla');
const OTA_ANAHTAR = arg('ota-anahtar') || process.env.TEKSERP_OTA_IMZA_ANAHTARI || '';

if (!GRUP) dur('HANGİ GRUBA YAYINLANIYOR?', '--grup=<test|oncu|genel> zorunlu.', 'Örnek: node deploy/mobil-grup-yayinla.mjs --grup=test --paket=<ortak OTA paketi>');
if (KURU && DOGRULA) dur('--kuru ile --dogrula birlikte verilemez (--dogrula yayına bakar, --kuru hiç ağa çıkmaz).');
if (DOGRULA && (TERFI_ATLA !== undefined || PROFIL_ATLA !== undefined)) dur('--terfi-atla / --profil-matrisi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez).');
if (!DOGRULA && !PAKET) dur('Ne yayınlanacağı belirtilmedi', '--paket=<ortak OTA paketi klasörü>');
if (PAKET !== undefined && !PAKET) dur('--paket boş');

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
 * Yaprak anahtarı parolası — TTY'de gizli istem, değilse stdin'in ilk satırı (argüman/ortam YOK)
 * ------------------------------------------------------------------ */

function parolaSor(soru) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const parcalar = [];
      stdin.on('data', (p) => parcalar.push(p));
      stdin.on('end', () => {
        const hepsi = Buffer.concat(parcalar);
        const son = hepsi.indexOf(0x0a);
        const satir = Buffer.from(hepsi.subarray(0, son < 0 ? hepsi.length : son)).toString('utf8').replace(/\r$/, '');
        hepsi.fill(0);
        resolve(Buffer.from(satir, 'utf8'));
      });
    });
  }
  return new Promise((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    process.stderr.write(soru);
    const baytlar = [];
    const bitir = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); process.stderr.write('\n'); };
    const onData = (parca) => {
      for (const b of parca) {
        if (b === 0x03) { bitir(); baytlar.fill(0); reject(new Error('İptal edildi (Ctrl+C)')); return; }
        if (b === 0x0d || b === 0x0a) { bitir(); const c = Buffer.from(baytlar); baytlar.fill(0); resolve(c); return; }
        if (b === 0x7f || b === 0x08) baytlar.pop();
        else baytlar.push(b);
      }
      parca.fill(0);
    };
    stdin.on('data', onData);
  });
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
  surumNotuKapisi(surum);
  temizAgacKapisi();
  derlemeBagi({ kunyeYolu: path.join(paketDizin, PANEL_KUNYE_ADI), urun: 'tablet-ota', surum, dosyaYolu: path.join(paketDizin, 'metadata.json') });
  const goreli = TABLET_ARTEFAKT_GORELI.ota({ rv: kunye.runtimeVersion, damga: kunye.damga, bundle: kunye.bundle });
  terfiKapisi(surum, { yerel: bundleYolu, goreli });
  profilMatrisiKapisi();

  // İMZA — OTA yaprağı (parolalı) + zincir; malzeme yoksa fail-closed (kuru: atılacak deneme zinciri, hiçbir şey yazılmaz).
  let uretim;
  let parola;
  try {
    const yollar = ortakImzaYollari(KIMLIK, MOBIL, { anahtarYolu: OTA_ANAHTAR || undefined });
    if (ortakAnahtarParolali(yollar)) parola = await parolaSor(`OTA yaprak anahtarı parolası (${yollar.anahtarYol}): `);
    const anahtar = ortakImzaAnahtari(KIMLIK, MOBIL, { kuru: KURU, anahtarYolu: OTA_ANAHTAR || undefined, parola });
    uretim = grupManifestiUret({ paketDizin, kunye, expoConfig, feed: FEED, anahtar });
  } catch (e) {
    if (e instanceof OrtakOtaIhlali) dur(e.message, ...e.satirlar);
    throw e;
  } finally {
    parola?.fill(0);
  }
  bilgi(`manifest      : '${GRUP}' grubunun varlık adresleriyle üretildi · OTA yaprağıyla imzalı (bitiş ${uretim.imzalayan.yaprakBitis}) · zincir gömülü köke karşı doğrulandı${uretim.imzalayan.sahte ? ' (KURU: DENEME ZİNCİRİ — yazılmaz)' : ''}`);

  if (KURU) {
    bilgi(`[kuru] sıra       : 1) ${paketDizin} içeriği (manifest hariç) → ${UZAK_KOK}/ota/${kunye.runtimeVersion}/${kunye.damga}/  2) manifest + manifest-${kunye.damga} (EN SON)`);
    bilgi(`[kuru] yayın adresi: ${FEED}ota/${kunye.runtimeVersion}/manifest · defter ${HEDEF.defter}`);
    bilgi('[kuru] değişmezlik · dış doğrulama · etiket · bildirim ATLANDI (ağ gerektirir)');
    return console.log(`\nKURU — ortak OTA paketi '${GRUP}' grubuna hazır; yükleme yapılmadı.`);
  }

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
 * Salt denetim
 * ------------------------------------------------------------------ */

async function dogrula() {
  baslik(`YAYIN DENETİMİ — '${GRUP}' grubu (yükleme yok)`);
  belirtecGerekli();
  const m = await iste(`${FEED}ota/${KIMLIK.runtimeVersion}/manifest`);
  bilgi(`OTA manifesti : HTTP ${m.durum} · protokol ${m.basliklar['expo-protocol-version'] ?? '(yok)'} · ${m.basliklar['content-type'] ?? '(tip yok)'}`);
  if (m.durum !== 200) dur(`'${GRUP}' grubunda OTA manifesti okunamadı (HTTP ${m.durum})`);
  console.log(`\n  ✔ Denetim tamam (OTA ${m.durum}). Native sürüm Google Play'dedir (Play Console).\n`);
}

/* ------------------------------------------------------------------ */

try {
  if (DOGRULA) {
    await dogrula();
  } else {
    // Belirteç yükleme ÖNCESİ ölçülür (kenar doğrulaması yapılamayan yayın açılmaz); kuru ağa çıkmaz.
    if (!KURU) belirtecGerekli();
    if (PAKET) await otaYayinla(path.resolve(PAKET));
  }
} catch (e) {
  if (e instanceof GrupIhlali) dur(e.message, ...e.satirlar);
  if (e instanceof Olculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, 'Ölçülemeyen şart geçmiş şart değildir.');
  dur('Beklenmeyen hata', e?.stack ?? String(e));
}
