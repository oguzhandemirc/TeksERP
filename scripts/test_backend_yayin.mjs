#!/usr/bin/env node
// =============================================================================
// BEKÇİ — BACKEND KANAL YAYINI (Dağıtım v2 · `deploy/backend-yayinla.mjs` + `Teks-Erp/scripts/backend-bildirim.ts`)
// =============================================================================
// DB'siz, AĞSIZ: PATH'in önüne sahte `ssh` · `scp` konur (uzak = geçici dizin), kenar okuması (`fetch`) bir
// `--import` ön yükleyicisiyle sahte uzaktan cevaplanır, `HOME` geçicidir (geliştiricinin belirteci/ayarı
// okunmaz), portal bildirimi kapalıdır (`TEKSERP_YAYIN_BILDIRIMI=0`). Paket GERÇEK imza aracıyla, çalışma anında
// üretilen TEST PAKET anahtarıyla imzalanır; test çapası yalnız hazırlık kanalında kabul edilir.
//
// NE ÖLÇER:
//   §1 saf yardımcılar (`scripts/lib/backend-yayin.mjs`): sürüm önceliği = protokol `compareVersions` (ortak
//      vektör dosyası) · sürüm/paket adı deseni protokolün Zod deseniyle AYNI metin · özet çıkarımı · işaretçi
//      sürümü · yayın planı güvensiz değeri reddeder · defter satırı sekme/satır sızdırmaz
//   §2 terfi (K5) backend kaynağı: hazırlık kanalının son.json sürümü ölçülür; prova sürümü terfiye yetmez
//   §3 uçtan uca (sahte uzak): kuru kip ağa çıkmaz · ilk yayın düzeni (sürüm dizini + surum.json + son.json EN
//      SON, geçici dizin kalmaz, defter) · kenar okuması belirteçli ve yüklenenle aynı · aynı/eski sürüm DUR ·
//      yeni prova sürümü monotonluğu geçer · başka kanalın paketi · üretim kanalına prova · kurcalı paket ·
//      sürüm notu yok · belirteç yok · uzakta bozulan dosya (son.json DEĞİŞMEZ, geçici silinir) — her DUR'da
//      uzağa yazma SIFIR · PG paketi (sözleşme sürümü 2): hedeflenen PG kanalda yoksa backend DUR · `--pg-yayinla`
//      değişmez dizine yazar, son.json'a dokunmaz, ikinci kez DUR · bildirim PG hedefini künyeden alır (içerik
//      özeti zip'teki manifestodan ölçülür) · künyeyle tutmayan zip / yanlış ICU → DUR · PG TEK KAYNAK
//      (`deploy/pg/pg-surumu.json`): --pg-* argümanı kayıttan farklıysa DUR, verilmezse pg bloğu kayıttan;
//      kaydın sürüm/derleme/ICU'su olmayan künye (backend hedefi ya da --pg-yayinla) DUR; zip'te tek ICU
//
//   node scripts/test_backend_yayin.mjs
// =============================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PAKET_ADI_DESENI,
  SURUM_DESENI,
  defterKomutu,
  defterSatiri,
  isaretciSurumu,
  ozetCikar,
  surumKiyasla,
  yayinPlani,
} from './lib/backend-yayin.mjs';
import { kaynakSurumleri, terfiHukmu } from './lib/terfi.mjs';
import { kayitOku } from './lib/kanallar.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEKS = path.join(KOK, 'Teks-Erp');
let gecti = 0;
const kaldi = [];
function ol(ad, kosul, detay) {
  if (kosul) {
    gecti += 1;
    console.log(`✅ ${ad}`);
  } else {
    kaldi.push(ad);
    console.log(`❌ ${ad}${detay ? `\n   ${String(detay).split('\n').slice(0, 14).join('\n   ')}` : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * §1 saf yardımcılar
 * ------------------------------------------------------------------ */

function bolum1() {
  console.log('\n§1 — saf yardımcılar');
  const vektorler = JSON.parse(fs.readFileSync(path.join(TEKS, 'native/test-vektorleri/guncelleme-karar.json'), 'utf8')).kayitlar
    .filter((k) => k.vektor.tur === 'surum-karsilastir');
  const farkli = vektorler.filter((k) => surumKiyasla(k.vektor.a, k.vektor.b) !== k.beklenen);
  ol(`§1a sürüm önceliği = protokol compareVersions (${vektorler.length} ortak vektör)`, vektorler.length >= 8 && farkli.length === 0,
    farkli.map((k) => `${k.vektor.a} ? ${k.vektor.b}: ${surumKiyasla(k.vektor.a, k.vektor.b)} ≠ ${k.beklenen}`).join('\n'));
  const belgeler = fs.readFileSync(path.join(TEKS, 'src/lib/license/protocol/belgeler.ts'), 'utf8');
  const guncelleme = fs.readFileSync(path.join(TEKS, 'src/lib/license/protocol/guncelleme-ortak.ts'), 'utf8');
  const zodSurum = /export const ReleaseVersionSchema = z\.string\(\)\.regex\(\/(.+)\/\);/.exec(belgeler)?.[1];
  const zodAd = /const ArtifactNameSchema = z\.string\(\)\.max\(120\)\.regex\(\/(.+)\/\);/.exec(guncelleme)?.[1];
  ol('§1b sürüm deseni protokolün ReleaseVersionSchema deseniyle AYNI metin', zodSurum !== undefined && zodSurum === SURUM_DESENI.source, `${zodSurum} ↔ ${SURUM_DESENI.source}`);
  ol('§1c paket adı deseni protokolün ArtifactNameSchema deseniyle AYNI metin', zodAd !== undefined && zodAd === PAKET_ADI_DESENI.source, `${zodAd} ↔ ${PAKET_ADI_DESENI.source}`);
  const md = '# Backend `9.9.9`\n\n**Paket:** x\n\n## 1. Özet\n\nİlk satır  **kalın**\nikinci satır.\n\n## 2. Ne değişti\n\n- madde\n';
  ol('§1d özet: "Özet" başlığından sıradaki ## başlığına, boşluklar tekil', ozetCikar(md) === 'İlk satır **kalın** ikinci satır.', ozetCikar(md));
  ol('§1e özet bölümü yoksa/boşsa null (sürüm notu kapısı durur)', ozetCikar('# x\n## Ne değişti\nx') === null && ozetCikar('## 1. Özet\n\n\n## 2. x') === null);
  const uzun = ozetCikar(`## Özet\n${'kelime '.repeat(600)}\n## Son`);
  ol('§1f uzun özet 2000 karakterde kelime sınırında kesilir', uzun !== null && uzun.length <= 2000 && uzun.endsWith('…') && !uzun.includes('kelim…'), String(uzun?.length));
  const yuk = Buffer.from(JSON.stringify({ v: 1, surum: '2.11.0' })).toString('base64url');
  ol('§1g işaretçi sürümü okunur; biçimsiz işaretçi null', isaretciSurumu(JSON.stringify({ v: 1, bildirim: `a.${yuk}.c` })) === '2.11.0' &&
    isaretciSurumu('<html>') === null && isaretciSurumu(JSON.stringify({ v: 1, bildirim: 'x' })) === null);
  const temel = { vdsBackend: '/opt/v/html/k1/backend', backendDefter: '/opt/v/defter/k1-BACKEND-YAYIN-DEFTERI.tsv', surum: '2.11.0', paketAd: 'tekserp-backend-2.11.0.zip', damga: 'abc123' };
  const p = yayinPlani(temel);
  ol('§1h plan: sürüm dizini, nokta önekli geçici ad, son.json kökte', p.surumDizini === '/opt/v/html/k1/backend/2.11.0' && p.gecici.startsWith('/opt/v/html/k1/backend/.yukleniyor-2.11.0-') && p.sonJson === '/opt/v/html/k1/backend/son.json');
  const atar = (ek) => { try { yayinPlani({ ...temel, ...ek }); return false; } catch { return true; } };
  ol('§1i plan güvensiz değeri REDDEDER (kabuk enjeksiyonu yok)',
    atar({ surum: "2.11.0';rm -rf /;'" }) && atar({ surum: '2.11.0+abc' }) && atar({ vdsBackend: '/opt/v/../etc' }) &&
    atar({ paketAd: "a'b.zip" }) && atar({ paketAd: '../x.zip' }) && atar({ pgAd: 'pg;.zip' }) && atar({ damga: 'a b' }) && !atar({}));
  const satir = defterSatiri({ zaman: 'z', surum: '2.11.0', kim: 'a@b', sha16: 's', boyut: 1, terfiAtla: "kullanıcı\tdedi\n'x'" });
  ol('§1j defter satırı sekme/satır sızdırmaz, altı kolon', satir.split('\t').length === 6 && !/[\r\n]/.test(satir));
  ol("§1k defter komutu tek tırnağı kaçırır (içerik biçim dizesine girmez)", defterKomutu('/opt/v/defter/k.tsv', "a'b").includes("'a'\\''b'") && defterKomutu('/opt/v/defter/k.tsv', 'x').includes("printf '%s\\n'"));
}

/* ------------------------------------------------------------------ *
 * §2 terfi — backend kaynağı
 * ------------------------------------------------------------------ */

function bolum2() {
  console.log('\n§2 — terfi (K5) backend kaynağı: hazırlık kanalının son.json sürümü');
  const kayit = kayitOku(KOK);
  const kaynak = kayit.kanallar.testfabrika;
  const isaretci = (s) => JSON.stringify({ v: 1, bildirim: `h.${Buffer.from(JSON.stringify({ v: 1, surum: s })).toString('base64url')}.i` });
  const okuyan = (govde) => (url) => (url === kaynak.yayin.backendManifest ? { durum: 'var', govde } : { durum: 'olculemedi', neden: `beklenmeyen ${url}` });
  const k = kaynakSurumleri(kaynak, 'backend', okuyan(isaretci('2.12.1')));
  ol('§2a kaynak = testfabrika backendManifest, sürüm okunur', k.length === 1 && k[0].durum === 'var' && k[0].surum === '2.12.1', JSON.stringify(k));
  const git = { bas: 'a'.repeat(40), surumEtiketi: 'a'.repeat(40), terfiEtiketi: { tur: 'tag', commit: 'a'.repeat(40), mesaj: 'testfabrika kullanıcı testinde yeşil, onaylıyorum 2026-09-30' } };
  const h = (surum, kaynaklar) => terfiHukmu({ kod: 'adnansahin', urun: 'backend', surum, kaynak: 'testfabrika', git, kaynaklar, atla: undefined });
  ol('§2b hazırlıkta aynı sürüm yayındaysa terfi UYUMLU', h('2.12.1', k).sonuc === 'uyumlu');
  ol('§2c hazırlıkta yalnız PROVA varsa terfi İHLAL (üretime yalnız hazırlıkta yayınlanmış sürüm)', h('2.12.1', kaynakSurumleri(kaynak, 'backend', okuyan(isaretci('2.12.1-prova.5')))).sonuc === 'ihlal');
  ol('§2d hazırlıkta son.json yoksa İHLAL (yayın yok)', h('2.12.1', kaynakSurumleri(kaynak, 'backend', () => ({ durum: 'yok' }))).sonuc === 'ihlal');
  ol('§2e son.json okunamazsa ÖLÇÜLEMEDİ (fail-closed)', h('2.12.1', kaynakSurumleri(kaynak, 'backend', () => ({ durum: 'var', govde: '<html>' }))).sonuc === 'olculemedi');
}

/* ------------------------------------------------------------------ *
 * §3 uçtan uca — sahte uzak
 * ------------------------------------------------------------------ */

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-backend-yayin-bekci-'));
const UZAK = path.join(GECICI, 'uzak');
const BIN = path.join(GECICI, 'bin');
const LOG = path.join(GECICI, 'uzak.log');
const HOME = path.join(GECICI, 'home');
const VDS_KOK = '/opt/stack/apps/tekserp-guncelleme';

function sahteAraclarKur() {
  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(path.join(HOME, '.tekserp'), { recursive: true });
  fs.mkdirSync(UZAK, { recursive: true });
  // ssh: son argüman uzak komut; VDS kökü sahte uzağa çevrilir. sha256sum/stat GNU biçimi (VDS Linux).
  fs.writeFileSync(path.join(BIN, 'ssh'), `#!/bin/sh
for a in "$@"; do komut="$a"; done
printf 'ssh\\t%s\\n' "$komut" >> '${LOG}'
komut=$(printf '%s' "$komut" | sed 's#${VDS_KOK}#${UZAK}#g')
sha256sum() { shasum -a 256 "$@"; }
stat() { if [ "$1" = "-c" ]; then shift 2; wc -c < "$1" | tr -d ' '; else command stat "$@"; fi; }
eval "$komut"
`, { mode: 0o755 });
  // scp: yerel → uzak; SAHTE_SCP_BOZ=1 iken paket kısaltılır (uzakta ölçüm DUR demeli).
  fs.writeFileSync(path.join(BIN, 'scp'), `#!/bin/sh
for a in "$@"; do onceki="$son"; son="$a"; done
hedef=$(printf '%s' "$son" | sed 's#^[^:]*:##; s#${VDS_KOK}#${UZAK}#g')
printf 'scp\\t%s\\n' "$son" >> '${LOG}'
cp "$onceki" "$hedef" || exit 1
case "$hedef" in *.zip) [ "$SAHTE_SCP_BOZ" = "1" ] && printf 'x' >> "$hedef";; esac
exit 0
`, { mode: 0o755 });
  // Kenar: fetch güncelleme sunucusu adresini sahte uzaktan cevaplar; belirteç başlığını kaydeder.
  fs.writeFileSync(path.join(GECICI, 'sahte-fetch.mjs'), `import fs from 'node:fs';
globalThis.fetch = async (url, secenek = {}) => {
  const u = new URL(String(url));
  const baslik = secenek.headers?.['X-TKL-Indirme'] ?? null;
  fs.appendFileSync(${JSON.stringify(LOG)}, 'fetch\\t' + u.pathname + '\\t' + (baslik ? 'belirtecli' : 'ANONIM') + '\\n');
  if (u.hostname !== 'guncelleme.etkiliyazilim.com') return new Response('ag yasak', { status: 599 });
  const yol = ${JSON.stringify(path.join(UZAK, 'html'))} + u.pathname;
  if (!baslik) return new Response('belirtec yok', { status: 403 });
  return fs.existsSync(yol) ? new Response(fs.readFileSync(yol), { status: 200 }) : new Response('yok', { status: 404 });
};
`);
  fs.writeFileSync(path.join(HOME, '.tekserp', 'yayin-belirteci'), `sahte-yayin-belirteci-${'x'.repeat(24)}\n`, { mode: 0o600 });
}

function tsx(args, secenek = {}) {
  return execFileSync(process.execPath, ['--import', 'tsx', ...args], { cwd: TEKS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...secenek });
}

/** Test PAKET anahtarı (hazırlık biçimi, parolasız) + çapa dosyası. */
function anahtarKur() {
  const dizin = path.join(GECICI, 'anahtar');
  tsx(['scripts/build-korumali-imza.ts', 'anahtar-uret', '--kid=paket-hazirlik-bekci', `--dizin=${dizin}`]);
  const dosya = path.join(dizin, 'paket-hazirlik-bekci.paket.json');
  const k = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  const capa = path.join(GECICI, 'capa.json');
  fs.writeFileSync(capa, JSON.stringify([{ kid: k.kid, x: k.x }]));
  return { dosya, capa };
}

/** İmzalı test paketi: künye + birkaç kapsam dosyası, gerçek imza aracıyla; zip kökünde PAKET.json. */
function paketKur(ad, { surum, kanal, prova = false, anahtar, kurcala = false }) {
  const kok = path.join(GECICI, `paket-${ad}`);
  fs.mkdirSync(path.join(kok, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(kok, 'prisma/migrations/20260101000000_ilk'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'dist/server.js'), `console.log(${JSON.stringify(surum)});\n`);
  fs.writeFileSync(path.join(kok, 'package.json'), `${JSON.stringify({ name: 'teks-erp', version: surum })}\n`);
  fs.writeFileSync(path.join(kok, 'prisma/migrations/20260101000000_ilk/migration.sql'), 'SELECT 1;\n');
  fs.writeFileSync(path.join(kok, 'PAKET.json'), `${JSON.stringify({
    ad, commit: '91c79ebd', backendKanal: kanal, korumali: true, korumaHedef: 'win-x64', runtimeNodeSurumu: '24.18.0',
    uygulamaSurumu: surum, prova, migrationSayisi: 1, dosyaSayisi: 4,
  }, null, 2)}\n`);
  tsx(['scripts/build-korumali-imza.ts', 'imzala', `--kok=${kok}`, `--anahtar=${anahtar}`, `--surum=${surum}`, '--urun=backend',
    `--musteri=${kanal}`, '--derleme-tarihi=2026-09-30T10:00:00.000Z']);
  if (kurcala) fs.appendFileSync(path.join(kok, 'dist/server.js'), '// sonradan eklendi\n');
  const zip = path.join(GECICI, `${ad}.zip`);
  execFileSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: kok });
  return zip;
}

function yayinla(argumanlar, ortam = {}) {
  fs.writeFileSync(LOG, '');
  const r = spawnSync(process.execPath, ['--import', path.join(GECICI, 'sahte-fetch.mjs'), path.join(KOK, 'deploy/backend-yayinla.mjs'), ...argumanlar], {
    cwd: KOK,
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
      HOME,
      TEKSERP_YAYIN_BILDIRIMI: '0',
      TEKSERP_YAYIN_BELIRTECI: path.join(HOME, '.tekserp', 'yayin-belirteci'),
      TEKSERP_YAYIN_BELIRTEC_KAYNAGI: path.join(HOME, '.tekserp', 'yok.json'),
      TEKSERP_TEST_PAKET_CAPASI: ORTAK.capa,
      SSH_HEDEF: 'sahte-yayin',
      ...ortam,
    },
  });
  const log = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((s) => s.split('\t'));
  const yazma = log.filter(([t, c]) => t === 'scp' || (t === 'ssh' && /\b(mkdir|mv|printf|rm)\b/.test(c)));
  return { kod: r.status, cikti: `${r.stdout}\n${r.stderr}`, log, yazma };
}

const ORTAK = {};
/** PG sürüm kaydı (tek kaynak): yayıncı bildirimin pg bloğunu ve hedef PG kimliğini buradan alır. */
const PG_KAYDI = JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/pg/pg-surumu.json'), 'utf8'));
const uzakDosya = (rel) => path.join(UZAK, 'html', rel);

function bolum3() {
  console.log('\n§3 — uçtan uca (sahte ssh/scp, sahte kenar, gerçek imza aracı)');
  sahteAraclarKur();
  Object.assign(ORTAK, anahtarKur());
  const ortak = (zip, ek = []) => ['--musteri=testfabrika', `--paket=${zip}`, `--anahtar=${ORTAK.dosya}`, '--pg-cizgi=16', '--pg-en-az=16.9', ...ek];
  const p1 = paketKur('p1', { surum: '9.9.9-prova.1', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });

  const kuru = yayinla(ortak(p1, ['--kuru']));
  ol('§3a kuru kip: çıkış 0, uzağa YAZMA SIFIR, kenar okuması YOK', kuru.kod === 0 && kuru.yazma.length === 0 && !kuru.log.some(([t]) => t === 'fetch'), kuru.cikti.slice(-600));

  const ilk = yayinla(ortak(p1));
  const sonJson = uzakDosya('testfabrika/backend/son.json');
  const surumJson = uzakDosya('testfabrika/backend/9.9.9-prova.1/surum.json');
  ol('§3b ilk yayın: çıkış 0', ilk.kod === 0, ilk.cikti.slice(-900));
  ol('§3c sürüm dizininde paket + surum.json; son.json = surum.json (bayt bayt)', fs.existsSync(uzakDosya('testfabrika/backend/9.9.9-prova.1/p1.zip')) &&
    fs.existsSync(sonJson) && fs.readFileSync(sonJson, 'utf8') === fs.readFileSync(surumJson, 'utf8'));
  const sira = ilk.log.map(([t, c]) => `${t}:${c}`);
  const dizinMv = sira.findIndex((x) => /mv .*\.yukleniyor-9\.9\.9-prova\.1-/.test(x));
  const sonMv = sira.findIndex((x) => /mv .*\.son\.json\..*son\.json/.test(x));
  const sonScp = sira.findIndex((x) => /^scp:.*\.son\.json\./.test(x));
  ol('§3d SIRA: paket → ölçüm → dizin yeniden adı → son.json EN SON', dizinMv > 0 && sonScp > dizinMv && sonMv > sonScp &&
    sonMv === Math.max(...sira.map((x, i) => (/^(scp|ssh):/.test(x) && !/printf/.test(x) ? i : -1))), sira.join('\n'));
  const kalan = fs.readdirSync(uzakDosya('testfabrika/backend')).filter((f) => f.startsWith('.'));
  ol('§3e geçici dizin/dosya kalmadı', kalan.length === 0, kalan.join(','));
  const defter = path.join(UZAK, 'defter', 'testfabrika-BACKEND-YAYIN-DEFTERI.tsv');
  ol('§3f yayın defteri html/ DIŞINDA, bir satır, backend-<sürüm>', fs.existsSync(defter) && /\tbackend-9\.9\.9-prova\.1\t/.test(fs.readFileSync(defter, 'utf8')));
  const kenar = ilk.log.filter(([t]) => t === 'fetch');
  ol('§3g kenar okuması BELİRTEÇLİ ve yalnız testfabrika/backend/son.json', kenar.length >= 1 && kenar.every(([, y, b]) => y === '/testfabrika/backend/son.json' && b === 'belirtecli'), JSON.stringify(kenar));
  const isaretci = JSON.parse(fs.readFileSync(sonJson, 'utf8'));
  const bildirim = JSON.parse(Buffer.from(isaretci.bildirim.split('.')[1], 'base64url').toString('utf8'));
  ol('§3h bildirim: kanal · sürüm · paket özeti · imzalayan = paketin anahtarı · PG alt sınırı', bildirim.kanal === 'testfabrika' && bildirim.surum === '9.9.9-prova.1' &&
    bildirim.paketImzaKid === 'paket-hazirlik-bekci' && bildirim.pg.cizgi === 16 && bildirim.pg.enAz === '16.9' && bildirim.pg.hedef === null &&
    bildirim.paket.boyut === fs.statSync(p1).size);

  const tekrar = yayinla(ortak(p1));
  ol('§3i aynı sürüm ikinci kez → DUR (monotonluk), uzağa yazma SIFIR', tekrar.kod !== 0 && tekrar.yazma.length === 0 && /YENİ değil/.test(tekrar.cikti), tekrar.cikti.slice(-400));
  const eski = paketKur('p0', { surum: '9.9.9-prova.0', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });
  const r0 = yayinla(ortak(eski));
  ol('§3j eski sürüm → DUR (geri inme yok), yazma SIFIR', r0.kod !== 0 && r0.yazma.length === 0);
  const p2 = paketKur('p2', { surum: '9.9.9-prova.2', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });
  const r2 = yayinla(ortak(p2));
  ol('§3k yeni prova sürümü (sayısal kimlik) monotonluğu geçer, son.json ilerler', r2.kod === 0 && isaretciSurumu(fs.readFileSync(sonJson, 'utf8')) === '9.9.9-prova.2', r2.cikti.slice(-500));

  const yabanci = paketKur('py', { surum: '9.9.9-prova.3', kanal: 'demofabrika', prova: true, anahtar: ORTAK.dosya });
  const ry = yayinla(ortak(yabanci));
  ol('§3l başka kanalın paketi → DUR, uzak/kenar SIFIR', ry.kod !== 0 && ry.log.length === 0 && /kanalı için üretilmiş/.test(ry.cikti));
  const provaUretim = paketKur('pu', { surum: '9.9.9-prova.4', kanal: 'adnansahin', prova: true, anahtar: ORTAK.dosya });
  const ru = yayinla(['--musteri=adnansahin', `--paket=${provaUretim}`, `--anahtar=${ORTAK.dosya}`, '--pg-cizgi=16', '--pg-en-az=16.9']);
  ol('§3m üretim kanalına PROVA → DUR, uzak SIFIR', ru.kod !== 0 && ru.log.length === 0 && /PROVA/.test(ru.cikti));
  const kurcali = paketKur('pk', { surum: '9.9.9-prova.5', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya, kurcala: true });
  const rk = yayinla(ortak(kurcali));
  ol('§3n imzadan sonra kurcalanmış paket → DUR (bütünlük), uzak SIFIR', rk.kod !== 0 && rk.log.length === 0 && /bütünlüğü GECERSIZ/.test(rk.cikti), rk.cikti.slice(-400));
  const notsuz = paketKur('pn', { surum: '9.9.10', kanal: 'testfabrika', anahtar: ORTAK.dosya });
  const rn = yayinla(ortak(notsuz));
  ol('§3o prova olmayan sürümün notu yok → DUR (sürüm notu kapısı), uzak SIFIR', rn.kod !== 0 && rn.log.length === 0 && /SÜRÜM NOTU YOK/.test(rn.cikti));
  const p6 = paketKur('p6', { surum: '9.9.9-prova.6', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });
  fs.renameSync(path.join(HOME, '.tekserp', 'yayin-belirteci'), path.join(HOME, '.tekserp', 'yayin-belirteci.kenara'));
  const rb = yayinla(ortak(p6));
  fs.renameSync(path.join(HOME, '.tekserp', 'yayin-belirteci.kenara'), path.join(HOME, '.tekserp', 'yayin-belirteci'));
  ol('§3p yayın belirteci yok → DUR, uzağa yazma SIFIR', rb.kod !== 0 && rb.yazma.length === 0 && /BELİRTECİ YOK/.test(rb.cikti), rb.cikti.slice(-300));
  const once = fs.readFileSync(sonJson, 'utf8');
  const rz = yayinla(ortak(p6), { SAHTE_SCP_BOZ: '1' });
  ol('§3q uzakta bozulan paket → DUR, son.json DEĞİŞMEDİ, geçici silindi, sürüm dizini yok', rz.kod !== 0 && fs.readFileSync(sonJson, 'utf8') === once &&
    !fs.existsSync(uzakDosya('testfabrika/backend/9.9.9-prova.6')) && fs.readdirSync(uzakDosya('testfabrika/backend')).filter((f) => f.startsWith('.')).length === 0, rz.cikti.slice(-400));
  const rpg = yayinla(ortak(p6, []).map((a) => (a.startsWith('--pg-en-az=') ? '--pg-en-az=16.8' : a)));
  ol('§3r --pg-en-az kayıttan (deploy/pg/pg-surumu.json) FARKLI → DUR, uzak SIFIR', rpg.kod !== 0 && rpg.log.length === 0 && /kayıttaki değerden/.test(rpg.cikti), rpg.cikti.slice(-300));
  const rkayit = yayinla([...ortak(p6, []).filter((a) => !a.startsWith('--pg-')), '--kuru']);
  const kayitYolu = /imzasız bildirim: (\S+sonuc\.json)/.exec(rkayit.cikti)?.[1];
  const kb = kayitYolu && fs.existsSync(kayitYolu) ? JSON.parse(fs.readFileSync(kayitYolu, 'utf8')).bildirim : null;
  ol("§3r' --pg-* verilmeden → bildirimin pg bloğu KAYITTAN (cizgi · backendEnAz), uzağa yazma SIFIR", rkayit.kod === 0 && rkayit.yazma.length === 0 &&
    kb?.pg?.cizgi === Number(PG_KAYDI.cizgi) && kb?.pg?.enAz === PG_KAYDI.backendEnAz, rkayit.cikti.slice(-400));
  bolum3pg(ortak);
}

/** PG paketi (sözleşme sürümü 2): ayrı değişmez dizin, ayrı künye; backend bildirimi hedefi künyeden alır. */
function bolum3pg(ortak) {
  console.log('\n§3pg — PostgreSQL paketi (sözleşme sürümü 2)');
  const pgKok = path.join(GECICI, 'pg-sahne');
  fs.mkdirSync(path.join(pgKok, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pgKok, 'bin/postgres.exe'), 'sahte');
  fs.writeFileSync(path.join(pgKok, 'bin/icuuc67.dll'), 'sahte');
  fs.writeFileSync(path.join(pgKok, 'TEKSERP-ICERIK.sha256'), 'aa  bin/postgres.exe\nbb  bin/icuuc67.dll\n');
  const pgZip = path.join(GECICI, 'postgresql-16.15-4-win-x64.zip');
  execFileSync('zip', ['-q', '-r', '-X', pgZip, '.'], { cwd: pgKok });
  const pgCikti = path.join(GECICI, 'pg-kunye');
  tsx(['scripts/backend-bildirim.ts', 'pg-imzala', `--zip=${pgZip}`, '--cizgi=16', '--surum=16.15', '--derleme=4', '--icu=67', `--anahtar=${ORTAK.dosya}`, `--cikti=${pgCikti}`]);
  const pgJson = path.join(pgCikti, 'pg.json');
  const pgImzala = (zip, ek) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', 'pg-imzala', `--zip=${zip}`, ...ek,
    `--anahtar=${ORTAK.dosya}`, `--cikti=${path.join(GECICI, `pg-yanlis-${Math.random().toString(36).slice(2)}`)}`], { cwd: TEKS, encoding: 'utf8' });
  const yanlisIcu = pgImzala(pgZip, ['--icu=74']);
  ol('§3s pg-imzala: --icu kayıttan (pg-surumu.json) farklı → DUR', yanlisIcu.status !== 0 && /kayıttaki değerden/.test(yanlisIcu.stderr), yanlisIcu.stderr.slice(-200));
  const icuZip = (ad, dll) => {
    const kok = path.join(GECICI, `pg-${ad}`);
    fs.mkdirSync(path.join(kok, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(kok, 'bin/postgres.exe'), 'sahte');
    for (const d of dll) fs.writeFileSync(path.join(kok, `bin/${d}`), 'sahte');
    fs.writeFileSync(path.join(kok, 'TEKSERP-ICERIK.sha256'), 'aa  bin/postgres.exe\n');
    const z = path.join(GECICI, `${ad}.zip`);
    execFileSync('zip', ['-q', '-r', '-X', z, '.'], { cwd: kok });
    return z;
  };
  const baskaIcu = pgImzala(icuZip('baska-icu', ['icuuc74.dll']), []);
  ol("§3s' pg-imzala: zip kaydın ICU'sunu (icuuc67) taşımıyor → DUR", baskaIcu.status !== 0 && /icuuc67\.dll yok/.test(baskaIcu.stderr), baskaIcu.stderr.slice(-200));
  const ikiIcu = pgImzala(icuZip('iki-icu', ['icuuc67.dll', 'icuuc70.dll']), []);
  ol("§3s'' pg-imzala: zip'te iki ICU → DUR (künyenin icuSurum'u tek)", ikiIcu.status !== 0 && /birden çok ICU/.test(ikiIcu.stderr), ikiIcu.stderr.slice(-200));
  const sonJson = uzakDosya('testfabrika/backend/son.json');
  const once = fs.readFileSync(sonJson, 'utf8');
  const p7 = paketKur('p7', { surum: '9.9.9-prova.7', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });
  const r0 = yayinla(ortak(p7, [`--pg-kunye=${pgJson}`]));
  ol('§3t hedeflenen PG kanalda YOKKEN backend yayını → DUR, yazma SIFIR', r0.kod !== 0 && r0.yazma.length === 0 && /bu kanalda YOK/.test(r0.cikti), r0.cikti.slice(-400));
  const bozukZip = path.join(GECICI, 'bozuk', 'postgresql-16.15-4-win-x64.zip');
  fs.mkdirSync(path.dirname(bozukZip), { recursive: true });
  fs.writeFileSync(bozukZip, Buffer.concat([fs.readFileSync(pgZip), Buffer.from('x')]));
  const rb = yayinla(['--musteri=testfabrika', '--pg-yayinla', `--pg-paket=${bozukZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3u künyeyle tutmayan PG zip → DUR, uzak SIFIR', rb.kod !== 0 && rb.log.length === 0 && /TUTMUYOR/.test(rb.cikti), rb.cikti.slice(-300));
  const ry = yayinla(['--musteri=testfabrika', '--pg-yayinla', `--pg-paket=${pgZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3v --pg-yayinla: değişmez dizinde paket + pg.json, son.json DEĞİŞMEDİ, geçici yok', ry.kod === 0 &&
    fs.existsSync(uzakDosya('testfabrika/backend/pg/16.15-4/postgresql-16.15-4-win-x64.zip')) && fs.existsSync(uzakDosya('testfabrika/backend/pg/16.15-4/pg.json')) &&
    fs.readFileSync(sonJson, 'utf8') === once && fs.readdirSync(uzakDosya('testfabrika/backend/pg')).filter((f) => f.startsWith('.')).length === 0, ry.cikti.slice(-500));
  const defter = fs.readFileSync(path.join(UZAK, 'defter', 'testfabrika-BACKEND-YAYIN-DEFTERI.tsv'), 'utf8');
  ol('§3w PG yayını defterde (pg-16.15-4)', /\tpg-16\.15-4\t/.test(defter));
  const ry2 = yayinla(['--musteri=testfabrika', '--pg-yayinla', `--pg-paket=${pgZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3x aynı PG ikinci kez → DUR (değişmez), yazma SIFIR', ry2.kod !== 0 && ry2.yazma.length === 0 && /ZATEN VAR/.test(ry2.cikti));
  const r1 = yayinla(ortak(p7, [`--pg-kunye=${pgJson}`]));
  const b = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(sonJson, 'utf8')).bildirim.split('.')[1], 'base64url').toString('utf8'));
  const icerik = execFileSync('shasum', ['-a', '256', path.join(pgKok, 'TEKSERP-ICERIK.sha256')], { encoding: 'utf8' }).split(' ')[0];
  const zipOzet = execFileSync('shasum', ['-a', '256', pgZip], { encoding: 'utf8' }).split(' ')[0];
  ol('§3y backend bildirimi PG hedefini KÜNYEDEN alır (sürüm · derleme · zip özeti · içerik özeti ölçülmüş · ICU)', r1.kod === 0 && b.pg.hedef?.surum === '16.15' &&
    b.pg.hedef?.derleme === 4 && b.pg.hedef?.paket?.sha256 === zipOzet && b.pg.hedef?.icerikSha256 === icerik && b.pg.hedef?.icuSurum === '67', r1.cikti.slice(-400));
  const sahteKunye = path.join(GECICI, 'pg-baska-surum.json');
  const yuk = { v: 1, urun: 'postgresql', platform: 'win32-x64', cizgi: 16, surum: '16.14', derleme: 4, paket: { ad: 'postgresql-16.14-4-win-x64.zip', boyut: 1, sha256: 'a'.repeat(64) }, icerikSha256: 'b'.repeat(64), icuSurum: '67', yayinZamani: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(sahteKunye, JSON.stringify({ v: 1, bildirim: `e30.${Buffer.from(JSON.stringify(yuk)).toString('base64url')}.imza` }));
  const p8 = paketKur('p8', { surum: '9.9.9-prova.8', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya });
  const rs = yayinla(ortak(p8, [`--pg-kunye=${sahteKunye}`]));
  ol('§3z hedef PG künyesi kaydın sürümü değil (16.14 ≠ kayıt) → DUR, uzak SIFIR', rs.kod !== 0 && rs.log.length === 0 && /KAYITLA UYUŞMUYOR/.test(rs.cikti), rs.cikti.slice(-300));
  const rsy = yayinla(['--musteri=testfabrika', '--pg-yayinla', `--pg-paket=${pgZip}`, `--pg-kunye=${sahteKunye}`]);
  ol("§3z' --pg-yayinla kaydın sürümü olmayan künyeyle → DUR, uzak SIFIR", rsy.kod !== 0 && rsy.log.length === 0 && /KAYITLA UYUŞMUYOR/.test(rsy.cikti), rsy.cikti.slice(-300));
}

function main() {
  try {
    bolum1();
    bolum2();
    bolum3();
  } finally {
    fs.rmSync(GECICI, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  process.exit(kaldi.length === 0 ? 0 : 1);
}

main();
