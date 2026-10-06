#!/usr/bin/env node
// =============================================================================
// BEKÇİ — BACKEND GRUP YAYINI (Dağıtım v2 · `deploy/backend-yayinla.mjs` + `Teks-Erp/scripts/backend-bildirim.ts`)
// =============================================================================
// DB'siz, AĞSIZ: PATH'in önüne sahte `ssh` · `scp` konur (uzak = geçici dizin), kenar okuması (`fetch`) bir
// `--import` ön yükleyicisiyle sahte uzaktan cevaplanır, `HOME` geçicidir (geliştiricinin belirteci/ayarı
// okunmaz), portal bildirimi kapalıdır (`TEKSERP_YAYIN_BILDIRIMI=0`). Paket GERÇEK imza aracıyla, çalışma anında
// üretilen TEST PAKET anahtarıyla imzalanır. Uçtan uca GERÇEK yükleme (§3) yeni adres kapısı kapalı olduğu için
// GEÇİCİ bir git ağacında koşar: o ağaçta yalnız iki satır yamalanır (YENI_ADRES_KAPISI.acik ve test çapası reddi;
// yama tutmazsa bekçi DURUR); gerçek ağacın kapısı kapalı kalır ve §3G onu ölçer.
//
// NE ÖLÇER:
//   §1 saf yardımcılar (`scripts/lib/backend-yayin.mjs`): sürüm önceliği = protokol `compareVersions` (ortak
//      vektör dosyası) · sürüm/paket adı deseni protokolün Zod deseniyle AYNI metin · özet çıkarımı · işaretçi
//      sürümü · yayın planı güvensiz değeri reddeder · defter satırı sekme/satır sızdırmaz · yayın komutu dosya
//      kipini açıkça verir (scp yerel 0600'ı taşır → nginx 403; §3c2 uçtan uca ölçer)
//   §2 terfi backend kaynağı: kaynak grubun (test) son.json sürümü ölçülür; prova sürümü terfiye yetmez
//   §3 uçtan uca (sahte uzak, geçici ağaç, test grubu): kuru kip ağa çıkmaz · ilk yayın düzeni (sürüm dizini +
//      surum.json + son.json EN SON, geçici dizin kalmaz, defter) · kenar okuması belirteçli ve yüklenenle aynı ·
//      aynı/eski sürüm DUR · yeni sürüm monotonluğu geçer · kanallı paket · PROVA paketi · kurcalı paket ·
//      sürüm notu yok · belirteç yok · uzakta bozulan dosya (son.json DEĞİŞMEZ, geçici silinir) — her DUR'da
//      uzağa yazma SIFIR · PG paketi (sözleşme sürümü 2): hedeflenen PG kanalda yoksa backend DUR · `--pg-yayinla`
//      değişmez dizine yazar, son.json'a dokunmaz, ikinci kez DUR · bildirim PG hedefini künyeden alır (içerik
//      özeti zip'teki manifestodan ölçülür) · künyeyle tutmayan zip / yanlış ICU → DUR · PG TEK KAYNAK
//      (`deploy/pg/pg-surumu.json`): --pg-* argümanı kayıttan farklıysa DUR, verilmezse pg bloğu kayıttan;
//      kaydın sürüm/derleme/ICU'su olmayan künye (backend hedefi ya da --pg-yayinla) DUR; zip'te tek ICU ·
//      §3G (G3) bildirim aracının PAKET çapası kanalın kipinden: kip zorunlu · tanınmayan kip · üretim kanalı hazırlık
//      kipiyle DUR · üretim kipinin gerçek çapası hazırlık ailesi imzalı paketi REDDEDER (kontrol: test çapasıyla geçer)
//   §3O (O11a) `ortak-dogrula`: ortak paket test imzasıyla GEÇER (gerçek üretim çapasıyla DUR — kabul çapadan) ·
//      hazırlık kipi · kipsiz · kanallı paket · hazırlık kid'i · PROVA · müşterili künye · kurcalı → DUR
//   §3G (O11b) GRUP YAYINI (`--grup=`, `deploy/dagitim.json`): ortak paket test grubuna kuru kipte (ağsız, uzağa yazma SIFIR) ·
//      emekli `--musteri` / bilinmeyen grup / kanallı paket / hazırlık kid'i / PROVA / künye commit'i ≠ HEAD → DUR ·
//      ⭐ YENİ ADRESE GERÇEK YÜKLEME KAPALI (3.9 D5 + D8): uzağa yazma SIFIR, ssh/scp SIFIR; kapı açılabilir (sonda) ·
//      --dogrula kapıdan etkilenmez, belirteçli ve yeni adresten okur · oncu terfisi: etiket yok → DUR; terfi kaçışıyla
//      profil matrisi raporu yok → DUR, yeşil rapor → geçer · saf terfi (K-6: genel kendi etiketini ister, oncu etiketi
//      sayılmaz; kaynak grup geride → DUR; kök grup etiket istemez) · `dogrula --ortak` bildirim aracı kuralları
//   §1m/§3ci (G22) CI KAÇIŞI: imzalı künyede `ciKokeni.kip = "atlandi"` → yayın DURMAZ, uyarı basılır, defterde
//      `ci-atlandi:` kolonu (cümle · saat · makine · HEAD); kaçışsız pakette kolon YOK
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
  ciAtlaMetni,
  ciKokeniOku,
  defterSatiri,
  isaretciSurumu,
  ozetCikar,
  pgYayinPlani,
  surumKiyasla,
  yayinPlani,
} from './lib/backend-yayin.mjs';
import { kaynakSurumleri, terfiHukmu } from './lib/terfi.mjs';
import { YENI_ADRES_KAPISI, grupTerfiKapisi, grupYayinBlogu, yeniAdresKapisiSatirlari } from './lib/grup-yayin.mjs';
import { PROFIL_DIZINI_REL, profilOzetleri, raporYolu } from './lib/profil-raporu.mjs';
import { YAYIN_EZME_ORTAMLARI } from './lib/yayin-hedefi.mjs';

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
  // Kip: scp yerel dosyanın kipini taşır; yayın komutu okuma iznini AÇIKÇA vermezse 0600 bir paket nginx'te 403 olur
  // (thinkpad-1 D8b: 2.14.7 indirilemedi, INDIRME_REDDEDILDI). Sonda: chmod düşerse kırmızı.
  const kipIhlali = (k) => [
    !/^chmod -R u=rwX,go=rX '[^']+' && test ! -e '[^']+' && mv /.test(k.yayinla) && 'yayinla: dizin taşınmadan önce go=rX yok',
    !/^chmod 0644 '[^']+' && mv /.test(k.sonJsonYaz ?? "chmod 0644 'x' && mv ") && 'sonJsonYaz: taşımadan önce 0644 yok',
  ].filter(Boolean);
  const pgP = pgYayinPlani({ vdsBackend: temel.vdsBackend, surum: '16.15', derleme: 4, paketAd: 'postgresql-16.15-4-tekserp.zip', damga: 'abc123' });
  const kipSonda = kipIhlali({ ...p.komut, yayinla: p.komut.yayinla.replace(/^chmod -R u=rwX,go=rX '[^']+' && /, '') });
  ol('§1l ⭐ yayın komutu dosya kipini AÇIKÇA verir (backend + PG dizini go=rX, son.json 0644) — yerel 0600 paket de okunur çıkar',
    kipIhlali(p.komut).length === 0 && kipIhlali(pgP.komut).length === 0, [...kipIhlali(p.komut), ...kipIhlali(pgP.komut)].join(' | '));
  ol('§1l sonda: chmod düşerse → kırmızı', kipSonda.length > 0);
  const satir = defterSatiri({ zaman: 'z', surum: '2.11.0', kim: 'a@b', sha16: 's', boyut: 1, terfiAtla: "kullanıcı\tdedi\n'x'" });
  ol('§1j defter satırı sekme/satır sızdırmaz, altı kolon', satir.split('\t').length === 6 && !/[\r\n]/.test(satir));
  const KACIS = { kip: 'atlandi', cumle: 'CI kırık, kullanıcı\tonayladı: imzala', saat: '2026-10-01T20:00:00+03:00', makine: 'mac', head: 'a'.repeat(40) };
  const jws = (yuk) => `e30.${Buffer.from(JSON.stringify(yuk)).toString('base64url')}.imza`;
  ol('§1m ciKokeniOku: imzalı yükten kayıt; yoksa/biçimsizse null', ciKokeniOku(jws({ v: 1, ciKokeni: KACIS }))?.kip === 'atlandi' &&
    ciKokeniOku(jws({ v: 1, ciKokeni: { kip: 'kosu', kosu: 1 } }))?.kip === 'kosu' && ciKokeniOku(jws({ v: 1 })) === null &&
    ciKokeniOku(jws({ v: 1, ciKokeni: { kip: 'baska' } })) === null && ciKokeniOku('bozuk') === null && ciKokeniOku(undefined) === null);
  const iki = defterSatiri({ zaman: 'z', surum: '2.11.0', kim: 'a@b', sha16: 's', boyut: 1, terfiAtla: 'kullanıcı dedi ki yayınla', ciAtla: ciAtlaMetni(KACIS) });
  const yalnizCi = defterSatiri({ zaman: 'z', surum: '2.11.0', kim: 'a@b', sha16: 's', boyut: 1, ciAtla: ciAtlaMetni(KACIS) });
  ol('§1m2 defter: CI kaçışı etiketli kolon (cümle · saat · makine · HEAD12), terfi kolonundan SONRA; sekme sızmaz; kaçış değilse metin yok',
    iki.split('\t').length === 7 && iki.split('\t')[5].startsWith('terfi-atlandi: ') && /^ci-atlandi: "CI kırık, kullanıcı onayladı: imzala" · 2026-10-01T20:00:00\+03:00 · mac · HEAD a{12}$/.test(iki.split('\t')[6]) &&
    yalnizCi.split('\t').length === 6 && yalnizCi.split('\t')[5].startsWith('ci-atlandi: ') && ciAtlaMetni({ kip: 'kosu' }) === null && ciAtlaMetni(null) === null, iki);
  ol("§1k defter komutu tek tırnağı kaçırır (içerik biçim dizesine girmez)", defterKomutu('/opt/v/defter/k.tsv', "a'b").includes("'a'\\''b'") && defterKomutu('/opt/v/defter/k.tsv', 'x').includes("printf '%s\\n'"));
}

/* ------------------------------------------------------------------ *
 * §2 terfi — backend kaynağı
 * ------------------------------------------------------------------ */

function bolum2() {
  console.log('\n§2 — terfi backend kaynağı: kaynak grubun (test) son.json sürümü');
  const kaynak = grupYayinBlogu('test');
  const isaretci = (s) => JSON.stringify({ v: 1, bildirim: `h.${Buffer.from(JSON.stringify({ v: 1, surum: s })).toString('base64url')}.i` });
  const okuyan = (govde) => (url) => (url === kaynak.yayin.backendManifest ? { durum: 'var', govde } : { durum: 'olculemedi', neden: `beklenmeyen ${url}` });
  const k = kaynakSurumleri(kaynak, 'backend', okuyan(isaretci('2.12.1')));
  ol('§2a kaynak = test grubunun backendManifest\'i, sürüm okunur', k.length === 1 && k[0].durum === 'var' && k[0].surum === '2.12.1', JSON.stringify(k));
  const git = { bas: 'a'.repeat(40), surumEtiketi: 'a'.repeat(40), terfiEtiketi: { tur: 'tag', commit: 'a'.repeat(40), mesaj: 'test grubunda yeşil, öncü gruba çıkışı onaylıyorum 2026-10-06' } };
  const h = (surum, kaynaklar) => terfiHukmu({ kod: 'oncu', urun: 'backend', surum, kaynak: 'test', git, kaynaklar, atla: undefined });
  ol('§2b kaynak grupta aynı sürüm yayındaysa terfi UYUMLU', h('2.12.1', k).sonuc === 'uyumlu');
  ol('§2c kaynak grupta yalnız PROVA varsa terfi İHLAL (yalnız kaynakta yayınlanmış sürüm terfi eder)', h('2.12.1', kaynakSurumleri(kaynak, 'backend', okuyan(isaretci('2.12.1-prova.5')))).sonuc === 'ihlal');
  ol('§2d kaynak grupta son.json yoksa İHLAL (yayın yok)', h('2.12.1', kaynakSurumleri(kaynak, 'backend', () => ({ durum: 'yok' }))).sonuc === 'ihlal');
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
const YENI_VDS = '/opt/stack/apps/tekserp-indir';

function sahteAraclarKur() {
  fs.mkdirSync(BIN, { recursive: true });
  fs.mkdirSync(path.join(HOME, '.tekserp'), { recursive: true });
  fs.mkdirSync(UZAK, { recursive: true });
  // ssh: son argüman uzak komut; VDS kökü sahte uzağa çevrilir. sha256sum/stat GNU biçimi (VDS Linux).
  fs.writeFileSync(path.join(BIN, 'ssh'), `#!/bin/sh
for a in "$@"; do komut="$a"; done
printf 'ssh\\t%s\\n' "$komut" >> '${LOG}'
komut=$(printf '%s' "$komut" | sed -e 's#${VDS_KOK}#${UZAK}#g' -e 's#${YENI_VDS}/html#${UZAK}/indir-html#g' -e 's#${YENI_VDS}/defter#${UZAK}/indir-defter#g')
sha256sum() { shasum -a 256 "$@"; }
stat() { if [ "$1" = "-c" ]; then shift 2; wc -c < "$1" | tr -d ' '; else command stat "$@"; fi; }
eval "$komut"
`, { mode: 0o755 });
  // scp: yerel → uzak; SAHTE_SCP_BOZ=1 iken paket kısaltılır (uzakta ölçüm DUR demeli).
  fs.writeFileSync(path.join(BIN, 'scp'), `#!/bin/sh
for a in "$@"; do onceki="$son"; son="$a"; done
hedef=$(printf '%s' "$son" | sed -e 's#^[^:]*:##' -e 's#${VDS_KOK}#${UZAK}#g' -e 's#${YENI_VDS}/html#${UZAK}/indir-html#g' -e 's#${YENI_VDS}/defter#${UZAK}/indir-defter#g')
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
  const yeni = u.hostname === 'indir.etkiliyazilim.com';
  if (u.hostname !== 'guncelleme.etkiliyazilim.com' && !yeni) return new Response('ag yasak', { status: 599 });
  const yol = ${JSON.stringify(UZAK)} + (yeni ? '/indir-html' : '/html') + u.pathname;
  if (!baslik) return new Response('belirtec yok', { status: 403 });
  return fs.existsSync(yol) ? new Response(fs.readFileSync(yol), { status: 200 }) : new Response('yok', { status: 404 });
};
`);
  fs.writeFileSync(path.join(HOME, '.tekserp', 'yayin-belirteci'), `sahte-yayin-belirteci-${'x'.repeat(24)}\n`, { mode: 0o600 });
}

function tsx(args, secenek = {}) {
  return execFileSync(process.execPath, ['--import', 'tsx', ...args], { cwd: TEKS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...secenek });
}

/** Test PAKET anahtarı (üretim dışı fikstür kid'i, parolasız; CLI yalnız üretim anahtarı üretir) + çapa dosyası. */
function anahtarKur() {
  const dizin = path.join(GECICI, 'anahtar');
  const betik = path.join(GECICI, 'test-anahtari.ts');
  fs.writeFileSync(betik, `import { generatePackageKey, writePackageKey } from ${JSON.stringify(path.join(TEKS, 'scripts/lib/butunluk-imza.ts'))};
writePackageKey(${JSON.stringify(dizin)}, generatePackageKey('paket-bekci', ['TEST']));
`);
  tsx([betik]);
  const dosya = path.join(dizin, 'paket-bekci.paket.json');
  const k = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  const capa = path.join(GECICI, 'capa.json');
  fs.writeFileSync(capa, JSON.stringify([{ kid: k.kid, x: k.x }]));
  return { dosya, capa };
}

/**
 * Parolalı ÜRETİM biçimli test anahtarı (`paket-2099-1`) + çapası: grup yayını bildirimi paketi imzalayan anahtarla
 * atar ve gruba hazırlık kid'li paket çıkmaz — geçici ağaçtaki gerçek yayın bu anahtarla ölçülür. Parola stdin'den.
 */
function uretimAnahtariKur() {
  const dizin = path.join(GECICI, 'anahtar-uretim');
  const parola = `bekci-parolasi-${process.pid}`;
  const betik = path.join(GECICI, 'uretim-anahtari.ts');
  fs.writeFileSync(betik, `import fs from 'node:fs';
import { generateWrappedPackageKey, writePackageKey } from ${JSON.stringify(path.join(TEKS, 'scripts/lib/butunluk-imza.ts'))};
generateWrappedPackageKey('paket-2099-1', Buffer.from(${JSON.stringify(parola)})).then((k) => {
  writePackageKey(${JSON.stringify(dizin)}, k);
  fs.writeFileSync(${JSON.stringify(path.join(GECICI, 'capa-uretim.json'))}, JSON.stringify([{ kid: k.kid, x: k.x }]));
}).catch((e) => { console.error(e); process.exit(1); });
`);
  tsx([betik]);
  return { dosya: path.join(dizin, 'paket-2099-1.paket.json'), parola, capa: path.join(GECICI, 'capa-uretim.json') };
}

/** İmzalı test paketi: künye + birkaç kapsam dosyası, gerçek imza aracıyla; zip kökünde PAKET.json. */
function paketKoku(ad, { surum, kanal, prova, commit = '91c79ebd' }) {
  const kok = path.join(GECICI, `paket-${ad}`);
  fs.mkdirSync(path.join(kok, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(kok, 'prisma/migrations/20260101000000_ilk'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'dist/server.js'), `console.log(${JSON.stringify(surum)});\n`);
  fs.writeFileSync(path.join(kok, 'package.json'), `${JSON.stringify({ name: 'teks-erp', version: surum })}\n`);
  fs.writeFileSync(path.join(kok, 'prisma/migrations/20260101000000_ilk/migration.sql'), 'SELECT 1;\n');
  fs.writeFileSync(path.join(kok, 'PAKET.json'), `${JSON.stringify({
    ad, commit, backendKanal: kanal, korumali: true, korumaHedef: 'win-x64', runtimeNodeSurumu: '24.18.0',
    uygulamaSurumu: surum, prova, migrationSayisi: 1, dosyaSayisi: 4,
  }, null, 2)}\n`);
  return kok;
}

function paketKur(ad, { surum, kanal, prova = false, anahtar, kurcala = false, ciKokeni = null }) {
  const kok = paketKoku(ad, { surum, kanal, prova });
  if (ciKokeni) {
    // CI kaçışı yalnız üretim anahtarıyla atılır (CLI hazırlıkta RED); yayıncının okuması için kayıt doğrudan imzalı yüke.
    const betik = path.join(GECICI, `imza-${ad}.ts`);
    fs.writeFileSync(betik, `import { readPackageKey, signPackageDirectory } from ${JSON.stringify(path.join(TEKS, 'scripts/lib/butunluk-imza.ts'))};
signPackageDirectory({ root: ${JSON.stringify(kok)}, key: readPackageKey(${JSON.stringify(anahtar)}), urun: 'backend', surum: ${JSON.stringify(surum)},
  derlemeTarihi: '2026-09-30T10:00:00.000Z', musteri: ${JSON.stringify(kanal)}, ciKokeni: ${JSON.stringify(ciKokeni)} })
  .catch((e) => { console.error(e); process.exit(1); });
`);
    tsx([betik]);
  } else {
    tsx(['scripts/build-korumali-imza.ts', 'imzala', `--kok=${kok}`, `--anahtar=${anahtar}`, `--surum=${surum}`, '--urun=backend',
      `--musteri=${kanal}`, '--derleme-tarihi=2026-09-30T10:00:00.000Z']);
  }
  if (kurcala) fs.appendFileSync(path.join(kok, 'dist/server.js'), '// sonradan eklendi\n');
  const zip = path.join(GECICI, `${ad}.zip`);
  execFileSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: kok });
  return zip;
}

/**
 * Ortak paket (O11a): imza BELLEKTEKİ atılık anahtarla (üretim biçimli kid parolasız dosyaya yazılamaz), çapası
 * yalnız o anahtar. `uretim` verilirse parolalı üretim anahtar dosyasıyla imzalar (gerçek yayın bildirimi paketi
 * imzalayan anahtarla atılır). `kurcala` imzadan sonra kapsam dosyasını değiştirir.
 */
function ortakPaketKur(ad, { surum, kanal = null, musteri = null, prova = false, kid = 'paket-2099-1', kurcala = false, commit, ciKokeni = null, uretim = null }) {
  const kok = paketKoku(ad, { surum, kanal, prova, commit });
  const capa = uretim ? uretim.capa : path.join(GECICI, `capa-${ad}.json`);
  const betik = path.join(GECICI, `imza-${ad}.ts`);
  const imzaci = path.join(TEKS, 'scripts/lib/butunluk-imza.ts');
  const anahtarKodu = uretim
    ? `import { openPackageKey, signPackageDirectory } from ${JSON.stringify(imzaci)};
const anahtar = openPackageKey(${JSON.stringify(uretim.dosya)}, async () => Buffer.from(${JSON.stringify(uretim.parola)}));`
    : `import fs from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { generatePackageKey, signPackageDirectory } from ${JSON.stringify(imzaci)};
const k = generatePackageKey(${JSON.stringify(kid)}, []);
const anahtar = Promise.resolve({ kid: k.kid, x: k.x, privateKey: createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x, d: k.d }, format: 'jwk' }) });
fs.writeFileSync(${JSON.stringify(capa)}, JSON.stringify([{ kid: k.kid, x: k.x }]));`;
  fs.writeFileSync(betik, `${anahtarKodu}
anahtar.then((key) => signPackageDirectory({ root: ${JSON.stringify(kok)}, key, urun: 'backend', surum: ${JSON.stringify(surum)},
  derlemeTarihi: '2026-09-30T10:00:00.000Z', musteri: ${JSON.stringify(musteri)}${ciKokeni ? `, ciKokeni: ${JSON.stringify(ciKokeni)}` : ''} }))
  .catch((e) => { console.error(e); process.exit(1); });
`);
  tsx([betik]);
  if (kurcala) fs.appendFileSync(path.join(kok, 'dist/server.js'), '// sonradan eklendi\n');
  const zip = path.join(GECICI, `${ad}.zip`);
  execFileSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: kok });
  return { zip, capa };
}

function yayinla(argumanlar, ortam = {}, kok = KOK, girdi = '') {
  fs.writeFileSync(LOG, '');
  const r = spawnSync(process.execPath, ['--import', path.join(GECICI, 'sahte-fetch.mjs'), path.join(kok, 'deploy/backend-yayinla.mjs'), ...argumanlar], {
    cwd: kok,
    encoding: 'utf8',
    input: girdi,
    env: {
      // Hedef ezmeleri yükleyiciyi durdurur (G22): koşturanın kabuğunda kalmış biri senaryoları düşürmesin.
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !YAYIN_EZME_ORTAMLARI.includes(k))),
      PATH: `${BIN}${path.delimiter}${process.env.PATH}`,
      HOME,
      TEKSERP_YAYIN_BILDIRIMI: '0',
      TEKSERP_YAYIN_BELIRTECI: path.join(HOME, '.tekserp', 'yayin-belirteci'),
      TEKSERP_YAYIN_BELIRTEC_KAYNAGI: path.join(HOME, '.tekserp', 'yok.json'),
      TEKSERP_TEST_PAKET_CAPASI: ORTAK.capa,
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

/* ------------------------------------------------------------------ *
 * Geçici yayın ağacı — gerçek yüklemenin uçtan uca ölçüldüğü yer
 * ------------------------------------------------------------------ *
 * Gerçek ağaçta yeni adrese yükleme KAPALI (3.9 D5 + D8) ve gerçek yayın test çapasını reddeder; ikisi de ürün
 * davranışıdır ve §3G gerçek ağaçta ölçer. Yükleme sırası/monotonluk/PG dizini ise ancak yükleme koşunca ölçülür:
 * betik ve kitaplıklar geçici bir git ağacına kopyalanır, YALNIZ aşağıdaki iki satır yamalanır (her yama TAM BİR
 * kez tutmalı — tutmazsa bekçi durur, sessizce kapalı kapıya karşı "yeşil" vermez). `Teks-Erp/` bağdır (araç). */
const AGAC = path.join(GECICI, 'agac');
const GRUP = 'test';
const YAMALAR = [
  ['scripts/lib/grup-yayin.mjs', 'export const YENI_ADRES_KAPISI = Object.freeze({\n  acik: false,', 'export const YENI_ADRES_KAPISI = Object.freeze({\n  acik: true,'],
  ['deploy/backend-yayinla.mjs', '  if (process.env.TEKSERP_TEST_PAKET_CAPASI) dur(', '  if (false) dur('],
];
/** Notu yazılan (prova olmayan) test sürümleri; §3o notsuz sürümü bilerek dışarıda bırakır. */
const NOTLU = ['9.9.0', '9.9.1', '9.9.2', '9.9.3', '9.9.4', '9.9.5', '9.9.6', '9.9.7', '9.9.8', '9.9.10'];
let AGAC_HEAD = null;
function agacKur() {
  fs.cpSync(path.join(KOK, 'scripts'), path.join(AGAC, 'scripts'), { recursive: true });
  fs.cpSync(path.join(KOK, 'deploy/pg'), path.join(AGAC, 'deploy/pg'), { recursive: true });
  for (const rel of ['deploy/backend-yayinla.mjs', 'deploy/dagitim.json', 'deploy/kanallar.json']) fs.copyFileSync(path.join(KOK, rel), path.join(AGAC, rel));
  fs.symlinkSync(TEKS, path.join(AGAC, 'Teks-Erp'));
  fs.mkdirSync(path.join(AGAC, 'docs/surumler'), { recursive: true });
  for (const v of NOTLU) fs.writeFileSync(path.join(AGAC, `docs/surumler/backend-${v}.md`), `# backend ${v}\n\n## Özet\n\nBekçi sürümü ${v}.\n`);
  for (const [rel, eski, yeni] of YAMALAR) {
    const yol = path.join(AGAC, rel);
    const metin = fs.readFileSync(yol, 'utf8');
    const adet = metin.split(eski).length - 1;
    if (adet !== 1) throw new Error(`geçici ağaç yaması TUTMADI (${rel}: ${adet} eşleşme) — bekçi kapalı kapıya karşı ölçemez`);
    fs.writeFileSync(yol, metin.replace(eski, yeni));
  }
  const g = (...a) => execFileSync('git', ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a], { cwd: AGAC, encoding: 'utf8' }).trim();
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'bekci agaci');
  AGAC_HEAD = g('rev-parse', 'HEAD');
}
const URETIM = {};
const yayinlaAgac = (argumanlar, ortam = {}) => yayinla(argumanlar, ortam, AGAC, `${URETIM.parola}\n`);
/** Grubun uzak (sahte) dosyaları — VDS yolu dağıtım kaydından, sahte ssh/scp'nin eşlemesiyle. */
const GY = grupYayinBlogu(GRUP).yayin;
const uzakYol = (vds) => vds.replace(`${YENI_VDS}/html`, path.join(UZAK, 'indir-html')).replace(`${YENI_VDS}/defter`, path.join(UZAK, 'indir-defter'));
const uzakDosya = (rel) => path.join(uzakYol(GY.vdsBackend), rel);
const DEFTER = () => uzakYol(GY.backendDefter);
const KENAR_YOLU = new URL(GY.backendManifest).pathname;
/** Ortak test paketi (geçici ağacın HEAD'ine bağlı künye) + yayın argümanları. */
const op = (ad, surum, ek = {}) => ortakPaketKur(ad, { surum, commit: AGAC_HEAD.slice(0, 8), uretim: URETIM, ...ek });
const arg3 = (pk, ek = []) => [`--grup=${GRUP}`, `--paket=${pk.zip}`, `--anahtar=${URETIM.dosya}`, '--pg-cizgi=16', '--pg-en-az=16.9', ...ek];
const capaOrtami = (pk, ek = {}) => ({ TEKSERP_TEST_PAKET_CAPASI: pk.capa, ...ek });

function bolum3() {
  console.log('\n§3 — uçtan uca (sahte ssh/scp, sahte kenar, gerçek imza aracı, geçici ağaç, test grubu)');
  sahteAraclarKur();
  Object.assign(ORTAK, anahtarKur());
  Object.assign(URETIM, uretimAnahtariKur());
  agacKur();
  const p1 = op('p1', '9.9.1');

  const kuru = yayinlaAgac(arg3(p1, ['--kuru']), capaOrtami(p1));
  ol('§3a kuru kip: çıkış 0, uzağa YAZMA SIFIR, kenar okuması YOK', kuru.kod === 0 && kuru.yazma.length === 0 && !kuru.log.some(([t]) => t === 'fetch'), kuru.cikti.slice(-600));
  // G22/DAGY-4: ssh hedefi kayıttan — `--ssh` ya da SSH_HEDEF/UZAK_DIZIN ezmesi ağdan ÖNCE durur (kuru kipte de).
  for (const [ad, ek, ortam] of [['--ssh', ['--ssh=baska-sunucu'], {}], ['SSH_HEDEF', [], { SSH_HEDEF: 'baska-sunucu' }], ['UZAK_DIZIN', [], { UZAK_DIZIN: '/tmp/baska' }]]) {
    const r = yayinlaAgac(arg3(p1, ['--kuru', ...ek]), capaOrtami(p1, ortam));
    ol(`§3a2 ⭐ ${ad} ezmesi → DUR, ssh/scp SIFIR`, r.kod !== 0 && /YAYIN HEDEFİ EZİLEMEZ/.test(r.cikti) && r.log.length === 0, r.cikti.slice(-400));
  }

  fs.chmodSync(p1.zip, 0o600);
  const ilk = yayinlaAgac(arg3(p1), capaOrtami(p1));
  const sonJson = uzakDosya('son.json');
  const okunur = (f) => fs.existsSync(f) && (fs.statSync(f).mode & 0o044) === 0o044;
  ol('§3c2 ⭐ yerel 0600 paket yayında herkese OKUNUR (paket · surum.json · son.json · sürüm dizini) — nginx 403 vermez',
    ['9.9.1/p1.zip', '9.9.1/surum.json', 'son.json', '9.9.1'].every((f) => okunur(uzakDosya(f))) && (fs.statSync(uzakDosya('9.9.1')).mode & 0o011) === 0o011);
  const surumJson = uzakDosya('9.9.1/surum.json');
  ol('§3b ilk yayın: çıkış 0', ilk.kod === 0, ilk.cikti.slice(-900));
  ol('§3c sürüm dizininde paket + surum.json; son.json = surum.json (bayt bayt)', fs.existsSync(uzakDosya('9.9.1/p1.zip')) &&
    fs.existsSync(sonJson) && fs.readFileSync(sonJson, 'utf8') === fs.readFileSync(surumJson, 'utf8'));
  const sira = ilk.log.map(([t, c]) => `${t}:${c}`);
  const dizinMv = sira.findIndex((x) => /mv .*\.yukleniyor-9\.9\.1-/.test(x));
  const sonMv = sira.findIndex((x) => /mv .*\.son\.json\..*son\.json/.test(x));
  const sonScp = sira.findIndex((x) => /^scp:.*\.son\.json\./.test(x));
  ol('§3d SIRA: paket → ölçüm → dizin yeniden adı → son.json EN SON', dizinMv > 0 && sonScp > dizinMv && sonMv > sonScp &&
    sonMv === Math.max(...sira.map((x, i) => (/^(scp|ssh):/.test(x) && !/printf/.test(x) ? i : -1))), sira.join('\n'));
  const kalan = fs.existsSync(uzakDosya('')) ? fs.readdirSync(uzakDosya('')).filter((f) => f.startsWith('.')) : ['(dizin yok)'];
  ol('§3e geçici dizin/dosya kalmadı', kalan.length === 0, kalan.join(','));
  ol('§3f yayın defteri html/ DIŞINDA, bir satır, backend-<sürüm>', fs.existsSync(DEFTER()) && !DEFTER().includes(`${path.sep}indir-html${path.sep}`) &&
    /\tbackend-9\.9\.1\t/.test(fs.readFileSync(DEFTER(), 'utf8')), DEFTER());
  const kenar = ilk.log.filter(([t]) => t === 'fetch');
  ol(`§3g kenar okuması BELİRTEÇLİ ve yalnız ${KENAR_YOLU}`, kenar.length >= 1 && kenar.every(([, y, b]) => y === KENAR_YOLU && b === 'belirtecli'), JSON.stringify(kenar));
  const isaretci = ilk.kod === 0 ? JSON.parse(fs.readFileSync(sonJson, 'utf8')) : { bildirim: 'e30.e30.x' };
  const bildirim = JSON.parse(Buffer.from(isaretci.bildirim.split('.')[1], 'base64url').toString('utf8'));
  ol('§3h bildirim: kanal = grup · sürüm · paket özeti · imzalayan = paketin anahtarı · PG alt sınırı', bildirim.kanal === GRUP && bildirim.surum === '9.9.1' &&
    bildirim.paketImzaKid === 'paket-2099-1' && bildirim.pg?.cizgi === 16 && bildirim.pg?.enAz === '16.9' && bildirim.pg?.hedef === null &&
    bildirim.paket?.boyut === fs.statSync(p1.zip).size, JSON.stringify(bildirim).slice(0, 400));

  const tekrar = yayinlaAgac(arg3(p1), capaOrtami(p1));
  ol('§3i aynı sürüm ikinci kez → DUR (monotonluk), uzağa yazma SIFIR', tekrar.kod !== 0 && tekrar.yazma.length === 0 && /YENİ değil/.test(tekrar.cikti), tekrar.cikti.slice(-400));
  const eski = op('p0', '9.9.0');
  const r0 = yayinlaAgac(arg3(eski), capaOrtami(eski));
  ol('§3j eski sürüm → DUR (geri inme yok), yazma SIFIR', r0.kod !== 0 && r0.yazma.length === 0);
  const p2 = op('p2', '9.9.2');
  const r2 = yayinlaAgac(arg3(p2), capaOrtami(p2));
  ol('§3k yeni sürüm monotonluğu geçer, son.json ilerler', r2.kod === 0 && isaretciSurumu(fs.readFileSync(sonJson, 'utf8')) === '9.9.2', r2.cikti.slice(-500));

  const kanalli = op('py', '9.9.3', { kanal: 'demofabrika' });
  const ry = yayinlaAgac(arg3(kanalli), capaOrtami(kanalli));
  ol('§3l kanallı paket (backendKanal dolu) → DUR, uzak/kenar SIFIR', ry.kod !== 0 && ry.log.length === 0 && /gruba yalnız ORTAK paket çıkar/.test(ry.cikti), ry.cikti.slice(-300));
  const prova = op('pu', '9.9.3-prova.4', { prova: true });
  const ru = yayinlaAgac(arg3(prova), capaOrtami(prova));
  ol('§3m PROVA paketi gruba GERÇEK yayında da → DUR, uzak SIFIR', ru.kod !== 0 && ru.log.length === 0 && /PROVA/.test(ru.cikti), ru.cikti.slice(-300));
  const kurcali = op('pk', '9.9.3', { kurcala: true });
  const rk = yayinlaAgac(arg3(kurcali), capaOrtami(kurcali));
  ol('§3n imzadan sonra kurcalanmış paket → DUR (bütünlük), uzak SIFIR', rk.kod !== 0 && rk.log.length === 0 && /bütünlüğü GECERSIZ/.test(rk.cikti), rk.cikti.slice(-400));
  const notsuz = op('pn', '9.9.9');
  const rn = yayinlaAgac(arg3(notsuz), capaOrtami(notsuz));
  ol('§3o prova olmayan sürümün notu yok → DUR (sürüm notu kapısı), uzak SIFIR', rn.kod !== 0 && rn.log.length === 0 && /SÜRÜM NOTU YOK/.test(rn.cikti), rn.cikti.slice(-300));
  const p6 = op('p6', '9.9.6');
  fs.renameSync(path.join(HOME, '.tekserp', 'yayin-belirteci'), path.join(HOME, '.tekserp', 'yayin-belirteci.kenara'));
  const rb = yayinlaAgac(arg3(p6), capaOrtami(p6));
  fs.renameSync(path.join(HOME, '.tekserp', 'yayin-belirteci.kenara'), path.join(HOME, '.tekserp', 'yayin-belirteci'));
  ol('§3p yayın belirteci yok → DUR, uzağa yazma SIFIR', rb.kod !== 0 && rb.yazma.length === 0 && /BELİRTECİ YOK/.test(rb.cikti), rb.cikti.slice(-300));
  const once = fs.existsSync(sonJson) ? fs.readFileSync(sonJson, 'utf8') : null;
  const rz = yayinlaAgac(arg3(p6), capaOrtami(p6, { SAHTE_SCP_BOZ: '1' }));
  ol('§3q uzakta bozulan paket → DUR, son.json DEĞİŞMEDİ, geçici silindi, sürüm dizini yok', rz.kod !== 0 && once !== null && fs.readFileSync(sonJson, 'utf8') === once &&
    !fs.existsSync(uzakDosya('9.9.6')) && fs.readdirSync(uzakDosya('')).filter((f) => f.startsWith('.')).length === 0, rz.cikti.slice(-400));
  const rpg = yayinlaAgac(arg3(p6).map((a) => (a.startsWith('--pg-en-az=') ? '--pg-en-az=16.8' : a)), capaOrtami(p6));
  ol('§3r --pg-en-az kayıttan (deploy/pg/pg-surumu.json) FARKLI → DUR, uzak SIFIR', rpg.kod !== 0 && rpg.log.length === 0 && /kayıttaki değerden/.test(rpg.cikti), rpg.cikti.slice(-300));
  const rkayit = yayinlaAgac([...arg3(p6).filter((a) => !a.startsWith('--pg-')), '--kuru'], capaOrtami(p6));
  const kayitYolu = /imzasız bildirim: (\S+sonuc\.json)/.exec(rkayit.cikti)?.[1];
  const kb = kayitYolu && fs.existsSync(kayitYolu) ? JSON.parse(fs.readFileSync(kayitYolu, 'utf8')).bildirim : null;
  ol("§3r' --pg-* verilmeden → bildirimin pg bloğu KAYITTAN (cizgi · backendEnAz), uzağa yazma SIFIR", rkayit.kod === 0 && rkayit.yazma.length === 0 &&
    kb?.pg?.cizgi === Number(PG_KAYDI.cizgi) && kb?.pg?.enAz === PG_KAYDI.backendEnAz, rkayit.cikti.slice(-400));
  bolum3pg();
  bolum3capa(paketKur('pc', { surum: '9.9.9-prova.1', kanal: 'testfabrika', prova: true, anahtar: ORTAK.dosya }));
  bolum3ci();
  bolum3ortak();
  bolum3grup();
}

/** O11a — kurulum arşivinin doğrulayıcısı `ortak-dogrula`: başarılı yol test imzasıyla, her ret ayrı ölçülür. */
function bolum3ortak() {
  console.log('\n§3O — ortak paket doğrulaması (O11a, ortak-dogrula)');
  const dogrula = (zip, ek, ortam = {}) => {
    const cikti = path.join(GECICI, `ortak-${Math.random().toString(36).slice(2)}`);
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', 'ortak-dogrula', `--zip=${zip}`, '--pg-cizgi=16', '--pg-en-az=16.9',
      `--cikti=${cikti}`, ...ek], { cwd: TEKS, encoding: 'utf8', env: { ...process.env, TEKSERP_TEST_PAKET_CAPASI: '', ...ortam } });
    const sonuc = path.join(cikti, 'sonuc.json');
    return { kod: r.status, err: r.stderr ?? '', sonuc: fs.existsSync(sonuc) ? JSON.parse(fs.readFileSync(sonuc, 'utf8')) : null };
  };
  const ok = ortakPaketKur('o1', { surum: '9.9.10' });
  const r1 = dogrula(ok.zip, ['--guven-capasi=uretim', `--capa=${ok.capa}`]);
  ol('§3O1 ⭐ ortak paket (backendKanal null · künye müşterisiz · üretim biçimli kid) test çapasıyla GEÇER, sonuç sürüm + kid taşır',
    r1.kod === 0 && r1.sonuc?.kip === 'ortak-dogrula' && r1.sonuc?.surum === '9.9.10' && r1.sonuc?.paketImzaKid === 'paket-2099-1' && r1.sonuc?.pg?.cizgi === 16, r1.err.slice(-300));
  const r1g = dogrula(ok.zip, ['--guven-capasi=uretim']);
  ol("§3O1' aynı paket GERÇEK üretim çapasıyla → DUR (kid tanınmaz) — §3O1'in kabulü test çapasından", r1g.kod !== 0 && /bütünlüğü GECERSIZ \(JWS_KID\)/.test(r1g.err) && r1g.sonuc === null, r1g.err.slice(-200));
  const r2 = dogrula(ok.zip, ['--guven-capasi=hazirlik', `--capa=${ok.capa}`]);
  ol('§3O2 --guven-capasi=hazirlik → DUR (test çapası verilse de)', r2.kod !== 0 && /yalnız ÜRETİM çapasıyla/.test(r2.err) && r2.sonuc === null, r2.err.slice(-200));
  const r2b = dogrula(ok.zip, [`--capa=${ok.capa}`]);
  ol('§3O2b kip verilmeden → DUR', r2b.kod !== 0 && /--guven-capasi/.test(r2b.err), r2b.err.slice(-200));
  const kanalli = ortakPaketKur('o3', { surum: '9.9.11', kanal: 'testfabrika' });
  const r3 = dogrula(kanalli.zip, ['--guven-capasi=uretim', `--capa=${kanalli.capa}`]);
  ol('§3O3 kanallı paket (backendKanal testfabrika) → DUR', r3.kod !== 0 && /yalnız ortak paket girer/.test(r3.err) && r3.sonuc === null, r3.err.slice(-200));
  const hazirlik = ortakPaketKur('o4', { surum: '9.9.12', kid: 'paket-hazirlik-ortak' });
  const r4 = dogrula(hazirlik.zip, ['--guven-capasi=uretim', `--capa=${hazirlik.capa}`]);
  ol('§3O4 emekli hazırlık kid\'iyle imzalı (bütünlük GEÇERLİ) → DUR (ortak paket yalnız üretim anahtar ailesi)', r4.kod !== 0 && /yalnız üretim anahtar ailesiyle/.test(r4.err) && r4.sonuc === null, r4.err.slice(-200));
  const prova = ortakPaketKur('o5', { surum: '9.9.13-prova.1', prova: true });
  const r5 = dogrula(prova.zip, ['--guven-capasi=uretim', `--capa=${prova.capa}`]);
  ol('§3O5 PROVA paketi → DUR', r5.kod !== 0 && /PROVA paketi ortak arşive girmez/.test(r5.err) && r5.sonuc === null, r5.err.slice(-200));
  const musterili = ortakPaketKur('o6', { surum: '9.9.14', musteri: 'testfabrika' });
  const r6 = dogrula(musterili.zip, ['--guven-capasi=uretim', `--capa=${musterili.capa}`]);
  ol('§3O6 künyesi müşteri taşıyan paket → DUR', r6.kod !== 0 && /ortak paket müşteri taşımaz/.test(r6.err) && r6.sonuc === null, r6.err.slice(-200));
  const kurcali = ortakPaketKur('o7', { surum: '9.9.15', kurcala: true });
  const r7 = dogrula(kurcali.zip, ['--guven-capasi=uretim', `--capa=${kurcali.capa}`]);
  ol('§3O7 imzadan sonra kurcalanan paket → DUR', r7.kod !== 0 && /imzasız\/kurcalı paket/.test(r7.err) && r7.sonuc === null, r7.err.slice(-200));
}

/**
 * O11b — grup yayını. Ortak paket test imzasıyla (ORTAK-biçimli kid) kurulur; sürüm notu zorunlu olduğundan
 * yayınlanmış bir sürümün (docs/surumler) numarası kullanılır. Gerçek yükleme kapalıdır: her `--kuru`suz koşum DUR.
 */
function bolum3grup() {
  console.log('\n§3G — grup yayını (O11b, --grup + deploy/dagitim.json)');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: KOK, encoding: 'utf8' }).trim();
  const SURUM = '2.14.0';
  const g1 = ortakPaketKur('g1', { surum: SURUM, commit: head.slice(0, 8) });
  const ortamCapa = (k) => ({ TEKSERP_TEST_PAKET_CAPASI: k.capa });
  const grup = (k, g, ek = []) => [`--grup=${g}`, `--paket=${k.zip}`, `--anahtar=${ORTAK.dosya}`, ...ek];
  const hicYazmadi = (r) => r.yazma.length === 0 && !r.log.some(([t]) => t === 'ssh' || t === 'scp');

  const k1 = yayinla(grup(g1, 'test', ['--kuru']), ortamCapa(g1));
  ol('§3G1 ⭐ ortak paket test grubuna KURU: çıkış 0, uzağa yazma SIFIR, kenar okuması YOK, hedef "test", kök grup etiket istemez',
    k1.kod === 0 && k1.yazma.length === 0 && !k1.log.some(([t]) => t === 'fetch') && /BACKEND 2\.14\.0 → test \(uretim\) — KURU/.test(k1.cikti) &&
    /✓ künye commit'i == HEAD/.test(k1.cikti), k1.cikti.slice(-900));
  ol('§3G1b kuru çıktıda yazılacak adresler YENİ kökte (tekserp-indir/html/test/backend)', /tekserp-indir\/html\/test\/backend/.test(k1.cikti));

  for (const [ad, argumanlar] of [['--grup ile birlikte', ['--grup=test', '--musteri=testfabrika', `--paket=${g1.zip}`, '--kuru']], ['tek başına', ['--musteri=adnansahin', `--paket=${g1.zip}`, '--kuru']]]) {
    const r = yayinla(argumanlar, ortamCapa(g1));
    ol(`§3G2 emekli --musteri (${ad}) → EMEKLİ ESKİ KANAL ARGÜMANI, ağa çıkılmaz`, r.kod !== 0 && /EMEKLİ ESKİ KANAL ARGÜMANI/.test(r.cikti) && r.log.length === 0, r.cikti.slice(-300));
  }
  const grupsuz = yayinla([`--paket=${g1.zip}`, '--kuru'], ortamCapa(g1));
  ol('§3G2b --grup verilmeden → DUR (hedef örtük değil), ağa çıkılmaz', grupsuz.kod !== 0 && /HANGİ GRUBA/.test(grupsuz.cikti) && grupsuz.log.length === 0, grupsuz.cikti.slice(-300));
  const bilinmeyen = yayinla(grup(g1, 'hazirlik', ['--kuru']), ortamCapa(g1));
  ol('§3G3 bilinmeyen grup → DUR, ağa çıkılmaz', bilinmeyen.kod !== 0 && /kayıtlı bir güncelleme grubu değil/.test(bilinmeyen.cikti) && bilinmeyen.log.length === 0, bilinmeyen.cikti.slice(-300));
  const eskiAd = yayinla(grup(g1, 'testfabrika', ['--kuru']), ortamCapa(g1));
  ol('§3G3b eski kanal adı grup olarak REDDEDİLİR (ortak kitaplık eski kanal kodunu tanır), ağa çıkılmaz', eskiAd.kod !== 0 && /ESKİ KANAL kodu/.test(eskiAd.cikti) && eskiAd.log.length === 0, eskiAd.cikti.slice(-300));

  const kanalli = ortakPaketKur('g4', { surum: SURUM, kanal: 'testfabrika', commit: head.slice(0, 8) });
  const r4 = yayinla(grup(kanalli, 'test', ['--kuru']), ortamCapa(kanalli));
  ol('§3G4 kanallı paket (backendKanal dolu) gruba çıkmaz → DUR', r4.kod !== 0 && /gruba yalnız ORTAK paket çıkar/.test(r4.cikti) && hicYazmadi(r4), r4.cikti.slice(-300));
  const hazirlik = ortakPaketKur('g5', { surum: SURUM, kid: 'paket-hazirlik-ortak', commit: head.slice(0, 8) });
  const r5 = yayinla(grup(hazirlik, 'test', ['--kuru']), ortamCapa(hazirlik));
  ol('§3G5 emekli hazırlık kid\'iyle imzalı ortak paket → DUR (bildirim aracı, yalnız üretim anahtar ailesi)', r5.kod !== 0 && /yalnız üretim anahtar ailesiyle/.test(r5.cikti) && hicYazmadi(r5), r5.cikti.slice(-300));
  const prova = ortakPaketKur('g6', { surum: '2.14.0-prova.1', prova: true, commit: head.slice(0, 8) });
  const r6 = yayinla(grup(prova, 'test', ['--kuru']), ortamCapa(prova));
  ol('§3G6 PROVA paketi gruba çıkmaz → DUR', r6.kod !== 0 && /PROVA paketi/.test(r6.cikti) && hicYazmadi(r6), r6.cikti.slice(-300));
  const eskiCommit = ortakPaketKur('g7', { surum: SURUM, commit: head[0] === '0' ? 'ffffffff' : '00000000' });
  const r7 = yayinla(grup(eskiCommit, 'test', ['--kuru']), ortamCapa(eskiCommit));
  ol('§3G7 künye commit\'i HEAD\'e bağlanmıyorsa → DUR (derleme künyesi kapısı)', r7.kod !== 0 && /KÜNYESİ HEAD'E BAĞLANMIYOR/.test(r7.cikti) && hicYazmadi(r7), r7.cikti.slice(-300));

  // ⭐ Yeni adres kapısı: gerçek yükleme D5 + D8 olmadan hiçbir grupta ve hiçbir koşulda yazmaz.
  for (const g of ['test', 'oncu', 'genel']) {
    const gercek = yayinla(grup(g1, g), { TEKSERP_TEST_PAKET_CAPASI: '' });
    ol(`§3G8 ⭐ ${g}: GERÇEK yayın (kuru değil) → DUR "YENİ ADRESE GERÇEK YAYIN KAPALI", ssh/scp/fetch SIFIR`,
      gercek.kod !== 0 && /YENİ ADRESE GERÇEK YAYIN KAPALI/.test(gercek.cikti) && /D5/.test(gercek.cikti) && /D8/.test(gercek.cikti) && gercek.log.length === 0, gercek.cikti.slice(-500));
  }
  const terfiliGercek = yayinla(grup(g1, 'oncu', ['--terfi-atla=test grubunda yeşil öncü grubuna çıkışı onaylıyorum 2026-10-06']), ortamCapa(g1));
  ol('§3G8b terfi kaçışı kapıyı AÇMAZ (gerçek oncu yayını yine DUR, yazma SIFIR)', terfiliGercek.kod !== 0 && /GERÇEK YAYIN KAPALI/.test(terfiliGercek.cikti) && terfiliGercek.log.length === 0);
  ol('§3G8c sonda: kapı açık verilirse satır üretmez (kapı gerçekten açılabilir; sabit yalnız bilinçli bir kararla değişir)',
    yeniAdresKapisiSatirlari({ acik: true, sart: [] }).length === 0 && yeniAdresKapisiSatirlari().length > 0 && YENI_ADRES_KAPISI.acik === false);

  // --dogrula: kapıdan etkilenmez; belirteçli okur ve YENİ adresten (indir.etkiliyazilim.com/<grup>/backend/son.json).
  const dogrula = yayinla(['--grup=test', '--dogrula'], ortamCapa(g1));
  const okuma = dogrula.log.filter(([t]) => t === 'fetch');
  ol('§3G9 --dogrula kapıya takılmaz: yeni adresten BELİRTEÇLİ okur, §3\'ün geçici ağaçtan yayınladığı sürümü (9.9.10) görür, yazma SIFIR',
    !/GERÇEK YAYIN KAPALI/.test(dogrula.cikti) && okuma.length >= 1 && okuma.every(([, y, b]) => y === '/test/backend/son.json' && b === 'belirtecli') && dogrula.yazma.length === 0 &&
    dogrula.kod === 0 && /yayındaki backend sürümü: 9\.9\.10/.test(dogrula.cikti),
    dogrula.cikti.slice(-300) + JSON.stringify(okuma));

  // Terfi (yayıncı uçtan uca): oncu için etiket yok → DUR; kaçışla profil matrisi raporu yok → DUR; yeşil rapor → geçer.
  const r10 = yayinla(grup(g1, 'oncu', ['--kuru']), ortamCapa(g1));
  ol('§3G10 oncu KURU, terfi etiketi yok → DUR (terfi/oncu/backend-v2.14.0), yazma SIFIR', r10.kod !== 0 && /terfi\/oncu\/backend-v2\.14\.0/.test(r10.cikti) && hicYazmadi(r10), r10.cikti.slice(-500));
  const cumle = 'test grubunda yeşil öncü grubuna çıkışı onaylıyorum 2026-10-06';
  const r11 = yayinla(grup(g1, 'oncu', ['--kuru', `--terfi-atla=${cumle}`]), ortamCapa(g1));
  ol('§3G11 ⭐ oncu + terfi kaçışı, profil matrisi raporu YOK → DUR (profil kapısı ölçülemedi)', r11.kod !== 0 && /PROFİL MATRİSİ KAPISI DURDURDU \(oncu\)/.test(r11.cikti) && hicYazmadi(r11), r11.cikti.slice(-500));
  const raporDizini = path.join(HOME, '.tekserp', 'derleme-kayitlari');
  fs.mkdirSync(raporDizini, { recursive: true });
  const ozetler = profilOzetleri(path.join(KOK, PROFIL_DIZINI_REL));
  const rapor = { commit: head, agacTemiz: true, sonuc: 'YESIL', profiller: Object.entries(ozetler).map(([ad, profilOzeti]) => ({ ad, sonuc: 'YESIL', profilOzeti })) };
  fs.writeFileSync(raporYolu(head, raporDizini), JSON.stringify(rapor));
  const r12 = yayinla(grup(g1, 'oncu', ['--kuru', `--terfi-atla=${cumle}`]), ortamCapa(g1));
  ol('§3G12 oncu + terfi kaçışı + YEŞİL profil raporu: kuru geçer (çıkış 0, yazma SIFIR)', r12.kod === 0 && hicYazmadi(r12) && /TERFİ KAPISI ATLANDI/.test(r12.cikti) && /profil matrisi kapısı: GECTI/i.test(r12.cikti), r12.cikti.slice(-700));
  const bozuk = { ...rapor, profiller: rapor.profiller.slice(1) };
  fs.writeFileSync(raporYolu(head, raporDizini), JSON.stringify(bozuk));
  const r13 = yayinla(grup(g1, 'genel', ['--kuru', `--terfi-atla=${cumle}`]), ortamCapa(g1));
  ol('§3G13 eksik profilli rapor → DUR (genel de aynı kapıdan)', r13.kod !== 0 && /PROFİL MATRİSİ KAPISI DURDURDU \(genel\)/.test(r13.cikti) && hicYazmadi(r13), r13.cikti.slice(-400));
  const test12 = yayinla(grup(g1, 'test', ['--kuru', `--terfi-atla=${cumle}`]), ortamCapa(g1));
  ol('§3G14 kök grupta terfi kaçışı verilemez (terfi istemeyen grup) → DUR', test12.kod !== 0 && /terfi istemiyor/.test(test12.cikti) && hicYazmadi(test12), test12.cikti.slice(-300));

  // Saf terfi: K-6 + kaynak grup ölçümü.
  const sha = 'a'.repeat(40);
  const isaretci = (s) => JSON.stringify({ v: 1, bildirim: `h.${Buffer.from(JSON.stringify({ v: 1, surum: s })).toString('base64url')}.i` });
  const okuyan = (surum) => (url) => (url === 'https://indir.etkiliyazilim.com/test/backend/son.json' || url === 'https://indir.etkiliyazilim.com/oncu/backend/son.json'
    ? { durum: 'var', govde: isaretci(surum) } : { durum: 'olculemedi', neden: `beklenmeyen ${url}` });
  const etiket = (mesaj = 'oncu grubunda yeşil, genel gruba çıkışı onaylıyorum 2026-10-06') => ({ tur: 'tag', commit: sha, mesaj });
  const t = (grupAdi, git, surum = '2.14.0', ek = {}) => grupTerfiKapisi({ grup: grupAdi, urun: 'backend', surum, git, oku: okuyan('2.14.0'), ...ek });
  const acikKapi = t('oncu', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, '2.14.0', { adresKapisi: { acik: true, sart: [] } });
  ol('§3G8d ⭐ yeni adres kapısı AÇIKKEN backend artefakt özeti tanımsız → terfi ÖLÇÜLEMEDİ (kapalıyken beyanlı ④ satırı)',
    acikKapi.sonuc === 'olculemedi' && /ARTEFAKT\.backend/.test(acikKapi.satirlar.join(' ')) && t('oncu', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }).satirlar.some((x) => /④ backend: .*ÖLÇÜLMEDİ/.test(x)), acikKapi.satirlar.join('|'));
  ol('§3G15 kök grup (test) terfi/etiket İSTEMEZ', t('test', null).sonuc === 'uyumlu' && t('test', null).gerekmez === true);
  ol('§3G16 oncu: HEAD == etiket + terfi/oncu etiketi + kaynak(test) ≥ X → UYUMLU', t('oncu', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }).sonuc === 'uyumlu');
  const g17 = t('genel', { bas: sha, surumEtiketi: sha, terfiEtiketi: null });
  ol('§3G17 ⭐ K-6: genel kendi etiketini ister (terfi/genel/backend-v2.14.0 yok → İHLAL; oncu etiketi sayılmaz)', g17.sonuc === 'ihlal' && g17.satirlar.some((x) => /terfi\/genel\/backend-v2\.14\.0/.test(x)), g17.satirlar.join('|'));
  const oncuOnay = { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket('test grubunda yeşil, öncü gruba çıkışı onaylıyorum 2026-10-05') };
  ol('§3G18 genel: kendi etiketi + oncu onayı (ayrı cümle) + kaynak(oncu) yayında ≥ X → UYUMLU', t('genel', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, '2.14.0', { kaynakGit: oncuOnay }).sonuc === 'uyumlu');
  const g18b = t('genel', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, '2.14.0', { kaynakGit: { bas: sha, surumEtiketi: sha, terfiEtiketi: null } });
  ol('§3G18b ⭐ K-6 (ortak kitaplık): oncu onay etiketi HEAD\'de yok → İHLAL', g18b.sonuc === 'ihlal' && g18b.satirlar.some((x) => /K-6: oncu onay etiketi \(terfi\/oncu\/backend-v2\.14\.0\) YOK/.test(x)), g18b.satirlar.join('|'));
  const g18c = t('genel', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, '2.14.0', { kaynakGit: { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() } });
  ol('§3G18c K-6: iki onayın cümlesi AYNI → İHLAL', g18c.sonuc === 'ihlal' && g18c.satirlar.some((x) => /AYNI/.test(x)), g18c.satirlar.join('|'));
  const g18d = t('genel', { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() });
  ol('§3G18d enjekte git + kaynak git olgusu yok → ÖLÇÜLEMEDİ (gerçek depoya düşmez)', g18d.sonuc === 'olculemedi', g18d.satirlar.join('|'));
  const g19 = grupTerfiKapisi({ grup: 'genel', urun: 'backend', surum: '2.14.0', git: { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, kaynakGit: oncuOnay, oku: okuyan('2.13.0') });
  ol('§3G19 kaynak grup GERİDE (oncu 2.13.0 < 2.14.0) → İHLAL', g19.sonuc === 'ihlal' && g19.satirlar.some((x) => /GERİDE/.test(x)), g19.satirlar.join('|'));
  const g20 = grupTerfiKapisi({ grup: 'genel', urun: 'backend', surum: '2.14.0', git: { bas: sha, surumEtiketi: sha, terfiEtiketi: etiket() }, kaynakGit: oncuOnay, oku: () => ({ durum: 'olculemedi', neden: 'ağ' }) });
  ol('§3G20 kaynak grup ÖLÇÜLEMEDİ → ÖLÇÜLEMEDİ (fail-closed)', g20.sonuc === 'olculemedi');
  ol('§3G21 HEAD ≠ sürüm etiketi → İHLAL', t('oncu', { bas: 'b'.repeat(40), surumEtiketi: sha, terfiEtiketi: etiket() }).sonuc === 'ihlal');
  ol('§3G22 bilinmeyen grup → İHLAL (fail-closed)', grupTerfiKapisi({ grup: 'x', urun: 'backend', surum: '2.14.0' }).sonuc === 'ihlal');

  // Bildirim aracı: `dogrula --ortak` — kanal = grup, ortak paket kuralları tek gövdeden.
  const arac = (zip, ek, ortam = {}) => {
    const cikti = path.join(GECICI, `ortak-g-${Math.random().toString(36).slice(2)}`);
    const ozet = path.join(GECICI, 'ozet-g.txt');
    fs.writeFileSync(ozet, 'grup yayını sondası');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', 'dogrula', '--ortak', `--zip=${zip}`, '--kanal=test', '--guven-capasi=uretim',
      '--pg-cizgi=16', '--pg-en-az=16.9', `--ozet-dosyasi=${ozet}`, `--cikti=${cikti}`, ...ek], { cwd: TEKS, encoding: 'utf8', env: { ...process.env, TEKSERP_TEST_PAKET_CAPASI: '', ...ortam } });
    const sonuc = path.join(cikti, 'sonuc.json');
    return { kod: r.status, err: r.stderr ?? '', sonuc: fs.existsSync(sonuc) ? JSON.parse(fs.readFileSync(sonuc, 'utf8')) : null };
  };
  const a1 = arac(g1.zip, [`--capa=${g1.capa}`]);
  ol('§3G23 dogrula --ortak: bildirim kanalı = grup ("test"), künye müşterisiz, PG bloğu', a1.kod === 0 && a1.sonuc?.bildirim?.kanal === 'test' && a1.sonuc?.bildirim?.surum === SURUM && a1.sonuc?.bildirim?.pg?.cizgi === 16, a1.err.slice(-300));
  const a2 = arac(g1.zip, [`--capa=${g1.capa}`, '--kanal-turu=hazirlik']);
  ol('§3G24 --ortak + --kanal-turu=hazirlik → DUR (grup üretim sınıfıdır)', a2.kod !== 0 && /yalnız üretim sınıfıyla/.test(a2.err) && a2.sonuc === null, a2.err.slice(-200));
  const a3 = arac(kanalli.zip, [`--capa=${kanalli.capa}`]);
  ol('§3G25 --ortak kanallı pakette → DUR (ortak-dogrula ile aynı gövde)', a3.kod !== 0 && /yalnız ortak paket girer/.test(a3.err) && a3.sonuc === null, a3.err.slice(-200));
  const a4 = arac(g1.zip, [`--capa=${g1.capa}`, '--guven-capasi=hazirlik']);
  ol('§3G26 --ortak hazırlık kipiyle → DUR', a4.kod !== 0 && a4.sonuc === null, a4.err.slice(-200));
  const a5 = arac(g1.zip, []);
  ol('§3G27 ortak paket GERÇEK üretim çapasıyla DUR (test kid tanınmaz) — kabul çapadan', a5.kod !== 0 && /bütünlüğü GECERSIZ \(JWS_KID\)/.test(a5.err) && a5.sonuc === null, a5.err.slice(-200));
}

/** G22 — CI kaçışlı imza: yayın DURMAZ, uyarır, defterine `ci-atlandi:` yazar; kaçışsız yayında kolon yok. */
function bolum3ci() {
  const onceki = fs.readFileSync(DEFTER(), 'utf8');
  ol('§3ci0 kaçışsız yayınların defter satırlarında ci-atlandi kolonu YOK', onceki.trim().length > 0 && !onceki.includes('ci-atlandi:'));
  const kayit = { kip: 'atlandi', cumle: 'CI koşusu kırık, kullanıcı onayladı: imzala', saat: '2026-10-01T20:00:00+03:00', makine: 'bekci-mac', head: 'b'.repeat(40) };
  const p10 = op('p10', '9.9.10', { ciKokeni: kayit });
  const r = yayinlaAgac(arg3(p10), capaOrtami(p10));
  const yeni = fs.readFileSync(DEFTER(), 'utf8').slice(onceki.length);
  ol('§3ci ⭐ CI kaçışlı paket: yayın DURMAZ (çıkış 0, son.json ilerler), uyarı basılır, defter satırı cümle · saat · makine · HEAD taşır',
    r.kod === 0 && isaretciSurumu(fs.readFileSync(uzakDosya('son.json'), 'utf8')) === '9.9.10' &&
    /⚠ CI KAÇIŞI[^\n]*"CI koşusu kırık, kullanıcı onayladı: imzala" · 2026-10-01T20:00:00\+03:00 · bekci-mac · HEAD b{12}/.test(r.cikti) &&
    /⚠ CI KAÇIŞLI imza/.test(r.cikti) && /\tbackend-9\.9\.10\t.*\tci-atlandi: "CI koşusu kırık/.test(yeni), `${r.cikti.slice(-500)}\n--- defter:\n${yeni}`);
}

/** G3 — bildirim aracının PAKET çapası kanalın çapa KİPİNDEN (kanal kaydı backend.guvenCapasi, yayıncı geçirir). */
function bolum3capa(zip) {
  console.log('\n§3G — kanalın güven çapası kipi (G3)');
  const ozet = path.join(GECICI, 'capa-ozet.txt');
  fs.writeFileSync(ozet, 'G3 çapa sondası');
  const dogrula = (ek, ortam = {}) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', 'dogrula', `--zip=${zip}`, '--kanal=testfabrika',
    '--pg-cizgi=16', '--pg-en-az=16.9', `--ozet-dosyasi=${ozet}`, `--cikti=${path.join(GECICI, `capa-${Math.random().toString(36).slice(2)}`)}`, ...ek],
  { cwd: TEKS, encoding: 'utf8', env: { ...process.env, ...ortam } });
  const kipsiz = dogrula(['--kanal-turu=hazirlik'], { TEKSERP_TEST_PAKET_CAPASI: ORTAK.capa });
  ol('§3G1 kip verilmeden → DUR (örtük çapa yok)', kipsiz.status !== 0 && /--guven-capasi/.test(kipsiz.stderr), kipsiz.stderr.slice(-200));
  const taninmayan = dogrula(['--kanal-turu=hazirlik', '--guven-capasi=test'], { TEKSERP_TEST_PAKET_CAPASI: ORTAK.capa });
  ol('§3G2 tanınmayan kip → DUR', taninmayan.status !== 0 && /tek çapa kipi; gelen: test/.test(taninmayan.stderr), taninmayan.stderr.slice(-200));
  const emekli = dogrula(['--kanal-turu=uretim', '--guven-capasi=hazirlik']);
  ol('§3G3 emekli hazırlık kipi → DUR (tek kip: uretim)', emekli.status !== 0 && /tek çapa kipi; gelen: hazirlik/.test(emekli.stderr), emekli.stderr.slice(-200));
  const dogrulaZip = (z, ek) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', 'dogrula', `--zip=${z}`, '--kanal=testfabrika',
    '--pg-cizgi=16', '--pg-en-az=16.9', `--ozet-dosyasi=${ozet}`, `--cikti=${path.join(GECICI, `capa-${Math.random().toString(36).slice(2)}`)}`, ...ek], { cwd: TEKS, encoding: 'utf8' });
  const yabanci = dogrulaZip(zip, ['--kanal-turu=hazirlik', '--guven-capasi=uretim']);
  ol('§3G4 ⭐ GERÇEK üretim PAKET çapası yabancı kid\'li (test anahtarı) paketi REDDEDER — kid TANINMAZ (JWS_KID)',
    yabanci.status !== 0 && /bütünlüğü GECERSIZ \(JWS_KID\)/.test(yabanci.stderr), yabanci.stderr.slice(-200));
  // Gerçek üretim kid'iyle atılık (parolalı) anahtar: çapa kid'i TANIR, yalnız imza düşer — aracın üretim listesini kullandığı ölçülür.
  const dizin = path.join(GECICI, 'anahtar-gercek-kid');
  const kok = paketKoku('pg3', { surum: '9.9.9-prova.9', kanal: 'testfabrika', prova: true });
  const betik = path.join(GECICI, 'gercek-kid-imza.ts');
  fs.writeFileSync(betik, `import { generateWrappedPackageKey, openPackageKey, signPackageDirectory, writePackageKey } from ${JSON.stringify(path.join(TEKS, 'scripts/lib/butunluk-imza.ts'))};
import { PRODUCTION_PACKAGE_PUBLIC_KEYS } from ${JSON.stringify(path.join(TEKS, 'src/lib/license/integrity.ts'))};
(async () => {
const kid = PRODUCTION_PACKAGE_PUBLIC_KEYS[0].kid;
const parola = () => Buffer.from('bekci-atilik-parola');
const dosya = writePackageKey(${JSON.stringify(dizin)}, await generateWrappedPackageKey(kid, parola()));
const key = await openPackageKey(dosya, async () => parola());
await signPackageDirectory({ root: ${JSON.stringify(kok)}, key, urun: 'backend', surum: '9.9.9-prova.9', derlemeTarihi: '2026-09-30T10:00:00.000Z',
  musteri: 'testfabrika', ciKokeni: { kip: 'kosu', kosu: 1, dal: 'main', commit: '91c79ebd' } });
console.log(kid);
})().catch((e) => { console.error(e); process.exit(1); });
`);
  const gercekKidAdi = tsx([betik]).trim();
  const gercekKid = path.join(GECICI, 'pg3.zip');
  execFileSync('zip', ['-q', '-r', '-X', gercekKid, '.'], { cwd: kok });
  const imzaDuser = dogrulaZip(gercekKid, ['--kanal-turu=hazirlik', '--guven-capasi=uretim']);
  ol(`§3G4' üretim çapası gerçek kid'i (${gercekKidAdi}) TANIR, yalnız imza düşer (JWS_IMZA) — araç üretim listesini kullanıyor`,
    imzaDuser.status !== 0 && /bütünlüğü GECERSIZ \(JWS_IMZA\)/.test(imzaDuser.stderr), imzaDuser.stderr.slice(-200));
  const kontrol = dogrula(['--kanal-turu=hazirlik', '--guven-capasi=uretim'], { TEKSERP_TEST_PAKET_CAPASI: ORTAK.capa });
  ol('§3G5 kontrol: aynı paket test çapasıyla GEÇER — §3G4\'ün reddi çapadan', kontrol.status === 0, kontrol.stderr.slice(-200));
}

/** PG paketi (sözleşme sürümü 2): ayrı değişmez dizin, ayrı künye; backend bildirimi hedefi künyeden alır. */
function bolum3pg() {
  console.log('\n§3pg — PostgreSQL paketi (sözleşme sürümü 2)');
  const pgKok = path.join(GECICI, 'pg-sahne');
  fs.mkdirSync(path.join(pgKok, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pgKok, 'bin/postgres.exe'), 'sahte');
  fs.writeFileSync(path.join(pgKok, 'bin/icuuc67.dll'), 'sahte');
  fs.writeFileSync(path.join(pgKok, 'TEKSERP-ICERIK.sha256'), 'aa  bin/postgres.exe\nbb  bin/icuuc67.dll\n');
  const pgZip = path.join(GECICI, 'postgresql-16.15-4-win-x64.zip');
  execFileSync('zip', ['-q', '-r', '-X', pgZip, '.'], { cwd: pgKok });
  const pgCikti = path.join(GECICI, 'pg-kunye');
  tsx(['scripts/backend-bildirim.ts', 'pg-imzala', `--zip=${pgZip}`, '--cizgi=16', '--surum=16.15', '--derleme=4', '--icu=67', `--anahtar=${URETIM.dosya}`, `--cikti=${pgCikti}`], { input: `${URETIM.parola}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const sonJson = uzakDosya('son.json');
  const once = fs.readFileSync(sonJson, 'utf8');
  const p7 = op('p7', '9.9.7');
  const pgYayinla = (ek) => yayinlaAgac([`--grup=${GRUP}`, '--pg-yayinla', ...ek], capaOrtami(p7));
  const r0 = yayinlaAgac(arg3(p7, [`--pg-kunye=${pgJson}`]), capaOrtami(p7));
  ol('§3t hedeflenen PG grupta YOKKEN backend yayını → DUR, yazma SIFIR', r0.kod !== 0 && r0.yazma.length === 0 && /bu kanalda YOK/.test(r0.cikti), r0.cikti.slice(-400));
  const bozukZip = path.join(GECICI, 'bozuk', 'postgresql-16.15-4-win-x64.zip');
  fs.mkdirSync(path.dirname(bozukZip), { recursive: true });
  fs.writeFileSync(bozukZip, Buffer.concat([fs.readFileSync(pgZip), Buffer.from('x')]));
  const rb = pgYayinla([`--pg-paket=${bozukZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3u künyeyle tutmayan PG zip → DUR, uzak SIFIR', rb.kod !== 0 && rb.log.length === 0 && /TUTMUYOR/.test(rb.cikti), rb.cikti.slice(-300));
  const ry = pgYayinla([`--pg-paket=${pgZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3v --pg-yayinla: değişmez dizinde paket + pg.json, son.json DEĞİŞMEDİ, geçici yok', ry.kod === 0 &&
    fs.existsSync(uzakDosya('pg/16.15-4/postgresql-16.15-4-win-x64.zip')) && fs.existsSync(uzakDosya('pg/16.15-4/pg.json')) &&
    fs.readFileSync(sonJson, 'utf8') === once && fs.readdirSync(uzakDosya('pg')).filter((f) => f.startsWith('.')).length === 0, ry.cikti.slice(-500));
  const defter = fs.readFileSync(DEFTER(), 'utf8');
  ol('§3w PG yayını defterde (pg-16.15-4)', /\tpg-16\.15-4\t/.test(defter));
  const ry2 = pgYayinla([`--pg-paket=${pgZip}`, `--pg-kunye=${pgJson}`]);
  ol('§3x aynı PG ikinci kez → DUR (değişmez), yazma SIFIR', ry2.kod !== 0 && ry2.yazma.length === 0 && /ZATEN VAR/.test(ry2.cikti));
  const r1 = yayinlaAgac(arg3(p7, [`--pg-kunye=${pgJson}`]), capaOrtami(p7));
  const b = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(sonJson, 'utf8')).bildirim.split('.')[1], 'base64url').toString('utf8'));
  const icerik = execFileSync('shasum', ['-a', '256', path.join(pgKok, 'TEKSERP-ICERIK.sha256')], { encoding: 'utf8' }).split(' ')[0];
  const zipOzet = execFileSync('shasum', ['-a', '256', pgZip], { encoding: 'utf8' }).split(' ')[0];
  ol('§3y backend bildirimi PG hedefini KÜNYEDEN alır (sürüm · derleme · zip özeti · içerik özeti ölçülmüş · ICU)', r1.kod === 0 && b.pg.hedef?.surum === '16.15' &&
    b.pg.hedef?.derleme === 4 && b.pg.hedef?.paket?.sha256 === zipOzet && b.pg.hedef?.icerikSha256 === icerik && b.pg.hedef?.icuSurum === '67', r1.cikti.slice(-400));
  const sahteKunye = path.join(GECICI, 'pg-baska-surum.json');
  const yuk = { v: 1, urun: 'postgresql', platform: 'win32-x64', cizgi: 16, surum: '16.14', derleme: 4, paket: { ad: 'postgresql-16.14-4-win-x64.zip', boyut: 1, sha256: 'a'.repeat(64) }, icerikSha256: 'b'.repeat(64), icuSurum: '67', yayinZamani: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(sahteKunye, JSON.stringify({ v: 1, bildirim: `e30.${Buffer.from(JSON.stringify(yuk)).toString('base64url')}.imza` }));
  const p8 = op('p8', '9.9.8');
  const rs = yayinlaAgac(arg3(p8, [`--pg-kunye=${sahteKunye}`]), capaOrtami(p8));
  ol('§3z hedef PG künyesi kaydın sürümü değil (16.14 ≠ kayıt) → DUR, uzak SIFIR', rs.kod !== 0 && rs.log.length === 0 && /KAYITLA UYUŞMUYOR/.test(rs.cikti), rs.cikti.slice(-300));
  const rsy = pgYayinla([`--pg-paket=${pgZip}`, `--pg-kunye=${sahteKunye}`]);
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
