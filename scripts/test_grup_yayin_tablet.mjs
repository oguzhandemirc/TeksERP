#!/usr/bin/env node
// =============================================================================
// TABLET GRUP YAYINI BEKÇİSİ (O10b) — mobil/scripts/lib/ortak-ota.mjs + deploy/mobil-grup-yayinla.mjs · zero-dep, ağsız
// =============================================================================
//   §1 ortak OTA paketi denetimi (negatif sondalı) · §2 grup manifesti (bayt-eşit paket, grup adresleri, imza)
//   §3 imza anahtarı fail-closed (kuru: sahte) · §4 native parmak izi kararı · §5 tablet artefakt yolu + terfi özeti
//   §6 CLI negatif yollar (ağ YOK) · §7 betik kaynağı: kapılar ve sıra (negatif sondalı)
// ÇIKIŞ: 0 yeşil · 1 KIRMIZI.   node scripts/test_grup_yayin_tablet.mjs
// =============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { KOK } from './lib/dagitim.mjs';
import { TABLET_ARTEFAKT_GORELI, grupTerfiKapisi } from './lib/grup-yayin.mjs';
import { ORTAK_PARMAK_IZI_ALG, OrtakOtaIhlali, grupManifestiUret, ortakImzaAnahtari, ortakNativeParmakIzi, ortakPaketDenetimi, parmakIziHukmu, yerelNativeKaynakIzi } from '../mobil/scripts/lib/ortak-ota.mjs';
import { multipartDogrula } from '../mobil/scripts/lib/manifest.mjs';

const require = createRequire(import.meta.url);
const { ortakKimlik } = require('../mobil/scripts/lib/ortak-kimlik.cjs');
let gecti = 0;
const kaldi = [];
const ol = (ad, k, d) => { if (k) { gecti += 1; console.log(`✅ ${ad}`); } else { kaldi.push(ad); console.log(`❌ ${ad}${d ? `\n   ${String(d).split('\n').slice(0, 8).join('\n   ')}` : ''}`); } };
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-tablet-grup-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));
// Kimlik deploy/dagitim.json kaydından (ortak-kimlik.cjs) okunur; bekçi onu tüketici olarak taşır.
const K = ortakKimlik();
const DAMGA = '1790000000000';
const BUNDLE = '_expo/static/js/android/index-abc123.hbc';

function sahtePaket(ad, { bundleMetni = 'ASCII-BUNDLE', kunyeEk = {}, cfgEk = {}, manifestVar = false } = {}) {
  const d = path.join(GECICI, ad, DAMGA);
  fs.mkdirSync(path.join(d, path.dirname(BUNDLE)), { recursive: true });
  fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(d, BUNDLE), bundleMetni);
  fs.writeFileSync(path.join(d, 'assets', 'a1'), 'varlik');
  fs.writeFileSync(path.join(d, 'metadata.json'), JSON.stringify({ fileMetadata: { android: { bundle: BUNDLE, assets: [{ path: 'assets/a1', ext: 'png' }] } } }));
  fs.writeFileSync(path.join(d, 'expoConfig.json'), JSON.stringify({ name: K.gorunenAd, android: { package: K.androidPaket }, updates: { url: K.guncellemeUrl }, ...cfgEk }));
  fs.writeFileSync(path.join(d, 'yayin.json'), JSON.stringify({ ortak: true, runtimeVersion: K.runtimeVersion, damga: DAMGA, uygulamaSurumu: '9.9.9', versionCode: 7, bundle: BUNDLE, ...kunyeEk }));
  if (manifestVar) fs.writeFileSync(path.join(d, 'manifest'), 'x');
  return d;
}
const hatalar = (d) => ortakPaketDenetimi(d, K).hatalar;

// §1
const iyi = sahtePaket('iyi');
ol('§1 ortak paket: sağlam paket hatasız', hatalar(iyi).length === 0, hatalar(iyi).join('\n'));
ol('§1 sonda: pakette manifest var → RED', hatalar(sahtePaket('m', { manifestVar: true })).some((x) => /manifest var/.test(x)));
ol('§1 sonda: bundle\'da ERP adresi → RED', hatalar(sahtePaket('e', { bundleMetni: 'x http://192.168.1.50:4000/api y' })).some((x) => /ERP adresi/.test(x)));
ol('§1 sonda: ortak:false (eski kanal paketi) → RED', hatalar(sahtePaket('o', { kunyeEk: { ortak: false } })).some((x) => /ortak: true/.test(x)));
ol('§1 sonda: kanal alanı taşıyan künye → RED', hatalar(sahtePaket('k', { kunyeEk: { musteri: 'adnansahin' } })).some((x) => /kanalsızdır/.test(x)));
ol('§1 sonda: runtimeVersion ortak kimlikten farklı → RED', hatalar(sahtePaket('r', { kunyeEk: { runtimeVersion: '1.0' } })).some((x) => /runtimeVersion/.test(x)));
ol('§1 sonda: expoConfig eski kanalın paket adını taşıyor → RED', hatalar(sahtePaket('p', { cfgEk: { android: { package: 'com.teks.erp.mobil' } } })).some((x) => /android\.package/.test(x)));
let okunamadi = false;
try { ortakPaketDenetimi(path.join(GECICI, 'yok'), K); } catch (e) { okunamadi = e instanceof OrtakOtaIhlali; }
ol('§1 sonda: paket okunamaz → ÖLÇÜLEMEDİ (fırlatır)', okunamadi);

// §2
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const anahtar = { anahtarPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), sertifikaPem: publicKey.export({ type: 'spki', format: 'pem' }), keyid: K.anahtarKimligi, sahte: true };
const { kunye, expoConfig } = ortakPaketDenetimi(iyi, K);
const feedT = 'https://indir.etkiliyazilim.com/test/mobil/';
const feedO = 'https://indir.etkiliyazilim.com/oncu/mobil/';
const mt = grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedT, anahtar });
const mo = grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedO, anahtar });
ol('§2 manifest hedef grubun adresleriyle kurulur (test ↔ oncu)', mt.manifest.launchAsset.url.startsWith(`${feedT}ota/`) && mo.manifest.launchAsset.url.startsWith(`${feedO}ota/`));
ol('§2 paket baytı AYNI: bundle/varlık özetleri ve manifest id grup değişince değişmez', mt.manifest.launchAsset.hash === mo.manifest.launchAsset.hash && mt.manifest.id === mo.manifest.id);
ol('§2 gövde grup başına farklıdır (adres + imza)', !mt.govde.equals(mo.govde));
ol('§2 imza istemcinin yaptığı gibi sertifikayla doğrulanır', multipartDogrula(mt.govde, anahtar.sertifikaPem).imzali === true);
const baskaSert = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
let kabul = false;
try { multipartDogrula(mt.govde, baskaSert); kabul = true; } catch { kabul = false; }
ol('§2 sonda: başka anahtarın sertifikası bu imzayı KABUL ETMEZ', !kabul);
let uyusmadi = false;
try { grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedT, anahtar: { ...anahtar, sertifikaPem: baskaSert } }); } catch (e) { uyusmadi = e instanceof OrtakOtaIhlali && /DOĞRULANMADI/.test(e.message); }
ol('§2 sonda: imza anahtarı ↔ sertifika uyuşmuyorsa üretim DURUR', uyusmadi);

// §3
const bos = path.join(GECICI, 'mobil-bos');
let yokHata = null;
try { ortakImzaAnahtari(K, bos); } catch (e) { yokHata = e; }
ol('§3 anahtar yok → fail-closed + tören komutu', yokHata instanceof OrtakOtaIhlali && yokHata.satirlar.some((s) => /expo-updates codesigning:generate/.test(s)));
ol('§3 kuru + anahtar yok → SAHTE anahtar (sahte: true)', ortakImzaAnahtari(K, bos, { kuru: true }).sahte === true);
const dolu = path.join(GECICI, 'mobil-dolu');
fs.mkdirSync(path.join(dolu, path.dirname(K.otaAnahtar)), { recursive: true });
fs.mkdirSync(path.join(dolu, path.dirname(K.otaSertifika)), { recursive: true });
fs.writeFileSync(path.join(dolu, K.otaAnahtar), anahtar.anahtarPem);
fs.writeFileSync(path.join(dolu, K.otaSertifika), anahtar.sertifikaPem);
ol('§3 anahtar+sertifika varsa gerçek (sahte: false, kid ortak kimlikten)', (() => { const a = ortakImzaAnahtari(K, dolu); return a.sahte === false && a.keyid === K.anahtarKimligi; })());

// §4
const cfg = { android: { package: 'x', versionCode: 5, permissions: ['A'] }, plugins: ['p'], runtimeVersion: '55.0' };
const pi = ortakNativeParmakIzi(cfg, { a: '1' });
ol('§4 parmak izi: versionCode değişince AYNI', ortakNativeParmakIzi({ ...cfg, android: { ...cfg.android, versionCode: 99 } }, { a: '1' }) === pi);
ol('§4 sonda: plugin değişince FARKLI', ortakNativeParmakIzi({ ...cfg, plugins: ['p', 'q'] }, { a: '1' }) !== pi);
ol('§4 sonda: bağımlılık değişince FARKLI', ortakNativeParmakIzi(cfg, { a: '2' }) !== pi);
ol('§4 sonda: depo içi native kaynak değişince FARKLI', ortakNativeParmakIzi(cfg, { a: '1' }, '1:aa') !== ortakNativeParmakIzi(cfg, { a: '1' }, '1:bb'));
{
  const kok = path.join(GECICI, 'yerel-native');
  fs.mkdirSync(path.join(kok, 'modules/m/android'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'modules/m/android/A.kt'), 'class A');
  execFileSync('git', ['init', '-q'], { cwd: kok });
  execFileSync('git', ['add', '.'], { cwd: kok });
  const i1 = yerelNativeKaynakIzi(kok);
  fs.writeFileSync(path.join(kok, 'modules/m/android/Izlenmeyen.kt'), 'class B');
  const i2 = yerelNativeKaynakIzi(kok);
  fs.writeFileSync(path.join(kok, 'modules/m/android/A.kt'), 'class A2');
  const i3 = yerelNativeKaynakIzi(kok);
  ol('§4 yerel native: izlenmeyen dosya (derleme çıktısı) özeti değiştirmez', i1 === i2);
  ol('§4 sonda: izlenen Kotlin içeriği değişince özet FARKLI', i1 !== i3);
}
const on = { alg: ORTAK_PARMAK_IZI_ALG, parmakIzi: pi, runtimeVersion: '55.0' };
ol('§4 hüküm: ilk · aynı · rv değişti', parmakIziHukmu({ onceki: null, simdiki: pi, runtimeVersion: '55.0' }).sonuc === 'ilk' && parmakIziHukmu({ onceki: on, simdiki: pi, runtimeVersion: '55.0' }).sonuc === 'ayni' && parmakIziHukmu({ onceki: on, simdiki: 'x', runtimeVersion: '56.0' }).sonuc === 'rv-degisti');
ol('§4 sonda: native değişti + runtimeVersion aynı → İHLAL (sahadaki tabletler çöker)', parmakIziHukmu({ onceki: on, simdiki: 'degisti', runtimeVersion: '55.0' }).sonuc === 'ihlal');
ol('§4 sonda: algoritma farkı kıyaslanamaz (native değişti DEĞİL)', parmakIziHukmu({ onceki: { ...on, alg: 3 }, simdiki: 'x', runtimeVersion: '55.0' }).sonuc === 'alg');

// §5
ol('§5 artefakt yolu: apk ve ota grup dizinine göre', TABLET_ARTEFAKT_GORELI.apk({ surum: '1.2.3', vc: 9 }) === 'apk/TeksERP-1.2.3-vc9.apk' && TABLET_ARTEFAKT_GORELI.ota({ rv: '55.0', damga: DAMGA, bundle: BUNDLE }) === `ota/55.0/${DAMGA}/${BUNDLE}`);
let yol = false;
try { TABLET_ARTEFAKT_GORELI.ota({ rv: '55.0', damga: DAMGA, bundle: '../x' }); } catch { yol = true; }
ol('§5 sonda: bundle yolunda .. → RED', yol);
const yokOku = () => ({ durum: 'yok' });
const hz = grupTerfiKapisi({ grup: 'oncu', urun: 'tablet', surum: '9.9.9', oku: yokOku });
ol('§5 sonda: tablet artefaktı verilmezse özet eşitliği ÖLÇÜLEMEDİ (varsayılan panel yoluna düşmez)', hz.sonuc === 'olculemedi' && /tablet artefaktı/.test(hz.satirlar.join(' ')), JSON.stringify(hz));
const ayniDosya = path.join(iyi, BUNDLE);
const sha = crypto.createHash('sha256').update(fs.readFileSync(ayniDosya)).digest('hex');
const eş = grupTerfiKapisi({ grup: 'oncu', urun: 'tablet', surum: '9.9.9', oku: yokOku, artefakt: { yerel: ayniDosya, goreli: 'ota/x' }, ozetOku: () => ({ durum: 'var', sha256: sha }) });
const fark = grupTerfiKapisi({ grup: 'oncu', urun: 'tablet', surum: '9.9.9', oku: yokOku, artefakt: { yerel: ayniDosya, goreli: 'ota/x' }, ozetOku: () => ({ durum: 'var', sha256: 'f'.repeat(64) }) });
ol('§5 terfi: kaynak grup artefakt özeti EŞİT → ④ ✓', eş.satirlar.some((s) => /④.*= yüklenecek artefakt/.test(s)), eş.satirlar.join('\n'));
ol('§5 sonda: özet FARKLI → İHLAL', fark.sonuc === 'ihlal' && fark.satirlar.some((s) => /④.*FARKLI/.test(s)));

// §6 CLI negatif yollar — sahte ssh/scp/curl/npx çağrı günlüğü: HİÇBİRİ çağrılmamalı
const sahteBin = path.join(GECICI, 'bin');
fs.mkdirSync(sahteBin);
const gunluk = path.join(GECICI, 'cagri.log');
for (const a of ['ssh', 'scp', 'curl', 'npx']) {
  fs.writeFileSync(path.join(sahteBin, a), `#!/bin/sh\necho ${a} >> "${gunluk}"\nexit 1\n`, { mode: 0o755 });
}
const cli = (...args) => spawnSync(process.execPath, [path.join(KOK, 'deploy/mobil-grup-yayinla.mjs'), ...args], { cwd: KOK, encoding: 'utf8', env: { ...process.env, PATH: `${sahteBin}:${process.env.PATH}`, TEKSERP_YAYIN_BELIRTECI: '' } });
const agYok = () => !fs.existsSync(gunluk);
const c = (ad, args, re) => { const r = cli(...args); ol(`§6 ${ad}`, r.status !== 0 && re.test(r.stdout + r.stderr) && agYok(), `${r.status} ${(r.stderr + r.stdout).slice(0, 300)}`); };
c('eski kanal kodu (adnansahin) hedef olamaz', ['--grup=adnansahin', `--paket=${iyi}`], /ESKİ KANAL/);
c('bilinmeyen grup RED', ['--grup=zzz', `--paket=${iyi}`], /kayıtlı bir güncelleme grubu değil/);
c('--musteri RED', ['--musteri=adnansahin'], /eski kanal yayıncısının argümanı/);
c('--grup yoksa RED', [`--paket=${iyi}`], /--grup=/);
c('hedef ezmesi (--ssh) RED', ['--grup=test', '--ssh=x', `--paket=${iyi}`], /EZİLEMEZ/);
c('tanınmayan seçenek RED', ['--grup=test', '--bilinmez', `--paket=${iyi}`], /Tanınmayan seçenek/);
c('--kuru ile --dogrula birlikte RED', ['--grup=test', '--kuru', '--dogrula'], /birlikte verilemez/);
c('ortak olmayan paket (manifest içeriyor) RED', ['--grup=test', '--kuru', `--paket=${sahtePaket('m2', { manifestVar: true })}`], /ORTAK PAKET DEĞİL/);
c('ERP adresi gömülü paket RED', ['--grup=test', '--kuru', `--paket=${sahtePaket('e2', { bundleMetni: 'http://10.0.0.5:4000/api' })}`], /ORTAK PAKET DEĞİL/);

// §7 betik kaynağı
function betikIhlalleri(metin) {
  const kod = metin.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const f = [];
  const yer = (d) => kod.search(d);
  const ilkYazan = yer(/uzakBetik\('mkdir/);
  for (const [ad, d] of [['profil matrisi kapısı', /profilMatrisiKapisi\(\);/], ['terfi kapısı', /terfiKapisi\(surum, \{ yerel/], ['derleme bağı', /(?<!function )derlemeBagi\(\{/], ['sürüm notu kapısı', /surumNotuKapisi\(surum\)/], ['temiz ağaç', /temizAgacKapisi\(\)/], ['imza (manifest/künye)', /grupManifestiUret\(|grupApkKunyesiImzala\(/]]) {
    const i = yer(d);
    if (i < 0) f.push(`${ad} çağrısı YOK`);
    else if (ilkYazan >= 0 && ad !== 'imza (manifest/künye)' && i > ilkYazan && ad !== 'x') f.push(`${ad} ilk yazan ağ işinden SONRA`);
  }
  if (!/profil-matrisi-kapisi\.mjs/.test(kod)) f.push('profil matrisi kapısı CLI çağrısı YOK');
  const paketScp = kod.search(/scp\(icerik/);
  const manifestScp = kod.search(/scp\(\[manifestYol/);
  if (paketScp < 0 || manifestScp < 0 || paketScp > manifestScp) f.push('manifest paketten ÖNCE yükleniyor (EN SON olmalı)');
  if (!/scp\(\[kunyeYol\][\s\S]*yayını AÇAN/.test(kod) || kod.search(/'-s', apkYolu/) > kod.search(/scp\(\[kunyeYol\]/)) f.push('APK künyesi APK\'dan ÖNCE yükleniyor (EN SON olmalı)');
  if (!/yayinEzmeleri\(/.test(kod)) f.push('hedef ezme reddi yok');
  if (/kanalCoz|yayinHedefi\(/.test(kod)) f.push('hedef ESKİ kanal kaydından çözülüyor');
  if (/etikiliyazilim\.com|\/opt\/stack/.test(kod)) f.push('yayın/VDS kökü LİTERAL');
  if (/\bfetch\(|\bcurl\b/.test(kod.replace(/belirtecliFetch\(/g, ''))) f.push('belirteçsiz okuma');
  if (!/musteri'?\)? ?(\|\||&&)|--musteri/.test(kod)) f.push('--musteri reddi yok');
  return f;
}
{
  const gercek = fs.readFileSync(path.join(KOK, 'deploy/mobil-grup-yayinla.mjs'), 'utf8');
  const ih = betikIhlalleri(gercek);
  ol('§7 betik: kapılar çağrılıyor, ilk yazan işten ÖNCE, sıra doğru', ih.length === 0, ih.join('\n'));
  const mut = (ad, fn, re) => { const m = fn(gercek); const r = betikIhlalleri(m); ol(`§7 sonda: ${ad} → KIRMIZI`, m !== gercek && r.some((x) => re.test(x)), `${m === gercek ? 'MUTASYON UYGULANMADI' : ''} ${r.join(' | ')}`); };
  mut('profil matrisi kapısı söküldü', (m) => m.replaceAll('profilMatrisiKapisi();', '/*x*/'), /profil matrisi kapısı çağrısı YOK/);
  mut('terfi kapısı söküldü', (m) => m.replace('terfiKapisi(surum, { yerel', 'baskaKapi(surum, { yerel'), /terfi kapısı (çağrısı YOK|ilk yazan)/);
  mut('derleme bağı söküldü', (m) => m.replace('derlemeBagi({ kunyeYolu: path.join(paketDizin', 'baskaBag({ kunyeYolu: path.join(paketDizin'), /derleme bağı (çağrısı YOK|ilk yazan)/);
  mut('manifest paketten önce yükleniyor', (m) => m.replace("scp(icerik, `${uzakSurum}/${kunye.damga}/`, '(2/3) paket dosyaları yükleniyor');", ''), /EN SON/);
  mut('ezme reddi kalktı', (m) => m.replaceAll('yayinEzmeleri(', 'baskaEzme('), /ezme reddi yok/);
  mut('eski kanal kaydı geri geldi', (m) => `${m}\nkanalCoz('x');\n`, /ESKİ kanal kaydından/);
  mut('VDS kökü literal gömüldü', (m) => `${m}\nconst V = '/opt/stack/apps/x';\n`, /LİTERAL/);
  mut('çıplak fetch', (m) => `${m}\nawait fetch('https://x');\n`, /belirteçsiz okuma/);
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
if (kaldi.length) { console.log(`Kırmızı: ${kaldi.join(' | ')}`); process.exit(1); }
