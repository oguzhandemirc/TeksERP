#!/usr/bin/env node
// =============================================================================
// TABLET GRUP YAYINI BEKÇİSİ (O10b) — mobil/scripts/lib/ortak-ota.mjs + deploy/mobil-grup-yayinla.mjs · zero-dep, ağsız
// =============================================================================
//   §1 ortak OTA paketi denetimi (negatif sondalı) · §2 grup manifesti (bayt-eşit paket, grup adresleri, zincirli imza)
//   §3 imza malzemesi fail-closed (kuru: atılacak deneme zinciri; parola, 30 gün, kök/yaprak profili) · §4 native parmak izi kararı · §5 tablet artefakt yolu + terfi özeti
//   §6 CLI negatif yollar (ağ YOK; K-14 `--apk` reddi dahil) · §7 betik kaynağı: kapılar, sıra ve APK yolu YOK (negatif sondalı)
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
import { imzaBasligi, multipartDogrula, multipartKur } from '../mobil/scripts/lib/manifest.mjs';

const require = createRequire(import.meta.url);
const { ortakKimlik } = require('../mobil/scripts/lib/ortak-kimlik.cjs');
const Z = require('../mobil/scripts/lib/ota-zinciri.cjs');
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

// §2 — ATILACAK deneme zincirleri (openssl, GECICI altında; depoya girmez). Profil ekleri bozuk yaprak basar.
const BOZUK_PROFIL = `
[ yaprak_ca ]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = critical, codeSigning
[ yaprak_ekusuz ]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
`;
const zincir = (ad, secim = {}) => Z.denemeZinciriUret(path.join(GECICI, `zincir-${ad}`), { profilEk: BOZUK_PROFIL, ...secim });
const Zi = zincir('iyi');
const Zy = zincir('yabanci');
const Zca = zincir('ca', { yaprakBolum: 'yaprak_ca' });
const Zeku = zincir('ekusuz', { yaprakBolum: 'yaprak_ekusuz' });
const acik = (d) => crypto.createPrivateKey({ key: d.yaprakAnahtarPem, passphrase: d.parola });
const malzeme = (d) => ({ anahtar: acik(d), kokPem: d.kokPem, yaprakPem: d.yaprakPem, keyid: K.anahtarKimligi, sahte: true, yaprakBitis: new crypto.X509Certificate(d.yaprakPem).validTo });
const anahtar = malzeme(Zi);
const { kunye, expoConfig } = ortakPaketDenetimi(iyi, K);
const feedT = 'https://indir.etkiliyazilim.com/test/mobil/';
const feedO = 'https://indir.etkiliyazilim.com/oncu/mobil/';
const mt = grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedT, anahtar });
const mo = grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedO, anahtar });
ol('§2 manifest hedef grubun adresleriyle kurulur (test ↔ oncu)', mt.manifest.launchAsset.url.startsWith(`${feedT}ota/`) && mo.manifest.launchAsset.url.startsWith(`${feedO}ota/`));
ol('§2 paket baytı AYNI: bundle/varlık özetleri ve manifest id grup değişince değişmez', mt.manifest.launchAsset.hash === mo.manifest.launchAsset.hash && mt.manifest.id === mo.manifest.id);
ol('§2 gövde grup başına farklıdır (adres + imza)', !mt.govde.equals(mo.govde));
{
  const d = multipartDogrula(mt.govde, Zi.kokPem, { zincir: true });
  ol('§2 imza istemcinin yaptığı gibi GÖMÜLÜ KÖKE zincirle doğrulanır (certificate_chain = yaprak)', d.imzali && d.zincirli, JSON.stringify(d.zincirli));
}
// Gövdeyi verilen anahtar/zincirle yeniden imzala — sondalar aynı manifestin farklı imzalarıdır.
const imzala = (ozel, zincirPem) => multipartKur({ manifest: mt.manifest, imzaBasligiDegeri: imzaBasligi(JSON.stringify(mt.manifest), ozel, K.anahtarKimligi), sertifikaZinciri: zincirPem });
const red = (ad, govde, kok, re, secim = {}) => {
  let hata = null;
  try { multipartDogrula(govde, kok, { zincir: true, ...secim }); } catch (e) { hata = e; }
  ol(`§2 sonda: ${ad} → multipartDogrula RED`, hata && re.test(hata.message), hata ? hata.message : 'KABUL ETTİ');
};
const kokAnahtar = crypto.createPrivateKey({ key: Zi.kokAnahtarPem, passphrase: Zi.parola });
red('kökle doğrudan imza (zincir parçası yok)', imzala(kokAnahtar, null), Zi.kokPem, /kod imzalama sertifikası değil/);
red('kökle doğrudan imza + kök zincir parçasında', imzala(kokAnahtar, Zi.kokPem), Zi.kokPem, /ZİNCİRİ GEÇERSİZ|YAPRAĞI GEÇERSİZ/);
red('süresi geçmiş yaprak (cihaz saati +400 gün)', mt.govde, Zi.kokPem, /SÜRESİ GEÇMİŞ/, { simdi: new Date(Date.now() + 400 * 86_400_000) });
red('yabancı kök (başka OTA köküyle derlenmiş APK)', mt.govde, Zy.kokPem, /zincirlenmiyor|ZİNCİRLENMİYOR/);
red('yabancı köke bağlı yaprak (yaprak + imza başka zincirden)', imzala(acik(Zy), Zy.yaprakPem), Zi.kokPem, /zincirlenmiyor|ZİNCİRLENMİYOR/);
red('CA yaprak (istemci kabul eder; yayıncı KATI)', imzala(acik(Zca), Zca.yaprakPem), Zca.kokPem, /yaprak CA OLAMAZ/);
red('EKU codeSigning\'siz yaprak', imzala(acik(Zeku), Zeku.yaprakPem), Zeku.kokPem, /kod imzalama sertifikası değil/);
red('zincir parçasında iki yaprak', imzala(anahtar.anahtar, `${Zi.yaprakPem}\n${Zi.yaprakPem}`), Zi.kokPem, /ZİNCİRİ GEÇERSİZ|tam olarak 1/);
{
  const govde = Buffer.from(mt.govde.toString('utf8').replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/, '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'), 'utf8');
  red('zincir parçası bozuk PEM', govde, Zi.kokPem, /GEÇERSİZ/);
}
let uyusmadi = false;
try { grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedT, anahtar: { ...anahtar, kokPem: Zy.kokPem } }); } catch (e) { uyusmadi = e instanceof OrtakOtaIhlali && /DOĞRULANMADI/.test(e.message); }
ol('§2 sonda: imza zinciri gömülü köke bağlanmıyorsa üretim DURUR', uyusmadi);

// §3 — imza malzemesi fail-closed (kuru: atılacak deneme zinciri)
const bos = path.join(GECICI, 'mobil-bos');
let yokHata = null;
try { ortakImzaAnahtari(K, bos); } catch (e) { yokHata = e; }
const toren = yokHata?.satirlar?.join('\n') ?? '';
ol('§3 malzeme yok → fail-closed + openssl zincir töreni (kök CA + parolalı yaprak + denetle)', yokHata instanceof OrtakOtaIhlali
  && /openssl genpkey[^\n]*-aes-256-cbc/.test(toren) && /-extensions ota_kok/.test(toren) && /-extensions ota_yaprak/.test(toren)
  && /OTA_KOK_ANAHTARI/.test(toren) && /ota-zinciri\.mjs denetle/.test(toren) && !/codesigning:generate|-pass pass:|-passin pass:/.test(toren), toren);
{
  const k = ortakImzaAnahtari(K, bos, { kuru: true });
  ol('§3 kuru + malzeme yok → deneme zinciri (sahte: true, kök + yaprak hatasız)', k.sahte === true && Z.kokHatalari(k.kokPem).length === 0 && Z.yaprakHatalari(k.yaprakPem, k.kokPem).length === 0);
}
const dolu = (ad, d, { anahtarPem = d.yaprakAnahtarPem, kokPem = d.kokPem } = {}) => {
  const kok = path.join(GECICI, `mobil-${ad}`);
  for (const [goreli, icerik] of [[K.otaAnahtar, anahtarPem], [K.otaYaprak, d.yaprakPem], [K.otaSertifika, kokPem]]) {
    fs.mkdirSync(path.join(kok, path.dirname(goreli)), { recursive: true });
    fs.writeFileSync(path.join(kok, goreli), icerik);
  }
  return kok;
};
const iyiKok = dolu('dolu', Zi);
ol('§3 parolalı yaprak + kök varsa gerçek (sahte: false, kid ortak kimlikten, imzalar)', (() => {
  const a = ortakImzaAnahtari(K, iyiKok, { parola: Zi.parola });
  return a.sahte === false && a.keyid === K.anahtarKimligi && multipartDogrula(grupManifestiUret({ paketDizin: iyi, kunye, expoConfig, feed: feedT, anahtar: a }).govde, Zi.kokPem, { zincir: true }).zincirli;
})());
const malzemeRed = (ad, kok, secim, re) => {
  let e = null;
  try { ortakImzaAnahtari(K, kok, secim); } catch (x) { e = x; }
  const metin = e ? `${e.message}\n${(e.satirlar ?? []).join('\n')}` : 'KABUL ETTİ';
  ol(`§3 sonda: ${ad} → imza malzemesi RED`, e instanceof OrtakOtaIhlali && re.test(metin), metin);
};
malzemeRed('parola verilmedi', iyiKok, {}, /PAROLASI VERİLMEDİ/);
malzemeRed('yanlış parola', iyiKok, { parola: 'yanlis' }, /AÇILAMADI/);
malzemeRed('korumasız (parolasız) yaprak anahtarı', dolu('parolasiz', Zi, { anahtarPem: acik(Zi).export({ type: 'pkcs8', format: 'pem' }) }), { parola: Zi.parola }, /PAROLASIZ/);
malzemeRed('bitişine 30 günden az kalan yaprak (+370 gün)', iyiKok, { parola: Zi.parola, simdi: new Date(Date.now() + 370 * 86_400_000) }, /gün kaldı \(< 30\)/);
malzemeRed('süresi geçmiş yaprak (+400 gün)', iyiKok, { parola: Zi.parola, simdi: new Date(Date.now() + 400 * 86_400_000) }, /SÜRESİ GEÇMİŞ/);
malzemeRed('yabancı OTA kökü (yaprak bu köke bağlı değil)', dolu('yabanci', Zi, { kokPem: Zy.kokPem }), { parola: Zi.parola }, /ZİNCİRLENMİYOR/);
malzemeRed('kök yerine yaprak gömülü (kök CA değil)', dolu('kok-yaprak', Zi, { kokPem: Zi.yaprakPem }), { parola: Zi.parola }, /CA DEĞİL/);
malzemeRed('CA yaprak', dolu('ca', Zca), { parola: Zca.parola }, /yaprak CA OLAMAZ/);
malzemeRed('EKU\'suz yaprak', dolu('ekusuz', Zeku), { parola: Zeku.parola }, /EKU codeSigning yok/);
{
  // Yaprak ↔ anahtar uyuşmazlığı: Zi yaprağı + kökü, Zy'nin yaprak anahtarı (parola aynı: deneme).
  malzemeRed('yaprak anahtarı yaprağın değil', dolu('uyusmaz', Zi, { anahtarPem: Zy.yaprakAnahtarPem }), { parola: Zi.parola }, /yaprak sertifikasının değil/);
}

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
// K-14: ortak tablet APK'sı yalnız Google Play'den — --apk her kipte (kuru dahil) hiçbir şey yapılmadan RED.
for (const ek of [['--grup=test', '--apk=/yok/app.apk'], ['--grup=test', '--kuru', '--apk=x.apk'], ['--grup=oncu', `--paket=${iyi}`, '--apk=x.apk'], ['--apk']]) {
  c(`K-14 ${ek.join(' ')} → Play reddi`, ek, /SİTEYE YAYINLANMAZ[\s\S]*build:aab/);
}

// §7 betik kaynağı
function betikIhlalleri(metin) {
  const kod = metin.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const f = [];
  const yer = (d) => kod.search(d);
  const ilkYazan = yer(/uzakBetik\('mkdir/);
  for (const [ad, d] of [['profil matrisi kapısı', /profilMatrisiKapisi\(\);/], ['terfi kapısı', /terfiKapisi\(surum, \{ yerel/], ['derleme bağı', /(?<!function )derlemeBagi\(\{/], ['sürüm notu kapısı', /surumNotuKapisi\(surum\)/], ['temiz ağaç', /temizAgacKapisi\(\)/], ['imza (manifest)', /grupManifestiUret\(/]]) {
    const i = yer(d);
    if (i < 0) f.push(`${ad} çağrısı YOK`);
    else if (ilkYazan >= 0 && ad !== 'imza (manifest)' && i > ilkYazan) f.push(`${ad} ilk yazan ağ işinden SONRA`);
  }
  if (!/profil-matrisi-kapisi\.mjs/.test(kod)) f.push('profil matrisi kapısı CLI çağrısı YOK');
  const paketScp = kod.search(/scp\(icerik/);
  const manifestScp = kod.search(/scp\(\[manifestYol/);
  if (paketScp < 0 || manifestScp < 0 || paketScp > manifestScp) f.push('manifest paketten ÖNCE yükleniyor (EN SON olmalı)');
  // K-14: APK yolu yok — reddi var, APK yükleyen/künye imzalayan kod yok.
  if (!/a === '--apk' \|\| a\.startsWith\('--apk='\)\) dur\(/.test(kod)) f.push('--apk reddi YOK (K-14)');
  if (/apkYayinla|grupApkKunyesi|apk-kunye\.mjs|panel-imza\.ts|apk\/surum\.json|apk-imzala/.test(kod)) f.push('APK yayın yolu GERİ GELDİ (K-14)');
  if (!/yayinEzmeleri\(/.test(kod)) f.push('hedef ezme reddi yok');
  if (/kanalCoz|yayinHedefi\(/.test(kod)) f.push('hedef ESKİ kanal kaydından çözülüyor');
  if (/etikiliyazilim\.com|\/opt\/stack/.test(kod)) f.push('yayın/VDS kökü LİTERAL');
  if (/\bfetch\(|\bcurl\b/.test(kod.replace(/belirtecliFetch\(/g, ''))) f.push('belirteçsiz okuma');
  if (!/musteri'?\)? ?(\|\||&&)|--musteri/.test(kod)) f.push('--musteri reddi yok');
  // K-2: yaprak anahtarı parolası yalnız istemden (TTY gizli / stdin) — argüman ya da ortam değişkeni DEĞİL.
  if (!/ortakAnahtarParolali\(yollar\)\) parola = await parolaSor\(/.test(kod)) f.push('yaprak parolası istemi YOK');
  if (/process\.env\.\w*(PAROLA|PASS)|'--parola|--passin|pass:/i.test(kod)) f.push('yaprak parolası argüman/ortamdan okunuyor');
  if (!/parola\?\.fill\(0\)/.test(kod)) f.push('parola tamponu sıfırlanmıyor');
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
  mut('--apk reddi kaldırıldı', (m) => m.replace("if (a === '--apk' || a.startsWith('--apk=')) dur(", 'if (false) dur('), /--apk reddi YOK/);
  mut('yaprak parolası istemi söküldü', (m) => m.replace('if (ortakAnahtarParolali(yollar)) parola = await parolaSor(', 'if (false) parola = await parolaSor('), /parolası istemi YOK/);
  mut('parola ortamdan okundu', (m) => `${m}\nconst P = process.env.TEKSERP_OTA_PAROLA;\n`, /argüman\/ortamdan/);
  mut('parola tamponu sıfırlanmıyor', (m) => m.replace('parola?.fill(0);', ''), /sıfırlanmıyor/);
  mut('APK yükleme yolu geri eklendi', (m) => `${m}\nasync function apkYayinla(y) { scp([y], 'apk/surum.json', 'x'); }\n`, /APK yayın yolu GERİ GELDİ/);
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
if (kaldi.length) { console.log(`Kırmızı: ${kaldi.join(' | ')}`); process.exit(1); }
