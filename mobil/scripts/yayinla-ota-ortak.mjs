#!/usr/bin/env node
/**
 * TeksERP Mobil — TEK ORTAK PAKETİN uzaktan güncelleme (OTA) paketi üreticisi (O10b).
 *
 * Eski kanal üreticisi (`yayinla-ota.mjs`) emekli — `eski-kanal-son` etiketi; bu betik YALNIZ ortak paketi üretir:
 *   · kimlik (runtimeVersion · OTA imza kimliği · sertifika) `app.json`dan DEĞİL ortak kimlikten gelir
 *     (`scripts/lib/ortak-kimlik.cjs`, kaynak `deploy/dagitim.json`); `app.json` eski kanalın dinlenme kimliğini taşır;
 *   · ERP adresi GÖMÜLMEZ: `EXPO_PUBLIC_API_URL` ortamdan silinir, `.env*` yüklenmez (`EXPO_NO_DOTENV=1`);
 *   · MANİFEST ÜRETİLMEZ: grup başına yayında yeniden kurulur ve imzalanır (`deploy/mobil-grup-yayinla.mjs`) —
 *     paket baytı gruplar arasında aynı kalır;
 *   · native parmak izi DEĞERLENDİRİLMİŞ ortak yapılandırmadan hesaplanır (app.json ham bloğundan değil).
 * Çıktı: `ota-cikti/ortak/<runtimeVersion>/<damga>/` (git dışı). Yükleme ayrı adım: deploy/mobil-grup-yayinla.mjs.
 *
 * Kullanım:
 *   npm run yayinla:ortak                       # paketle
 *   npm run yayinla:ortak -- --check            # yalnız kimlik + yapılandırma + parmak izi kontrolü (yan etkisiz)
 *   npm run yayinla:ortak -- --parmak-izini-kabul-et
 *
 * ⚠️ OTA turunda `versionCode`a DOKUNULMAZ (tablet onu kurulu APK'nın sürümü sanar) — sürümü bu betik yazmaz,
 * `app.json` sürümü kullanıcının/ sürüm turunun kararıdır ve sürüm notu kapısından geçer.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { PANEL_KUNYE_ADI, derlemeKunyesiYaz, temizAgacDenetimi } from '../../scripts/lib/derleme-bagi.mjs';
import { ORTAK_PARMAK_IZI_ALG, OrtakOtaIhlali, ortakNativeParmakIzi, ortakPaketDenetimi, parmakIziHukmu } from './lib/ortak-ota.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(HERE, '..');
const CIKTI_KOK = path.join(PROJECT_ROOT, 'ota-cikti', 'ortak');
const PARMAK_IZI_DOSYA = path.join(PROJECT_ROOT, '.ota-parmak-izi-ortak.json');
const { ortakKimlik, ortakYapilandirmaFarki } = require('./lib/ortak-kimlik.cjs');

const BAR = '='.repeat(72);
const baslik = (m) => console.log(`\n${BAR}\n  ${m}\n${BAR}`);
const bilgi = (m) => console.log(`  ${m}`);
const uyari = (m) => console.log(`\n  ⚠  ${m}\n`);
function dur(basligi, ...satirlar) {
  console.error(`\n${BAR}\n  ✖ HATA — ${basligi}\n${BAR}`);
  for (const s of satirlar) console.error(`  ${s}`);
  console.error(`${BAR}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const SADECE_KONTROL = argv.includes('--check');
const PARMAK_IZI_KABUL = argv.includes('--parmak-izini-kabul-et');
const bilinmeyen = argv.filter((a) => !['--check', '--parmak-izini-kabul-et'].includes(a));
if (bilinmeyen.length) dur('Tanınmayan argüman', bilinmeyen.join(' '), 'Ortak paket kanal/adres/anahtar argümanı almaz (hepsi dağıtım kaydından).');

const appJson = () => JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')).expo;

/** Ortak paketin ortamı: ERP adresi SİLİNİR, .env* yüklenmez, eski kanal seçimi yok. */
function ortakOrtam() {
  const env = { ...process.env, EXPO_NO_DOTENV: '1' };
  delete env.EXPO_PUBLIC_API_URL;
  delete env.TEKSERP_KANAL;
  return env;
}

function degerlendirilmisYapilandirma() {
  const once = { kanal: process.env.TEKSERP_KANAL };
  delete process.env.TEKSERP_KANAL;
  try {
    return require(path.join(PROJECT_ROOT, 'app.config.js'))({ config: appJson() });
  } finally {
    if (once.kanal !== undefined) process.env.TEKSERP_KANAL = once.kanal;
  }
}

function parmakIziKapisi(cfg, rv) {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const simdiki = ortakNativeParmakIzi(cfg, pkg.dependencies);
  let onceki = null;
  try {
    onceki = JSON.parse(fs.readFileSync(PARMAK_IZI_DOSYA, 'utf8'));
  } catch {
    /* ilk koşum */
  }
  bilgi(`Native parmak izi : ${simdiki} (değerlendirilmiş ortak yapılandırmadan)`);
  const h = parmakIziHukmu({ onceki, simdiki, runtimeVersion: rv, kabul: PARMAK_IZI_KABUL });
  if (h.sonuc === 'ihlal' || h.sonuc === 'alg') dur(h.sonuc === 'ihlal' ? 'NATIVE DEĞİŞTİ ama runtimeVersion AYNI KALDI' : 'PARMAK İZİ KARŞILAŞTIRILAMIYOR', ...h.satirlar);
  if (h.sonuc === 'rv-degisti') uyari(h.satirlar[0]);
  else bilgi(h.satirlar[0]);
  return simdiki;
}

function sil(yol, ad) {
  if (!fs.existsSync(yol)) return;
  fs.rmSync(yol, { recursive: true, force: true });
  bilgi(`silindi: ${ad}`);
}

function main() {
  baslik('TeksERP Mobil — ORTAK UZAKTAN GÜNCELLEME PAKETİ');
  const ortamdaki = String(process.env.TEKSERP_KANAL ?? '').trim();
  if (ortamdaki) dur('KANAL ÇELİŞKİSİ', `TEKSERP_KANAL ortamda: ${ortamdaki}`, 'Ortak paket eski kanalın kimliğini gömerdi — ortamdan kaldır.');
  let kimlik;
  try {
    kimlik = ortakKimlik();
  } catch (e) {
    dur('ÖLÇÜLEMEDİ — ortak paket kimliği çözülemedi (deploy/dagitim.json)', String(e?.message ?? e));
  }
  const e = appJson();
  const surum = String(e.version ?? '');
  if (!/^\d+\.\d+\.\d+$/.test(surum)) dur('app.json sürümü biçimsiz', `"${surum}" (x.y.z bekleniyor)`);
  bilgi(`Kimlik           : ${kimlik.androidPaket} · "${kimlik.gorunenAd}" · runtimeVersion ${kimlik.runtimeVersion}`);
  bilgi(`Güncelleme adresi: ${kimlik.guncellemeUrl}  (Worker belirtecin grubuna yönlendirir)`);
  bilgi('ERP adresi       : GÖMÜLMEZ');
  bilgi(`Uygulama sürümü  : ${surum} (vc ${e.android?.versionCode} — OTA ona dokunmaz)`);

  let cfg;
  try {
    cfg = degerlendirilmisYapilandirma();
  } catch (err) {
    dur('ÖLÇÜLEMEDİ — app.config.js ortak kimlikle değerlendirilemedi', String(err?.message ?? err));
  }
  const farklar = ortakYapilandirmaFarki(cfg, {}, kimlik);
  if (farklar.length) dur('app.config.js ORTAK KİMLİĞİ ÜRETMİYOR', ...farklar);

  {
    const bekci = path.join(PROJECT_ROOT, '..', 'scripts', 'check-surum-notlari.mjs');
    const r = spawnSync(process.execPath, [bekci, `--tablet=${surum}`], { stdio: 'inherit' });
    if (r.error || r.status !== 0) dur('Sürüm notu kapısı kırmızı/ölçülemedi', `${surum} için operatör notu yok ya da not kuralları ihlal ediyor.`);
  }
  const agac = temizAgacDenetimi();
  if (agac.sonuc !== 'temiz') {
    if (SADECE_KONTROL) uyari(`${agac.satirlar.join('\n     ')}\n     (--check: uyarı — gerçek turda paket ÜRETİLMEZ)`);
    else dur(agac.sonuc === 'kirli' ? 'PAKETLENEMEZ — çalışma ağacı temiz değil' : 'ÖLÇÜLEMEDİ — çalışma ağacı okunamadı', ...agac.satirlar);
  } else bilgi(agac.satirlar[0]);

  const parmakIzi = parmakIziKapisi(cfg, kimlik.runtimeVersion);
  if (SADECE_KONTROL) {
    console.log('\n  ✔ Ön kontrol tamam (--check): ortak kimlik, yapılandırma ve native parmak izi tutarlı.\n');
    return;
  }

  const damga = String(Date.now());
  const hedef = path.join(CIKTI_KOK, kimlik.runtimeVersion, damga);
  fs.mkdirSync(hedef, { recursive: true });

  baslik('(1/3) BUNDLE ÖNBELLEĞİ TEMİZLENİYOR');
  sil(path.join(os.tmpdir(), 'metro-cache'), 'Metro transform önbelleği');
  sil(path.join(PROJECT_ROOT, '.expo', 'cache'), 'Expo cache');

  baslik('(2/3) PAKET ÜRETİLİYOR — expo export (ERP adresi GÖMÜLMEZ)');
  const x = spawnSync('npx', ['expo', 'export', '--platform', 'android', '--output-dir', hedef, '--clear'], { cwd: PROJECT_ROOT, stdio: 'inherit', env: ortakOrtam() });
  if (x.error || x.status !== 0) dur('expo export başarısız', x.error ? String(x.error.message) : `Çıkış kodu: ${x.status}`);
  const c = spawnSync('npx', ['expo', 'config', '--json', '--type', 'public'], { cwd: PROJECT_ROOT, encoding: 'utf8', env: ortakOrtam() });
  let publicCfg = null;
  try {
    if (c.status === 0 && c.stdout) publicCfg = JSON.parse(c.stdout);
  } catch {
    publicCfg = null;
  }
  if (!publicCfg) dur('ÖLÇÜLEMEDİ — expo config okunamadı', 'Paket kimliği (extra.expoClient) ölçülemeden paket üretilmez.');
  fs.writeFileSync(path.join(hedef, 'expoConfig.json'), JSON.stringify(publicCfg));

  const meta = JSON.parse(fs.readFileSync(path.join(hedef, 'metadata.json'), 'utf8'));
  const bundle = meta?.fileMetadata?.android?.bundle;
  const varlikSayisi = (meta?.fileMetadata?.android?.assets ?? []).length;
  fs.writeFileSync(path.join(hedef, 'yayin.json'), JSON.stringify({
    createdAt: new Date(Number(damga)).toISOString(), ortak: true, runtimeVersion: kimlik.runtimeVersion, damga,
    uygulamaSurumu: surum, versionCode: e.android?.versionCode ?? null, parmakIzi, bundle, varlikSayisi,
  }, null, 2));

  baslik('(3/3) DOĞRULAMA — ortak paket denetimi + derleme künyesi');
  let d;
  try {
    d = ortakPaketDenetimi(hedef, kimlik);
  } catch (err) {
    if (err instanceof OrtakOtaIhlali) dur('ÖLÇÜLEMEDİ — ortak paket denetlenemedi', err.message, ...err.satirlar);
    throw err;
  }
  if (d.hatalar.length) dur('ÜRETİLEN PAKET ORTAK PAKET DEĞİL — YAYINLANMAZ', ...d.hatalar);
  bilgi(`✔ Ortak paket: bundle ${bundle} · ${varlikSayisi} varlık · ERP adresi yok · manifest yok (grup başına)`);
  {
    const son = temizAgacDenetimi();
    if (son.sonuc !== 'temiz' || son.commit !== agac.commit) dur('Derleme sırasında çalışma ağacı ya da HEAD değişti — künye YAZILMADI', ...son.satirlar);
    const k = derlemeKunyesiYaz(path.join(hedef, PANEL_KUNYE_ADI), {
      urun: 'tablet-ota', kanal: null, surum, commit: agac.commit, dosyaYolu: path.join(hedef, 'metadata.json'),
    });
    bilgi(`✔ Derleme künyesi: ${PANEL_KUNYE_ADI} · commit ${k.commit.slice(0, 12)} · metadata.json sha256 ${k.sha256.slice(0, 16)}…`);
  }
  fs.writeFileSync(PARMAK_IZI_DOSYA, JSON.stringify({ alg: ORTAK_PARMAK_IZI_ALG, parmakIzi, runtimeVersion: kimlik.runtimeVersion, damga, tarih: new Date().toISOString() }, null, 2));

  baslik('HAZIR');
  bilgi(`Paket klasörü : ${hedef}`);
  bilgi('Yayınlamak için (önce test grubu):');
  bilgi(`    node ../deploy/mobil-grup-yayinla.mjs --grup=test --paket=${hedef} --kuru`);
  console.log('');
}

try {
  main();
} catch (err) {
  dur('Beklenmeyen hata', err?.stack ?? String(err));
}
