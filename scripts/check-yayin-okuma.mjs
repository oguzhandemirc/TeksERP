#!/usr/bin/env node
// =============================================================================
// BEKÇİ — yayın betiklerinde BELİRTEÇSİZ HTTP okuma yok (3c') · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Güncelleme sunucusu kenarda Cloudflare Worker ile korunur; anonim okuma 403 alır ve
// yayın zinciri kırılır. Yayın betiklerinde güncelleme sunucusuna okuma yalnız iki yoldan:
//   ① SSH (VDS diski) — `sshOku`/`yayinOku` (scripts/lib/yayin-okuma.mjs)
//   ② Belirteçli HTTP — JS'te `belirtecliFetch`, kabukta `belirtecli_curl` (`curl -H @başlık`)
// Kapı: taranan her dosyadaki her HTTP çağrı sitesi (curl · wget · fetch( · node:http(s) ·
// Invoke-WebRequest) ya SANKSİYONLU tanımdır ya da BEYANLI izindir (hedefi güncelleme
// sunucusu olmayan okuma, gerekçeli). İzin İKİ YÖNLÜ: eşleşmeyen izin ÖLÜ = kırmızı.
// Üç sonuç: yeşil · kırmızı · ÖLÇÜLEMEDİ (zorunlu dosya yok / tarama tabanın altında).
//
//   node scripts/check-yayin-okuma.mjs           # kapı
//   node scripts/check-yayin-okuma.mjs --sonda   # kalıcı negatif + pozitif sondalar
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Taranan kapsam: yayın/paketleme betiklerinin yaşadığı dizinler (bekçiler kendi sahte araçlarıyla koşar, hariç). */
const KAPSAM = [
  { dizin: 'deploy', derin: false, uzanti: /\.(sh|mjs|cjs|js|ps1)$/ },
  // Kendi PostgreSQL örneğinin indiricisi burada; `deploy` derin taranmadığı için ayrı satır.
  { dizin: 'deploy/pg', derin: true, uzanti: /\.(sh|mjs|cjs|js|ps1)$/ },
  { dizin: 'scripts', derin: false, uzanti: /\.(sh|mjs|cjs|js)$/, haric: /^(test_|check-)/ },
  { dizin: 'scripts/lib', derin: false, uzanti: /\.(mjs|cjs|js)$/ },
  { dizin: 'mobil/scripts', derin: true, uzanti: /\.(sh|mjs|cjs|js)$/, haric: /\.test\./ },
];
/** Tarama bu sayının altında dosya görürse ÖLÇÜLEMEDİ (kapsam kaydı ya da okuma kırık). */
const TARAMA_TABANI = 25;
/** Varlığı zorunlu: sanksiyonlu tanımlar + yayın zincirinin okuyucuları. */
const ZORUNLU = ['scripts/lib/yayin-okuma.mjs', 'deploy/electron-grup-yayinla.sh', 'deploy/mobil-grup-yayinla.mjs',
  'scripts/lib/terfi.mjs'];

/** Sanksiyonlu tanımlar — satır birebir; yalnız bu satırdaki çağrı sayılmaz. */
const SANKSIYON = {
  'deploy/electron-grup-yayinla.sh': /^belirtecli_curl\(\) \{ curl -H "@\$BELIRTEC_BASLIK" "\$@"; \}$/,
  'scripts/lib/yayin-okuma.mjs': /^ {2}return fetch\(url, \{ \.\.\.secenek, headers: basliklar \}\);$/,
};

/** Beyanlı izinler — hedefi güncelleme sunucusu OLMAYAN HTTP (iki yönlü: eşleşmeyen izin ölü). */
const IZINLI = {
  'deploy/kur.ps1': [{ desen: /Invoke-WebRequest "http:\/\/localhost:\$script:saglikPort\/health"/, gerekce: 'kurulan backend\'in yerel /health yoklaması (sunucuda)' }],
  'scripts/koruma-runtime-indir.mjs': [{ desen: /await fetch\(hedef\.url, \{ redirect: 'follow' \}\)/, gerekce: 'Node çalışma zamanı resmî kaynaktan; deploy/node-surumu.json SHA256\'sıyla doğrulanır' }],
  'deploy/pg/pg-ikili-dogrula.mjs': [{ desen: /const yanit = await fetch\(url, \{ redirect: 'follow' \}\);/, gerekce: 'PostgreSQL ikilisi resmî EDB kaynağından; deploy/pg/pg-surumu.json boyut + SHA256\'sıyla doğrulanır' }],
  'mobil/scripts/surucu/api.mjs': [{ desen: /await fetch\(`\$\{this\.taban\}\$\{yol\}`/, gerekce: 'e2e tablet sürücüsü — ERP backend API\'si' }],
  'mobil/scripts/surucu/guzergah.mjs': [{ desen: /await fetch\(`\$\{ortam\.apiUrl\}\/health`\)/, gerekce: 'e2e tablet sürücüsü — ERP backend /health' }],
  'deploy/play-yayinla.mjs': [
    { desen: /y = await fetch\(url, \{ method: yontem, headers: basliklar, body: govde \}\);/, gerekce: 'Google Play Developer API (androidpublisher.googleapis.com) — güncelleme sunucusu değil' },
    { desen: /y = await fetch\(TOKEN_URL, \{ method: 'POST'/, gerekce: 'Google OAuth belirteç ucu (oauth2.googleapis.com) — Play API erişimi için' },
  ],
};

/** Yorum satırı mı (yalnız TAM yorum satırı; satır sonu yorumu kod sayılır — fail-closed). */
function yorumMu(rel, satir) {
  const t = satir.trim();
  if (/\.(sh|ps1)$/.test(rel)) return t.startsWith('#');
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Bir satırdaki HTTP çağrı sitesi deseni (dosya türüne göre). */
function httpSitesi(rel, satir) {
  if (/\.sh$/.test(rel)) return /(^|[\s;|&$(`])(curl|wget)(\s|$)/.test(satir);
  if (/\.ps1$/.test(rel)) return /\b(Invoke-WebRequest|Invoke-RestMethod|WebClient|curl|wget)\b/i.test(satir);
  return /(?<![\w.$])fetch\s*\(/.test(satir) || /\bhttps?\.(get|request)\s*\(/.test(satir) ||
    /['"]node:https?['"]|require\(\s*['"]https?['"]\s*\)/.test(satir) || /['"](curl|wget)['"]/.test(satir);
}

/** Kapsamdaki dosyaları diskten bulur (izlenmeyen yeni dosya da taranır). */
function kapsamiBul(kok = KOK) {
  const cikti = [];
  for (const k of KAPSAM) {
    const gez = (rel) => {
      let girdiler;
      try {
        girdiler = fs.readdirSync(path.join(kok, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const g of girdiler) {
        const alt = `${rel}/${g.name}`;
        if (g.isDirectory()) {
          if (k.derin && g.name !== 'node_modules') gez(alt);
        } else if (k.uzanti.test(g.name) && !(k.haric && k.haric.test(g.name))) cikti.push(alt);
      }
    };
    gez(k.dizin);
  }
  return [...new Set(cikti)].sort();
}

/**
 * @param {Record<string,string|undefined>} d rel → içerik
 * @param {string[]} yollar taranan dosyalar
 * @returns {{kirmizi: string[], olculemedi: string[], sayac: {dosya: number, site: number, izin: number, sanksiyon: number}}}
 */
function olc(d, yollar, izinli = IZINLI) {
  const kirmizi = [];
  const olculemedi = [];
  const sayac = { dosya: 0, site: 0, izin: 0, sanksiyon: 0 };
  for (const z of ZORUNLU) if (typeof d[z] !== 'string') olculemedi.push(`zorunlu dosya okunamadı: ${z}`);
  if (yollar.length < TARAMA_TABANI) olculemedi.push(`tarama ${yollar.length} dosya gördü (< taban ${TARAMA_TABANI}) — kapsam kırık`);
  const kullanilanIzin = new Set();
  for (const rel of yollar) {
    const metin = d[rel];
    if (typeof metin !== 'string') {
      olculemedi.push(`okunamadı: ${rel}`);
      continue;
    }
    sayac.dosya += 1;
    metin.split('\n').forEach((satir, i) => {
      if (yorumMu(rel, satir) || !httpSitesi(rel, satir)) return;
      sayac.site += 1;
      if (SANKSIYON[rel]?.test(satir)) {
        sayac.sanksiyon += 1;
        return;
      }
      const izin = (izinli[rel] ?? []).findIndex((z) => z.desen.test(satir));
      if (izin >= 0) {
        sayac.izin += 1;
        kullanilanIzin.add(`${rel}#${izin}`);
        return;
      }
      kirmizi.push(`${rel}:${i + 1} belirteçsiz HTTP okuma sitesi — güncelleme sunucusuna SSH (yayinOku) ya da belirteçli yol (belirtecliFetch / belirtecli_curl) kullan; hedef güncelleme sunucusu değilse IZINLI'ye gerekçeyle yaz: ${satir.trim().slice(0, 120)}`);
    });
  }
  for (const [rel, girdiler] of Object.entries(izinli)) {
    girdiler.forEach((z, i) => {
      if (!kullanilanIzin.has(`${rel}#${i}`)) kirmizi.push(`ÖLÜ İZİN ${rel} (${z.gerekce}) — eşleşen site yok; izni kaldır`);
    });
  }
  sanksiyonDenetimi(d, kirmizi);
  return { kirmizi, olculemedi, sayac };
}

/** Sanksiyonlu yolların KENDİSİ: belirteç başlığı, fail-closed ve "yüklemeden önce" sırası. */
function sanksiyonDenetimi(d, kirmizi) {
  const say = (metin, desen) => (metin ?? '').split('\n').filter((x) => desen.test(x)).length;
  const yo = d['scripts/lib/yayin-okuma.mjs'];
  if (typeof yo === 'string') {
    if (say(yo, SANKSIYON['scripts/lib/yayin-okuma.mjs']) !== 1) kirmizi.push('yayin-okuma.mjs: belirtecliFetch\'in tek fetch satırı yok ya da değişti');
    const govde = /export async function belirtecliFetch\([^)]*\) \{\n([\s\S]*?)\n\}\n/.exec(yo)?.[1] ?? '';
    if (!govde.includes('...indirmeBasliklari(url)') || !govde.includes('return fetch(')) kirmizi.push('yayin-okuma.mjs: belirtecliFetch belirteç başlığını (indirmeBasliklari) eklemiyor');
    if (!yo.includes("export const INDIRME_BASLIGI = 'X-TKL-Indirme';")) kirmizi.push('yayin-okuma.mjs: başlık adı X-TKL-Indirme değil (3a Worker sözleşmesi)');
    if (!yo.includes('export const indirmeBasliklari = (url) => ({ [INDIRME_BASLIGI]: belirtecOku(url) });')) kirmizi.push('yayin-okuma.mjs: indirmeBasliklari belirteci belirtecOku\'dan (fail-closed) almıyor');
    if (say(yo, /throw new BelirtecYok\(/) < 4) kirmizi.push('yayin-okuma.mjs: belirtecOku fail-closed dalları eksik (yok · dosya değil · izin · biçim)');
  }
  for (const kabuk of ['deploy/electron-grup-yayinla.sh']) {
    const ey = d[kabuk];
    if (typeof ey !== 'string') continue;
    const ad = kabuk.split('/').pop();
    if (say(ey, SANKSIYON[kabuk]) !== 1) kirmizi.push(`${ad}: belirtecli_curl tanımı yok ya da -H "@$BELIRTEC_BASLIK" taşımıyor`);
    const bas = ey.indexOf('baslikDosyasiYaz(');
    const ilkScp = ey.search(/^\s*scp /m);
    // Uzak komutlar `uzak` yardımcısından geçer (`ssh -T "$SSH_HEDEF" bash -s --`): ilk ssh, yardımcının tanımı ya da ilk
    // doğrudan çağrıdır. Hiç bulunamazsa sıra ölçülemez — kapı sessizce geçmesin diye kırmızı.
    const ilkSsh = ey.search(/^\s*ssh\b[^\n]*"\$SSH_HEDEF"/m);
    if (ilkSsh < 0) kirmizi.push(`${ad}: ssh çağrısı ("$SSH_HEDEF") bulunamadı — belirteç sırası ölçülemedi (desen değişti, bekçiyi güncelle)`);
    if (bas < 0) kirmizi.push(`${ad}: belirteç başlık dosyası (baslikDosyasiYaz) üretilmiyor`);
    else if ((ilkScp >= 0 && bas > ilkScp) || (ilkSsh >= 0 && bas > ilkSsh)) kirmizi.push(`${ad}: belirteç denetimi ilk ssh/scp'den SONRA — yüklemeden ÖNCE olmalı`);
  }
  const my = d['deploy/mobil-grup-yayinla.mjs'];
  if (typeof my === 'string') {
    const kapi = my.indexOf('if (!KURU) belirtecGerekli();');
    const yukle = my.indexOf('if (PAKET) await otaYayinla(');
    if (kapi < 0 || yukle < 0 || kapi > yukle) kirmizi.push('mobil-grup-yayinla.mjs: belirteç denetimi (belirtecGerekli) yüklemeden ÖNCE değil');
  }
}

/* ------------------------------------------------------------------ *
 * Kalıcı sondalar — bellekteki kopyalara karşı (mutasyonun UYGULANDIĞI da ölçülür)
 * ------------------------------------------------------------------ */

function sondalar(taban, tabanYollar) {
  const ekle = (d, y, rel, metin) => { d[rel] = metin; if (!y.includes(rel)) y.push(rel); };
  const degis = (d, rel, a, b) => { d[rel] = (d[rel] ?? '').replace(a, b); };
  const S = [
    ['P0 bugünkü ağaç → YEŞİL', 'yesil', () => {}],
    ['N1g electron-grup-yayinla.sh\'a çıplak curl okuması → KIRMIZI', 'kirmizi', (d) => degis(d, 'deploy/electron-grup-yayinla.sh', 'yayindaki=$(belirtecli_curl -fsS', 'yayindaki=$(curl -fsS'), 'electron-grup-yayinla.sh:'],
    ['N2g grup betiğinde belirtecli_curl -H başlığını kaybetti → KIRMIZI', 'kirmizi', (d) => degis(d, 'deploy/electron-grup-yayinla.sh', 'curl -H "@$BELIRTEC_BASLIK" "$@"', 'curl "$@"'), 'belirtecli_curl'],
    ['N3 mobil-grup-yayinla.mjs\'e çıplak fetch → KIRMIZI', 'kirmizi', (d) => degis(d, 'deploy/mobil-grup-yayinla.mjs', "const r = await belirtecliFetch(url, { method: 'GET'", "const r = await fetch(url, { method: 'GET'"), 'mobil-grup-yayinla.mjs:'],
    ['N4 terfi.mjs curl alt süreci → KIRMIZI', 'kirmizi', (d) => degis(d, 'scripts/lib/terfi.mjs', "import { yayinOku } from './yayin-okuma.mjs';", "import { yayinOku } from './yayin-okuma.mjs';\nconst ham = (u) => execFileSync('curl', ['-sS', u]);"), 'terfi.mjs:'],
    ['N5 surum.mjs https.get → KIRMIZI', 'kirmizi', (d) => degis(d, 'scripts/lib/surum.mjs', 'export function manifestGovdesindenSurum(govde) {', 'export function manifestGovdesindenSurum(govde) {\n  https.get(govde);'), 'surum.mjs:'],
    ['N6 belirtecliFetch başlık eklemiyor → KIRMIZI', 'kirmizi', (d) => degis(d, 'scripts/lib/yayin-okuma.mjs', '...indirmeBasliklari(url) }', '}'), 'indirmeBasliklari'],
    ['N7 yeni yayın betiği (deploy/yeni-yayin.sh) curl ile okuyor → KIRMIZI (keşif)', 'kirmizi', (d, y) => ekle(d, y, 'deploy/yeni-yayin.sh', 'v=$(curl -fsS https://guncelleme.etkiliyazilim.com/x/electron/latest.yml)\n'), 'yeni-yayin.sh:1'],
    ['N8 izinli site kalktı → ÖLÜ İZİN KIRMIZI (iki yönlü)', 'kirmizi', (d) => degis(d, 'scripts/koruma-runtime-indir.mjs', "await fetch(hedef.url, { redirect: 'follow' })", 'await indir(hedef.url)'), 'ÖLÜ İZİN'],
    ['N9 mobil belirteç denetimi (yükleme öncesi) söküldü → KIRMIZI', 'kirmizi', (d) => degis(d, 'deploy/mobil-grup-yayinla.mjs', 'if (!KURU) belirtecGerekli();\n', ''), 'belirtecGerekli'],
    ['N10 zorunlu dosya yok (yayin-okuma.mjs) → ÖLÇÜLEMEDİ', 'olculemedi', (d) => { delete d['scripts/lib/yayin-okuma.mjs']; }, 'zorunlu'],
    ['N11 tarama boş (kapsam kırık) → ÖLÇÜLEMEDİ', 'olculemedi', (d, y) => { y.splice(0, y.length); }, 'taban'],
    ['N12 mobil/scripts altına \'curl\' alt süreci → KIRMIZI', 'kirmizi', (d, y) => ekle(d, y, 'mobil/scripts/lib/yeni.mjs', "spawnSync('curl', [u]);\n"), 'yeni.mjs:1'],
    ['N13 belirteç başlığı ilk ssh\'tan (uzak yardımcısı) SONRA üretiliyor → KIRMIZI', 'kirmizi', (d) => {
      degis(d, 'deploy/electron-grup-yayinla.sh', '# --- YAYIN BELİRTECİ', 'ssh -T "$SSH_HEDEF" true\n# --- YAYIN BELİRTECİ');
    }, 'SONRA'],
    ['N14 ssh çağrısı tanınmaz biçime geçti (sıra ölçülemez) → KIRMIZI', 'kirmizi', (d) => {
      d['deploy/electron-grup-yayinla.sh'] = (d['deploy/electron-grup-yayinla.sh'] ?? '').replace(/^(\s*)ssh -T "\$SSH_HEDEF"/m, '$1command ssh -T "$HEDEF_X"');
    }, 'bulunamadı'],
    ['P1 yalnız YORUMDA curl → YEŞİL (yorum çağrı değildir)', 'yesil', (d) => degis(d, 'deploy/electron-grup-yayinla.sh', '# --- YAYIN BELİRTECİ', '# curl -fsS anonim okumaydı\n# --- YAYIN BELİRTECİ')],
    ['P2 N1 ihlali belirteçli yola çevrilince → YEŞİL (düzeltme tabanı düşürür)', 'yesil', (d) => {
      degis(d, 'deploy/electron-grup-yayinla.sh', 'yayindaki=$(belirtecli_curl -fsS', 'yayindaki=$(curl -fsS');
      degis(d, 'deploy/electron-grup-yayinla.sh', 'yayindaki=$(curl -fsS', 'yayindaki=$(belirtecli_curl -fsS');
    }],
  ];
  let gecti = 0;
  const kaldi = [];
  for (const [ad, beklenen, mutasyon, iz] of S) {
    const d = { ...taban };
    const y = [...tabanYollar];
    mutasyon(d, y);
    const degisti = ad.startsWith('P') || Object.keys({ ...taban, ...d }).some((k) => d[k] !== taban[k]) || y.length !== tabanYollar.length;
    const s = olc(d, y);
    const h = hukum(s);
    const ok = degisti && h === beklenen && (!iz || [...s.kirmizi, ...s.olculemedi].some((x) => x.includes(iz)));
    if (ok) gecti += 1;
    else kaldi.push(ad);
    console.log(`${ok ? '✅' : '❌'} ${ad}${degisti ? '' : ' — MUTASYON UYGULANMADI'} · hüküm ${h}`);
    if (!ok) for (const x of [...s.olculemedi, ...s.kirmizi].slice(0, 4)) console.log(`     · ${x}`);
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
  return kaldi.length === 0;
}

const hukum = (s) => (s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil');

function main() {
  const yollar = kapsamiBul();
  const d = {};
  for (const rel of new Set([...yollar, ...ZORUNLU, ...Object.keys(IZINLI)])) {
    try {
      d[rel] = fs.readFileSync(path.join(KOK, rel), 'utf8');
    } catch {
      d[rel] = undefined;
    }
  }
  if (process.argv.includes('--sonda')) {
    console.log('check-yayin-okuma — kalıcı sondalar (bellekteki kopyalara karşı)\n');
    process.exit(sondalar(d, yollar) ? 0 : 1);
  }
  const s = olc(d, yollar);
  console.log('check-yayin-okuma — yayın betiklerinde belirteçsiz HTTP okuma yok (3c\')\n');
  for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ — ${x}`);
  for (const x of s.kirmizi) console.log(`❌ ${x}`);
  const h = hukum(s);
  if (h === 'yesil') {
    console.log(`✅ ${s.sayac.dosya} dosya tarandı · ${s.sayac.site} HTTP sitesi: ${s.sayac.sanksiyon} sanksiyonlu (belirteçli) + ${s.sayac.izin} beyanlı izin (güncelleme sunucusu dışı) · belirteçsiz okuma 0`);
    console.log('\n=== Sonuç: yeşil ===');
    process.exit(0);
  }
  console.log(`\n=== Sonuç: ${h === 'olculemedi' ? 'ÖLÇÜLEMEDİ' : 'KIRMIZI'} (${s.kirmizi.length} kırmızı, ${s.olculemedi.length} ölçülemedi) ===`);
  process.exit(h === 'olculemedi' ? 2 : 1);
}

main();
