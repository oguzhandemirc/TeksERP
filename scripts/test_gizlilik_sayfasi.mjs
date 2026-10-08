#!/usr/bin/env node
// =============================================================================
// BEKÇİ — HERKESE AÇIK GİZLİLİK SAYFASI (tekserp.etkiliyazilim.com/gizlilik, Play K2) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kaynak: deploy/gizlilik-sayfasi/ (VDS /opt/stack/apps/tekserp-gizlilik) + docs/legal/GIZLILIK-POLITIKASI.md.
//   §1 tek kaynak: html/gizlilik.html = uret(GIZLILIK-POLITIKASI.md) bayt-eşit; sayfada betik/dış kaynak yok;
//      her e-posta/mailto <!--email_off--> içinde (Cloudflare karartması çözücü betik ister, CSP onu engeller)
//   §2 compose: proje/konteyner adı, salt-okunur kök + salt-okunur bağlar, Host = ADRES, websecure+tls,
//      yalnız kendi önekli etiketler (indir/eski güncelleme sitesinin adı ve adresi yok)
//   §3 kenar zinciri (deploy/traefik/kenar-zinciri.mjs): CF ipallowlist = satıcı CLOUDFLARE_NETWORKS birebir → hız seddi
//   §4 nginx: `always` yalnız no-store/no-cache başlığında · dizin listesi kapalı · nokta-dosya 404 ilk regex ·
//      göreli yönlendirme · sayfa konumu = ADRES yolu ve dosyası · 404 no-store
//   §5 adres tutarlılığı: ADRES kurulum/ölçüm betiğinde, kaynak notta, Play form belgesinde, sunucu envanterinde aynı
//   §6 kablolama: commit kancası + CI bu bekçiyi koşar
// Köşeli parantezli yer tutucu bekçiyi KIRMIZI yapmaz (taslak meşru); yayını vds-kur.sh durdurur — burada ⏳ basılır.
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ. Cırcır değil.
//   node scripts/test_gizlilik_sayfasi.mjs          # dinlenme durumu
//   node scripts/test_gizlilik_sayfasi.mjs --sonda  # kalıcı negatif + pozitif sondalar (bellekteki kopyalara karşı)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { kenarZinciriSorunlari } from '../deploy/traefik/kenar-zinciri.mjs';
import { HTML_REL, KAYNAK_REL, uret } from '../deploy/gizlilik-sayfasi/uret.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ADRES = 'https://tekserp.etkiliyazilim.com/gizlilik';
const PROJE = 'tekserp-gizlilik';
const PROJE_DIZINI = `/opt/stack/apps/${PROJE}`;
const YABANCI = ['tekserp-indir', 'tekserpguncelleme', 'indir.etkiliyazilim.com', 'guncelleme.etkiliyazilim.com'];

const COMPOSE_REL = 'deploy/gizlilik-sayfasi/docker-compose.yml';
const NGINX_REL = 'deploy/gizlilik-sayfasi/nginx/default.conf';
const URET_REL = 'deploy/gizlilik-sayfasi/uret.mjs';
const KUR_REL = 'deploy/gizlilik-sayfasi/vds-kur.sh';
const OLC_REL = 'deploy/gizlilik-sayfasi/olc.mjs';
const FORM_REL = 'docs/ops/PLAY-KONSOL-FORMLARI.md';
const ENVANTER_REL = 'docs/ops/SUNUCU-ENVANTERI.md';
const CF_REL = 'satici/sunucu/src/http/client-address.ts';
const ZINCIR_REL = 'deploy/traefik/kenar-zinciri.mjs';
const KANCA_REL = 'scripts/hooks/pre-commit.mjs';
const CI_REL = '.github/workflows/ci.yml';
const BEN_REL = 'scripts/test_gizlilik_sayfasi.mjs';

/** Commit tetiği: bekçinin okuduğu her dosya (§6 listenin kancada aynen geçtiğini ölçer). */
export const TETIK = Object.freeze([KAYNAK_REL, HTML_REL, COMPOSE_REL, NGINX_REL, URET_REL, KUR_REL, OLC_REL, FORM_REL, ENVANTER_REL, CF_REL, ZINCIR_REL, BEN_REL]);
const OKUNAN = [KAYNAK_REL, HTML_REL, COMPOSE_REL, NGINX_REL, KUR_REL, OLC_REL, FORM_REL, ENVANTER_REL, CF_REL, KANCA_REL, CI_REL];

function dosyalariOku() {
  const d = {};
  for (const rel of OKUNAN) {
    try {
      d[rel] = fs.readFileSync(path.join(KOK, rel), 'utf8');
    } catch {
      d[rel] = undefined;
    }
  }
  return d;
}

function etiketler(metin) {
  const e = {};
  for (const m of metin.matchAll(/^\s*-\s*"?(traefik\.[A-Za-z0-9._-]+)=(.*?)"?\s*$/gm)) e[m[1]] = m[2];
  return e;
}

function cloudflareAglari(kaynak) {
  const govde = /CLOUDFLARE_NETWORKS[^=]*=\s*\[([\s\S]*?)\]/.exec(kaynak)?.[1] ?? '';
  const liste = [...govde.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return liste.length > 0 ? liste : null;
}

function konumlar(metin) {
  return [...metin.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({ desen: m[1].trim(), govde: m[2] }));
}

/** Yayını durduran yer tutucular: `[BÜYÜK HARFLİ …]`. */
export function yerTutucular(html) {
  return [...html.matchAll(/\[[A-ZÇĞİÖŞÜ][^\]\n]{1,80}\]/g)].map((m) => m[0]);
}

/** email_off bölgelerinin DIŞINDA kalan e-posta adresleri ve mailto bağları (boş = temiz). */
export function emailOffDisi(html) {
  const dis = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, '');
  return [...dis.matchAll(/mailto:[^"'\s>]*|[a-z0-9._-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].map((m) => m[0]);
}

/** Saf ölçüm: girdiler enjekte edilebilir (sondalar). */
export function olc(d) {
  const s = { kirmizi: [], olculemedi: [] };
  for (const rel of OKUNAN) if (typeof d[rel] !== 'string') s.olculemedi.push(`${rel} okunamadı`);
  if (s.olculemedi.length) return s;
  const { host, pathname } = new URL(ADRES);

  // §1
  const h = d[HTML_REL];
  try {
    if (uret(d[KAYNAK_REL]) !== h) s.kirmizi.push(`§1 ${HTML_REL} kaynaktan üretilenle aynı değil (node ${URET_REL})`);
  } catch (e) {
    s.kirmizi.push(`§1 kaynak çevrilemedi: ${e.message}`);
  }
  if (/<script|<link|<iframe|<img|\ssrc=/i.test(h)) s.kirmizi.push('§1 sayfada betik/dış kaynak var (CSP default-src none)');
  const acik = emailOffDisi(h);
  if (acik.length) s.kirmizi.push(`§1 email_off dışında e-posta/mailto (Cloudflare karartır, CSP çözücüyü engeller): ${[...new Set(acik)].join(', ')}`);
  if (!/<html lang="tr">/.test(h) || !/name="viewport"/.test(h)) s.kirmizi.push('§1 lang="tr" ya da mobil viewport yok');

  // §2
  const c = d[COMPOSE_REL];
  const et = etiketler(c);
  const r = (alt) => et[`traefik.http.routers.${PROJE}.${alt}`];
  if (!new RegExp(`^name:\\s*${PROJE}\\s*$`, 'm').test(c)) s.kirmizi.push(`§2 compose proje adı ${PROJE} değil`);
  if (!new RegExp(`^\\s*container_name:\\s*${PROJE}\\s*$`, 'm').test(c)) s.kirmizi.push(`§2 container_name ${PROJE} değil`);
  if (!/^\s*read_only:\s*true\s*$/m.test(c)) s.kirmizi.push('§2 read_only: true yok');
  if (!/^\s*-\s*\.\/html:\/usr\/share\/nginx\/html:ro\s*$/m.test(c)) s.kirmizi.push('§2 html bağı salt-okunur değil');
  if (!/^\s*-\s*\.\/nginx\/default\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro\s*$/m.test(c)) s.kirmizi.push('§2 nginx conf bağı salt-okunur değil');
  if (/^\s*ports:/m.test(c)) s.kirmizi.push('§2 port yayımlanıyor (köken yalnız Traefik ağından)');
  if (r('rule') !== `Host(\`${host}\`)`) s.kirmizi.push(`§2 yönlendirici kuralı Host(\`${host}\`) değil: ${r('rule') ?? 'YOK'}`);
  if (r('entrypoints') !== 'websecure') s.kirmizi.push('§2 entrypoints websecure değil');
  if (r('tls') !== 'true') s.kirmizi.push('§2 tls=true yok');
  if (et['traefik.enable'] !== 'true') s.kirmizi.push('§2 traefik.enable=true yok');
  for (const ad of new Set(Object.keys(et).map((k) => k.split('.')[3]).filter(Boolean))) {
    if (!ad.startsWith(PROJE)) s.kirmizi.push(`§2 etiket adı "${ad}" kendi önekinde (${PROJE}) değil`);
  }
  const yorumsuz = c.split('\n').filter((x) => !/^\s*#/.test(x)).join('\n');
  for (const y of YABANCI) if (yorumsuz.includes(y)) s.kirmizi.push(`§2 compose başka sitenin adını/adresini anıyor: ${y}`);

  // §3
  const cf = cloudflareAglari(d[CF_REL]);
  if (cf === null) s.olculemedi.push(`§3 ${CF_REL} CLOUDFLARE_NETWORKS okunamadı`);
  else for (const x of kenarZinciriSorunlari(et, PROJE, cf)) s.kirmizi.push(`§3 ${x}`);
  for (const hk of (r('middlewares') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (hk.includes('@') || !hk.startsWith(`${PROJE}-`)) s.kirmizi.push(`§3 ara katman "${hk}" bu servisin kendi etiketi değil`);
  }

  // §4
  const n = d[NGINX_REL];
  for (const satir of n.split('\n')) {
    if (/^\s*#/.test(satir) || !/\badd_header\b/.test(satir) || !/\balways\s*;/.test(satir)) continue;
    if (!/add_header\s+Cache-Control\s+"no-(store|cache)[^"]*"\s+always;/.test(satir)) s.kirmizi.push(`§4 always yalnız no-store/no-cache başlığında olur: ${satir.trim()}`);
  }
  const k = konumlar(n);
  if (k.length < 4) s.olculemedi.push(`§4 nginx konum blokları ayrıştırılamadı (${k.length})`);
  if (!/^\s*autoindex\s+off;/m.test(n)) s.kirmizi.push('§4 autoindex off yok');
  if (!/^\s*absolute_redirect\s+off;/m.test(n)) s.kirmizi.push('§4 absolute_redirect off yok (yönlendirme http:// mutlak adrese gider)');
  const regexler = k.filter((x) => x.desen.startsWith('~'));
  const nokta = k.find((x) => x.desen === '~ (^|/)\\.');
  if (!nokta || !/return\s+404;/.test(nokta.govde)) s.kirmizi.push('§4 nokta-dosya konumu 404 dönmüyor');
  else if (regexler.indexOf(nokta) !== 0) s.kirmizi.push('§4 nokta-dosya konumu ilk regex değil');
  const sayfa = k.find((x) => x.desen === `= ${pathname}`);
  const dosya = `/${path.posix.basename(HTML_REL)}`;
  if (!sayfa) s.kirmizi.push(`§4 "location = ${pathname}" yok`);
  else {
    if (!new RegExp(`try_files\\s+${dosya.replace('.', '\\.')}\\s+=404;`).test(sayfa.govde)) s.kirmizi.push(`§4 sayfa konumu ${dosya}'ı sunmuyor`);
    const yas = /Cache-Control\s+"[^"]*max-age=([0-9]+)/.exec(sayfa.govde)?.[1];
    if (!yas || Number(yas) > 3600) s.kirmizi.push(`§4 sayfa önbelleği kısa değil (max-age=${yas ?? 'YOK'}, tavan 3600)`);
    if (!/Content-Security-Policy\s+"default-src 'none'/.test(sayfa.govde)) s.kirmizi.push('§4 sayfa konumunda CSP default-src none yok');
  }
  const bulunamadi = k.find((x) => x.desen === '@bulunamadi');
  if (!/error_page\s+404\s*=\s*@bulunamadi;/.test(n) || !bulunamadi || !/Cache-Control\s+"no-store"\s+always;/.test(bulunamadi.govde)) s.kirmizi.push('§4 404 no-store hattı yok');

  // §5
  for (const rel of [KUR_REL, OLC_REL, KAYNAK_REL, FORM_REL, ENVANTER_REL]) if (!d[rel].includes(ADRES)) s.kirmizi.push(`§5 ${rel} adresi (${ADRES}) anmıyor`);
  if (!d[KUR_REL].includes(PROJE_DIZINI)) s.kirmizi.push(`§5 ${KUR_REL} proje dizinini (${PROJE_DIZINI}) anmıyor`);

  // §6
  const kanca = d[KANCA_REL];
  if (!kanca.includes(`"${BEN_REL}"`)) s.kirmizi.push('§6 commit kancasında bu bekçinin adımı yok');
  for (const t of TETIK) if (!kanca.includes(`"${t}"`)) s.kirmizi.push(`§6 commit kancası tetiği "${t}"i kapsamıyor`);
  if (!d[CI_REL].includes(`node ${BEN_REL} && node ${BEN_REL} --sonda`)) s.kirmizi.push('§6 CI bu bekçiyi (+ --sonda) koşmuyor');
  return s;
}

function sondalar(taban) {
  const deg = (rel, f) => (d) => { d[rel] = f(d[rel]); };
  const C = (f) => deg(COMPOSE_REL, f);
  const N = (f) => deg(NGINX_REL, f);
  const liste = [
    ['P0 dokunulmamış', 'yesil', () => {}],
    ['N1 kaynak değişti, html üretilmedi', 'kirmizi', deg(KAYNAK_REL, (t) => t.replace('## 10. Çocuklar', '## 10. Çocuklar ve gençler'))],
    ['N2 html elle değişti', 'kirmizi', deg(HTML_REL, (t) => t.replace('</main>', '<p>ek</p>\n</main>'))],
    ['N3 sayfaya betik', 'kirmizi', deg(HTML_REL, (t) => t.replace('</body>', '<script src="x.js"></script></body>'))],
    ['N4 kök yazılabilir', 'kirmizi', C((t) => t.replace('read_only: true', 'read_only: false'))],
    ['N5 html bağı yazılabilir', 'kirmizi', C((t) => t.replace('./html:/usr/share/nginx/html:ro', './html:/usr/share/nginx/html'))],
    ['N6 Host indir adresi', 'kirmizi', C((t) => t.replace('Host(`tekserp.etkiliyazilim.com`)', 'Host(`indir.etkiliyazilim.com`)'))],
    ['N7 indir ara katmanına bağlı', 'kirmizi', C((t) => t.replace('middlewares=tekserp-gizlilik-cf,tekserp-gizlilik-hiz', 'middlewares=tekserp-indir-cf,tekserp-indir-hiz'))],
    ['N8 CF aralığı eksik', 'kirmizi', C((t) => t.replace('173.245.48.0/20,', ''))],
    ['N9 zincir sırası ters', 'kirmizi', C((t) => t.replace('middlewares=tekserp-gizlilik-cf,tekserp-gizlilik-hiz', 'middlewares=tekserp-gizlilik-hiz,tekserp-gizlilik-cf'))],
    ['N10 tls yok', 'kirmizi', C((t) => t.replace(/^.*routers\.tekserp-gizlilik\.tls=true\n/m, ''))],
    ['N11 port yayımlandı', 'kirmizi', C((t) => t.replace('    networks: [web]\n', '    ports: ["8088:80"]\n    networks: [web]\n'))],
    ['N12 sayfa önbelleğinde always', 'kirmizi', N((t) => t.replace('"public, max-age=300";', '"public, max-age=300" always;'))],
    ['N13 güvenlik başlığında always', 'kirmizi', N((t) => t.replace('"nosniff";', '"nosniff" always;'))],
    ['N14 uzun önbellek', 'kirmizi', N((t) => t.replace('max-age=300', 'max-age=604800'))],
    ['N15 autoindex açık', 'kirmizi', N((t) => t.replace('autoindex off;', 'autoindex on;'))],
    ['N16 mutlak yönlendirme', 'kirmizi', N((t) => t.replace('absolute_redirect off;', ''))],
    ['N17 nokta-dosya konumu yok', 'kirmizi', N((t) => t.replace(/location ~ \(\^\|\/\)\\\. \{\s*return 404;\s*\}/, ''))],
    ['N18 sayfa yolu farklı', 'kirmizi', N((t) => t.replace('location = /gizlilik {', 'location = /gizlilik-politikasi {'))],
    ['N19 404 no-store hattı yok', 'kirmizi', N((t) => t.replace('error_page 404 = @bulunamadi;', ''))],
    ['N20 kurulum betiği başka adres', 'kirmizi', deg(KUR_REL, (t) => t.replaceAll(ADRES, 'https://x.etkiliyazilim.com/gizlilik'))],
    ['N21 form belgesi adresi anmıyor', 'kirmizi', deg(FORM_REL, (t) => t.replaceAll(ADRES, 'https://etkiliyazilim.com/tekserp/gizlilik'))],
    ['N22 kancada adım yok', 'kirmizi', deg(KANCA_REL, (t) => t.replaceAll(`"${BEN_REL}"`, '"x"'))],
    ['N23 kanca tetiği html kapsamıyor', 'kirmizi', deg(KANCA_REL, (t) => t.replace(`"${HTML_REL}"`, '"y"'))],
    ['N24 CI koşmuyor', 'kirmizi', deg(CI_REL, (t) => t.replaceAll(BEN_REL, 'scripts/x.mjs'))],
    ['N25 mailto email_off dışında', 'kirmizi', deg(HTML_REL, (t) => t.replaceAll('<!--email_off-->', '').replaceAll('<!--/email_off-->', '')), '§1 email_off dışında'],
    ['N26 düz e-posta email_off dışında', 'kirmizi', deg(HTML_REL, (t) => t.replace('</main>', '<p>destek@etkiliyazilim.com</p>\n</main>')), '§1 email_off dışında'],
    ['P1 kaynağa yeni e-posta + üretildi', 'yesil', (d) => { d[KAYNAK_REL] = d[KAYNAK_REL].replace('## 10. Çocuklar', 'Ek: destek@etkiliyazilim.com\n\n## 10. Çocuklar'); d[HTML_REL] = uret(d[KAYNAK_REL]); }],
    ['O1 CF kaynağı okunamadı', 'olculemedi', deg(CF_REL, () => undefined)],
    ['O2 CLOUDFLARE_NETWORKS adı değişti', 'olculemedi', deg(CF_REL, (t) => t.replaceAll('CLOUDFLARE_NETWORKS', 'CF_AGLARI'))],
  ];
  let kotu = 0;
  for (const [ad, beklenen, boz, ileti] of liste) {
    const d = { ...taban };
    try {
      boz(d);
    } catch (e) {
      console.log(`❌ ${ad} — sonda kurulamadı: ${e.message}`);
      kotu++;
      continue;
    }
    if ((beklenen !== 'yesil' || ad.startsWith('P1')) && Object.keys(d).every((k) => d[k] === taban[k])) { console.log(`❌ ${ad} — bozma metni değiştirmedi (sonda geçersiz)`); kotu++; continue; }
    const s = olc(d);
    const h = s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil';
    const ok = h === beklenen && (!ileti || s.kirmizi.some((x) => x.startsWith(ileti)));
    if (!ok) kotu++;
    console.log(`${ok ? '✅' : '❌'} ${ad} → ${h}${ok ? '' : ` (beklenen ${beklenen}): ${[...s.olculemedi, ...s.kirmizi].join(' · ')}`}`);
  }
  console.log(kotu ? `\n❌ ${kotu} sonda beklenmeyen sonuç verdi` : `\n✅ ${liste.length} sonda beklendiği gibi`);
  return kotu === 0;
}

const girdi = dosyalariOku();
if (process.argv.includes('--sonda')) {
  console.log('test_gizlilik_sayfasi — kalıcı sondalar (bellekteki kopyalara karşı)\n');
  const t = olc(girdi);
  if (t.olculemedi.length || t.kirmizi.length) {
    console.log(`⛔ ÖLÇÜLEMEDİ — sonda tabanı yeşil değil: ${[...t.olculemedi, ...t.kirmizi].join(' · ')}`);
    process.exit(2);
  }
  process.exit(sondalar(girdi) ? 0 : 1);
}
const s = olc(girdi);
for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ ${x}`);
for (const x of s.kirmizi) console.log(`❌ ${x}`);
if (!s.olculemedi.length && !s.kirmizi.length) {
  console.log('✅ gizlilik sayfası: kaynak ↔ html bayt-eşit · e-posta email_off içinde · compose ayrı ve salt-okunur · kenar zinciri CF birebir · nginx önbellek/always/404 · adres tutarlı · kablolu');
  const yt = typeof girdi[HTML_REL] === 'string' ? yerTutucular(girdi[HTML_REL]) : [];
  if (yt.length) console.log(`⏳ yayın öncesi doldurulacak yer tutucu (vds-kur.sh --uygula durdurur): ${yt.join(' ')}`);
}
process.exit(s.olculemedi.length ? 2 : s.kirmizi.length ? 1 : 0);
